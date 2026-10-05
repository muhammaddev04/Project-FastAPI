from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import AwareDatetime, Field
from sqlalchemy import select

from app.core.errors import AppError
from app.core.filtering import ListQuery
from app.core.idempotency import IdempotentRoute, idempotent
from app.core.pagination import Page
from app.modules.catalog import service as catalog
from app.modules.catalog.models import Product
from app.modules.identity.deps import OrgContext, SessionDep, require_permission
from app.modules.inventory import ports
from app.modules.inventory.models import Stock, StockMovement, StockReservation
from app.modules.inventory.schemas import (
    AdjustmentIn,
    MovementOut,
    MovementType,
    ReceiptIn,
    ReceiptOut,
    ReservationOut,
    SourceType,
    StockDetail,
    StockOut,
    ThresholdIn,
    WriteOffIn,
)
from app.modules.inventory.service import stock_service, to_base

router = APIRouter(prefix="/api/v1/inventory", tags=["inventory"], route_class=IdempotentRoute)
Viewer = Annotated[OrgContext, Depends(require_permission("stock.view"))]
Receiver = Annotated[OrgContext, Depends(require_permission("stock.receive"))]
Adjuster = Annotated[OrgContext, Depends(require_permission("stock.adjust"))]
Writer = Annotated[OrgContext, Depends(require_permission("stock.write_off"))]
SettingsEditor = Annotated[OrgContext, Depends(require_permission("stock.settings"))]


class StockQuery(ListQuery):
    category_id: UUID | None = None
    is_active: bool | None = None
    low_stock: bool | None = None
    search: str | None = Field(default=None, max_length=100)
    ordering: Literal["available", "-available", "name", "-name"] = "name"
    filter_columns = {"category_id": Product.category_id, "is_active": Product.is_active}
    search_columns = (Product.name, Product.sku, Product.barcode)
    ordering_columns = {"available": Stock.quantity - Stock.reserved_quantity, "name": Product.name}


class MovementQuery(ListQuery):
    product_id: UUID | None = None
    type: MovementType | None = None
    source_type: SourceType | None = None
    date_from: AwareDatetime | None = None
    date_to: AwareDatetime | None = None
    filter_columns = {
        "product_id": StockMovement.product_id,
        "type": StockMovement.type,
        "source_type": StockMovement.source_type,
    }
    ordering: Literal["-created_at", "created_at"] = "-created_at"
    ordering_columns = {"created_at": StockMovement.created_at}


def stock_out(stock: Stock, product: Product) -> StockOut:
    return StockOut(
        product_id=product.id,
        name=product.name,
        sku=product.sku,
        barcode=product.barcode,
        base_unit=product.base_unit,
        category_id=product.category_id,
        is_active=product.is_active,
        quantity=stock.quantity,
        reserved_quantity=stock.reserved_quantity,
        available=stock.available,
        low_stock_threshold=stock.low_stock_threshold,
        last_movement_at=stock.last_movement_at,
        version=stock.version,
    )


@router.get("/stocks", response_model=Page[StockOut])
async def stocks(session: SessionDep, context: Viewer, query: Annotated[StockQuery, Query()]) -> Page[StockOut]:
    base = (
        select(Stock, Product)
        .join(Product, Product.id == Stock.product_id)
        .where(Stock.company_id == context.organization.id)
    )
    if query.low_stock is not None:
        low = (Stock.low_stock_threshold.is_not(None)) & (
            Stock.quantity - Stock.reserved_quantity < Stock.low_stock_threshold
        )
        base = base.where(low if query.low_stock else ~low)
    count, rows = await query.fetch(session, base, tie_breaker=Stock.product_id)
    return Page[StockOut].of(query.page, count, [stock_out(stock, product) for stock, product in rows])


@router.get("/stocks/{product_id}", response_model=StockDetail)
async def detail(session: SessionDep, context: Viewer, product_id: UUID) -> StockDetail:
    product = await catalog.get_owned_entity(session, Product, context.organization.id, product_id)
    stock = await session.scalar(
        select(Stock).where(Stock.company_id == context.organization.id, Stock.product_id == product_id)
    )
    if stock is None:
        raise AppError("not_found", 404)
    reservations = await session.scalars(
        select(StockReservation)
        .where(
            StockReservation.company_id == context.organization.id,
            StockReservation.product_id == product_id,
            StockReservation.status == "ACTIVE",
        )
        .order_by(StockReservation.created_at, StockReservation.id)
    )
    reservation_rows = list(reservations)
    numbers = await ports.order_numbers.resolve(
        session, context.organization.id, [row.source_id for row in reservation_rows]
    )
    return StockDetail(
        **stock_out(stock, product).model_dump(),
        reservations=[
            ReservationOut.model_validate(row).model_copy(update={"order_number": numbers.get(row.source_id)})
            for row in reservation_rows
        ],
    )


@router.patch("/stocks/{product_id}", response_model=StockDetail)
async def threshold(
    session: SessionDep, context: SettingsEditor, product_id: UUID, payload: ThresholdIn
) -> StockDetail:
    await catalog.writable(session, context)
    await stock_service.set_threshold(
        session, context.organization.id, product_id, payload.low_stock_threshold, payload.version, context.user.id
    )
    return await detail(session, context, product_id)


@router.post(
    "/receipts", response_model=ReceiptOut, status_code=201, dependencies=[idempotent(permission="stock.receive")]
)
async def receipt(session: SessionDep, context: Receiver, payload: ReceiptIn) -> ReceiptOut:
    await catalog.writable(session, context)
    lines = [
        (item.product_id, await to_base(session, context.organization.id, item.product_id, item.unit_id, item.quantity))
        for item in payload.items
    ]
    await stock_service.receive(session, context.organization.id, lines, context.user.id, payload.note)
    return ReceiptOut(received=len(payload.items))


@router.post("/adjustments", response_model=StockDetail, dependencies=[idempotent(permission="stock.adjust")])
async def adjustment(session: SessionDep, context: Adjuster, payload: AdjustmentIn) -> StockDetail:
    await catalog.writable(session, context)
    await stock_service.adjust(
        session, context.organization.id, payload.product_id, payload.actual_quantity, payload.reason, context.user.id
    )
    return await detail(session, context, payload.product_id)


@router.post("/write-offs", response_model=StockDetail, dependencies=[idempotent(permission="stock.write_off")])
async def write_off(session: SessionDep, context: Writer, payload: WriteOffIn) -> StockDetail:
    await catalog.writable(session, context)
    qty = await to_base(session, context.organization.id, payload.product_id, payload.unit_id, payload.quantity)
    await stock_service.write_off(
        session, context.organization.id, payload.product_id, qty, payload.reason, context.user.id
    )
    return await detail(session, context, payload.product_id)


@router.get("/movements", response_model=Page[MovementOut])
async def movements(
    session: SessionDep, context: Viewer, query: Annotated[MovementQuery, Query()]
) -> Page[MovementOut]:
    base = select(StockMovement).where(StockMovement.company_id == context.organization.id)
    if query.date_from:
        base = base.where(StockMovement.created_at >= query.date_from)
    if query.date_to:
        base = base.where(StockMovement.created_at <= query.date_to)
    count, rows = await query.fetch(session, base, tie_breaker=StockMovement.id)
    return Page[MovementOut].of(query.page, count, [MovementOut.model_validate(row) for row in rows.scalars()])
