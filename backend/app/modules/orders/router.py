from datetime import datetime
from html import escape
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import HTMLResponse
from pydantic import Field
from sqlalchemy import select

from app.core.errors import AppError
from app.core.filtering import ListQuery, _literal_pattern
from app.core.idempotency import IdempotentRoute, idempotent
from app.core.pagination import Page
from app.modules.catalog.schemas import CategoryOut
from app.modules.identity.deps import OrgContext, SessionDep, require_permission
from app.modules.orders import cart, catalog, service
from app.modules.orders.models import Order, OrderStatusHistory
from app.modules.orders.schemas import (
    CartOut,
    CartQuantityIn,
    CatalogProduct,
    CheckoutIn,
    ConfirmationPreview,
    ConfirmIn,
    CreateIn,
    HistoryOut,
    ItemOut,
    OrderOut,
    OrderWarehouseView,
    ReasonIn,
    Status,
    VersionIn,
    WarehouseItem,
)
from app.modules.organizations.models import Company, Store
from app.modules.partnerships import service as partners

router = APIRouter(prefix="/api/v1", tags=["orders"], route_class=IdempotentRoute)
Viewer = Annotated[OrgContext, Depends(require_permission("orders.view"))]
Creator = Annotated[OrgContext, Depends(require_permission("orders.create"))]
CartUser = Annotated[OrgContext, Depends(require_permission("cart.manage"))]
CatalogUser = Annotated[OrgContext, Depends(require_permission("store_catalog.view"))]
Confirmer = Annotated[OrgContext, Depends(require_permission("orders.confirm"))]
Canceller = Annotated[OrgContext, Depends(require_permission("orders.cancel"))]
Rejecter = Annotated[OrgContext, Depends(require_permission("orders.reject"))]
Assembler = Annotated[OrgContext, Depends(require_permission("orders.assemble"))]
Reattempter = Annotated[OrgContext, Depends(require_permission("orders.reattempt"))]


class OrderQuery(ListQuery):
    status: list[Status] = Field(default_factory=list)
    partnership_id: UUID | None = None
    date_from: datetime | None = None
    date_to: datetime | None = None
    source: Literal["STORE", "COMPANY_ON_BEHALF"] | None = None
    search: str | None = Field(default=None, max_length=100)
    ordering: Literal["created_at", "-created_at", "total", "-total"] = "-created_at"
    filter_columns = {"partnership_id": Order.partnership_id, "source": Order.source}
    search_columns = (Order.order_number,)
    ordering_columns = {"created_at": Order.created_at, "total": Order.total}


async def history(session: SessionDep, order_id: UUID, *, warehouse: bool = False) -> list[HistoryOut]:
    result = [
        HistoryOut.model_validate(row)
        for row in await session.scalars(
            select(OrderStatusHistory)
            .where(OrderStatusHistory.order_id == order_id)
            .order_by(OrderStatusHistory.created_at, OrderStatusHistory.id)
        )
    ]
    if warehouse:
        for row in result:
            row.details = {}
    return result


async def output(session: SessionDep, ctx: OrgContext, order: Order) -> OrderOut | OrderWarehouseView:
    warehouse = ctx.membership.role == "WAREHOUSE"
    result: OrderOut | OrderWarehouseView = (
        OrderWarehouseView.model_validate(order) if warehouse else OrderOut.model_validate(order)
    )
    profile = (
        await session.get(Store, order.store_id)
        if ctx.organization.type == "COMPANY"
        else await session.get(Company, order.company_id)
    )
    result.partner_name = profile.legal_name if profile else ""
    result.history = await history(session, order.id, warehouse=warehouse)
    rows = await service.items(session, order.id)
    if isinstance(result, OrderWarehouseView):
        result.items = [WarehouseItem.model_validate(row) for row in rows]
    else:
        result.items = [ItemOut.model_validate(row) for row in rows]
        if ctx.organization.type == "STORE":
            result.terms_snapshot = None
    for row in result.items:
        row.rejected_quantity = (
            row.requested_quantity - row.confirmed_quantity if row.confirmed_quantity is not None else service.ZERO
        )
    return result


@router.get("/orders", response_model=Page[OrderOut | OrderWarehouseView])
async def listing(
    session: SessionDep, ctx: Viewer, query: Annotated[OrderQuery, Query()]
) -> Page[OrderOut | OrderWarehouseView]:
    company = ctx.organization.type == "COMPANY"
    model = Store if company else Company
    statement = (
        select(Order)
        .join(model, model.id == (Order.store_id if company else Order.company_id))
        .where((Order.company_id if company else Order.store_id) == ctx.organization.id)
    )
    if ctx.membership.role == "WAREHOUSE":
        if "total" in query.ordering:
            raise AppError("permission_denied", 403)
        statement = statement.where(Order.status.in_(service.WAREHOUSE_STATUSES))
    if query.status:
        statement = statement.where(Order.status.in_(query.status))
    if query.date_from:
        statement = statement.where(Order.created_at >= query.date_from)
    if query.date_to:
        statement = statement.where(Order.created_at <= query.date_to)
    if query.search and query.search.strip():
        pattern = _literal_pattern(query.search.strip())
        statement = statement.where(
            Order.order_number.ilike(pattern, escape="\\") | model.legal_name.ilike(pattern, escape="\\")
        )
    count, rows = await query.model_copy(update={"search": None}).fetch(session, statement, tie_breaker=Order.id)
    return Page[OrderOut | OrderWarehouseView].of(
        query.page, count, [await output(session, ctx, row[0]) for row in rows]
    )


@router.post("/orders", response_model=OrderOut, status_code=201, dependencies=[idempotent(permission="orders.create")])
async def create(session: SessionDep, ctx: Creator, payload: CreateIn) -> OrderOut | OrderWarehouseView:
    return await output(
        session,
        ctx,
        await service.order_service.create(
            session, ctx, payload.partnership_id, payload.items, payload.store_note, source="COMPANY_ON_BEHALF"
        ),
    )


@router.get("/orders/catalog/{partnership_id}/categories", response_model=list[CategoryOut])
async def company_categories(session: SessionDep, ctx: Creator, partnership_id: UUID) -> list[CategoryOut]:
    partners.require(ctx, "orders.create", "COMPANY")
    return await catalog.categories(session, ctx, partnership_id)


@router.get("/orders/catalog/{partnership_id}/products", response_model=Page[CatalogProduct])
async def company_products(
    session: SessionDep, ctx: Creator, partnership_id: UUID, query: Annotated[catalog.ProductQuery, Query()]
) -> Page[CatalogProduct]:
    partners.require(ctx, "orders.create", "COMPANY")
    return await catalog.products(session, ctx, partnership_id, query)


@router.get("/orders/{order_id}", response_model=OrderOut | OrderWarehouseView)
async def detail(session: SessionDep, ctx: Viewer, order_id: UUID) -> OrderOut | OrderWarehouseView:
    return await output(session, ctx, await service.get(session, ctx, order_id))


@router.get("/orders/{order_id}/history", response_model=list[HistoryOut])
async def order_history(session: SessionDep, ctx: Viewer, order_id: UUID) -> list[HistoryOut]:
    order = await service.get(session, ctx, order_id)
    return await history(session, order.id, warehouse=ctx.membership.role == "WAREHOUSE")


@router.post("/orders/{order_id}/mark-viewed", response_model=OrderOut | OrderWarehouseView)
async def viewed(session: SessionDep, ctx: Viewer, order_id: UUID) -> OrderOut | OrderWarehouseView:
    return await output(session, ctx, await service.order_service.mark_viewed(session, ctx, order_id))


@router.get("/orders/{order_id}/confirmation-preview", response_model=ConfirmationPreview)
async def preview(session: SessionDep, ctx: Confirmer, order_id: UUID) -> ConfirmationPreview:
    return await service.order_service.preview(session, ctx, order_id)


@router.post(
    "/orders/{order_id}/confirm", response_model=OrderOut, dependencies=[idempotent(permission="orders.confirm")]
)
async def confirm(
    session: SessionDep, ctx: Confirmer, order_id: UUID, payload: ConfirmIn
) -> OrderOut | OrderWarehouseView:
    return await output(session, ctx, await service.order_service.confirm(session, ctx, order_id, payload))


@router.post(
    "/orders/{order_id}/reject", response_model=OrderOut, dependencies=[idempotent(permission="orders.reject")]
)
async def reject(
    session: SessionDep, ctx: Rejecter, order_id: UUID, payload: ReasonIn
) -> OrderOut | OrderWarehouseView:
    return await output(
        session,
        ctx,
        await service.order_service.action(session, ctx, order_id, "reject", payload.version, payload.reason),
    )


@router.post(
    "/orders/{order_id}/cancel", response_model=OrderOut, dependencies=[idempotent(permission="orders.cancel")]
)
async def cancel(
    session: SessionDep, ctx: Canceller, order_id: UUID, payload: ReasonIn
) -> OrderOut | OrderWarehouseView:
    return await output(
        session,
        ctx,
        await service.order_service.action(session, ctx, order_id, "cancel", payload.version, payload.reason),
    )


@router.post(
    "/orders/{order_id}/start-assembling",
    response_model=OrderOut | OrderWarehouseView,
    dependencies=[idempotent(permission="orders.assemble")],
)
async def assemble(
    session: SessionDep, ctx: Assembler, order_id: UUID, payload: VersionIn
) -> OrderOut | OrderWarehouseView:
    return await output(
        session, ctx, await service.order_service.action(session, ctx, order_id, "assemble", payload.version)
    )


@router.post(
    "/orders/{order_id}/mark-ready",
    response_model=OrderOut | OrderWarehouseView,
    dependencies=[idempotent(permission="orders.assemble")],
)
async def ready(
    session: SessionDep, ctx: Assembler, order_id: UUID, payload: VersionIn
) -> OrderOut | OrderWarehouseView:
    return await output(
        session, ctx, await service.order_service.action(session, ctx, order_id, "ready", payload.version)
    )


@router.post(
    "/orders/{order_id}/reattempt", response_model=OrderOut, dependencies=[idempotent(permission="orders.reattempt")]
)
async def reattempt(
    session: SessionDep, ctx: Reattempter, order_id: UUID, payload: VersionIn
) -> OrderOut | OrderWarehouseView:
    return await output(
        session, ctx, await service.order_service.action(session, ctx, order_id, "reattempt", payload.version)
    )


@router.get("/orders/{order_id}/pick-list", response_class=HTMLResponse)
async def pick_list(session: SessionDep, ctx: Assembler, order_id: UUID) -> HTMLResponse:
    order = await service.get(session, ctx, order_id)
    if order.status not in service.WAREHOUSE_STATUSES:
        raise AppError("invalid_transition", 409)
    table = "".join(
        f"<tr><td>{escape(row.product_name_snapshot)}</td><td>{escape(row.sku_snapshot)}</td>"
        f"<td>{escape(row.unit_code_snapshot)}</td><td>{row.confirmed_quantity}</td>"
        f"<td>{service.q3((row.confirmed_quantity or service.ZERO) * row.unit_coefficient_snapshot)} "
        f"{escape(row.base_unit_snapshot)}</td></tr>"
        for row in await service.items(session, order.id)
        if row.confirmed_quantity
    )
    return HTMLResponse(
        '<!doctype html><html><head><meta charset="utf-8">'
        f"<title>{escape(order.order_number)}</title><style>table{{border-collapse:collapse;width:100%}}"
        "td,th{border:1px solid;padding:8px}@media print{button{display:none}}</style></head><body>"
        f"<h1>{escape(order.order_number)}</h1><p>{escape(order.delivery_address)}</p>"
        "<table><thead><tr><th>Product / Мол / Товар</th><th>SKU</th><th>Unit / Воҳид / Единица</th>"
        "<th>Confirmed / Тасдиқ / Подтверждено</th><th>Base / Асосӣ / Базовая</th></tr></thead>"
        f"<tbody>{table}</tbody></table>"
        '<button onclick="window.print()">Print / Чоп / Печать</button></body></html>'
    )


@router.get("/store/catalog/{partnership_id}/categories", response_model=list[CategoryOut])
async def store_categories(session: SessionDep, ctx: CatalogUser, partnership_id: UUID) -> list[CategoryOut]:
    return await catalog.categories(session, ctx, partnership_id)


@router.get("/store/catalog/{partnership_id}/products", response_model=Page[CatalogProduct])
async def store_products(
    session: SessionDep, ctx: CatalogUser, partnership_id: UUID, query: Annotated[catalog.ProductQuery, Query()]
) -> Page[CatalogProduct]:
    return await catalog.products(session, ctx, partnership_id, query)


@router.get("/store/cart/{partnership_id}", response_model=CartOut)
async def cart_view(session: SessionDep, ctx: CartUser, partnership_id: UUID) -> CartOut:
    return await cart.view(session, ctx, partnership_id)


@router.put("/store/cart/{partnership_id}/items/{unit_id}", response_model=CartOut)
async def cart_put(
    session: SessionDep, ctx: CartUser, partnership_id: UUID, unit_id: UUID, payload: CartQuantityIn
) -> CartOut:
    return await cart.put(session, ctx, partnership_id, unit_id, payload.quantity)


@router.delete("/store/cart/{partnership_id}", status_code=204)
async def cart_clear(session: SessionDep, ctx: CartUser, partnership_id: UUID) -> Response:
    await cart.clear(session, ctx, partnership_id)
    return Response(status_code=204)


@router.post(
    "/store/cart/{partnership_id}/checkout",
    response_model=OrderOut,
    status_code=201,
    dependencies=[idempotent(permission="orders.create")],
)
async def checkout(
    session: SessionDep, ctx: CartUser, partnership_id: UUID, payload: CheckoutIn
) -> OrderOut | OrderWarehouseView:
    return await output(session, ctx, await cart.checkout(session, ctx, partnership_id, payload.store_note))


@router.post("/store/orders/{order_id}/repeat", response_model=CartOut)
async def repeat(session: SessionDep, ctx: CartUser, order_id: UUID) -> CartOut:
    return await cart.repeat(session, ctx, order_id)
