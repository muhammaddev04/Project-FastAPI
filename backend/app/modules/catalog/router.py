from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from pydantic import AwareDatetime
from sqlalchemy import or_, select

from app.core.idempotency import IdempotentRoute, idempotent
from app.core.pagination import Page, PageParamsDep, fetch_page
from app.core.time import utcnow
from app.modules.catalog import imports, service
from app.modules.catalog.models import (
    Category,
    ImportError,
    ImportJob,
    ImportRow,
    Price,
    PriceList,
    Product,
    ProductUnit,
)
from app.modules.catalog.schemas import (
    BulkPricesIn,
    CategoryIn,
    CategoryOut,
    CategoryPatch,
    ImportErrorOut,
    ImportOut,
    ImportRowOut,
    MatrixOut,
    PriceIn,
    PriceListIn,
    PriceListOut,
    PriceListPatch,
    PriceOut,
    ProductIn,
    ProductOut,
    ProductPatch,
    UnitIn,
    UnitOut,
    VersionIn,
)
from app.modules.identity.deps import OrgContext, SessionDep, require_permission

router = APIRouter(prefix="/api/v1", tags=["catalog and pricing"], route_class=IdempotentRoute)
Viewer = Annotated[OrgContext, Depends(require_permission("catalog.view"))]
Manager = Annotated[OrgContext, Depends(require_permission("catalog.manage"))]
PriceViewer = Annotated[OrgContext, Depends(require_permission("pricing.view"))]
PriceManager = Annotated[OrgContext, Depends(require_permission("pricing.manage"))]
Importer = Annotated[OrgContext, Depends(require_permission("import.run"))]


@router.get("/catalog/categories", response_model=list[CategoryOut])
async def categories(session: SessionDep, context: Viewer, flat: bool = False) -> list[CategoryOut]:
    rows = list(
        await session.scalars(
            select(Category)
            .where(Category.company_id == context.organization.id)
            .order_by(Category.sort_order, Category.name, Category.id)
        )
    )
    outputs = {row.id: CategoryOut.model_validate(row) for row in rows}
    if flat:
        return list(outputs.values())
    for output in outputs.values():
        if output.parent_id in outputs:
            outputs[output.parent_id].children.append(output)
    return [output for output in outputs.values() if output.parent_id is None]


@router.post("/catalog/categories", response_model=CategoryOut, status_code=201)
async def add_category(session: SessionDep, context: Manager, payload: CategoryIn) -> Category:
    return await service.create_category(session, context, payload)


@router.patch("/catalog/categories/{category_id}", response_model=CategoryOut)
async def patch_category(session: SessionDep, context: Manager, category_id: UUID, payload: CategoryPatch) -> Category:
    return await service.update_category(session, context, category_id, payload)


@router.get("/catalog/products", response_model=Page[ProductOut])
async def products(
    session: SessionDep,
    context: Viewer,
    page: PageParamsDep,
    category_id: UUID | None = None,
    is_active: bool | None = None,
    search: str = "",
    ordering: Literal["name", "sku", "created_at", "-name", "-sku", "-created_at"] = "name",
) -> Page[ProductOut]:
    query = select(Product).where(Product.company_id == context.organization.id)
    if category_id:
        query = query.where(Product.category_id == category_id)
    if is_active is not None:
        query = query.where(Product.is_active == is_active)
    if search:
        pattern = f"%{search}%"
        query = query.where(
            or_(Product.name.ilike(pattern), Product.sku.ilike(pattern), Product.barcode.ilike(pattern))
        )
    column = getattr(Product, ordering.lstrip("-"))
    count, rows = await fetch_page(
        session, query, page, order_by=[column.desc() if ordering.startswith("-") else column], tie_breaker=Product.id
    )
    return Page[ProductOut].of(page, count, [ProductOut.model_validate(row) for row in rows.scalars()])


async def product_out(session: SessionDep, context: OrgContext, product: Product) -> ProductOut:
    units = list(
        await session.scalars(
            select(ProductUnit)
            .where(ProductUnit.product_id == product.id)
            .order_by(ProductUnit.is_base.desc(), ProductUnit.code)
        )
    )
    prices = None
    if "pricing.view" in context.permissions:
        prices = [
            PriceOut.model_validate(row)
            for row in await session.scalars(
                select(Price)
                .where(Price.product_unit_id.in_([unit.id for unit in units]))
                .order_by(Price.valid_from.desc())
            )
        ]
    return ProductOut(
        **ProductOut.model_validate(product).model_dump(exclude={"units", "prices"}),
        units=[UnitOut.model_validate(unit) for unit in units],
        prices=prices,
    )


@router.post(
    "/catalog/products",
    response_model=ProductOut,
    status_code=201,
    dependencies=[idempotent(permission="catalog.manage")],
)
async def add_product(session: SessionDep, context: Manager, payload: ProductIn) -> ProductOut:
    return await product_out(session, context, await service.create_product(session, context, payload))


@router.get("/catalog/products/{product_id}", response_model=ProductOut)
async def product_detail(session: SessionDep, context: Viewer, product_id: UUID) -> ProductOut:
    return await product_out(
        session, context, await service.get_owned_entity(session, Product, context.organization.id, product_id)
    )


@router.patch("/catalog/products/{product_id}", response_model=ProductOut)
async def patch_product(session: SessionDep, context: Manager, product_id: UUID, payload: ProductPatch) -> ProductOut:
    return await product_out(session, context, await service.update_product(session, context, product_id, payload))


@router.post("/catalog/products/{product_id}/activate", response_model=ProductOut)
async def activate(session: SessionDep, context: Manager, product_id: UUID, payload: VersionIn) -> ProductOut:
    return await product_out(
        session,
        context,
        await service.update_product(
            session, context, product_id, ProductPatch(version=payload.version, is_active=True)
        ),
    )


@router.post("/catalog/products/{product_id}/deactivate", response_model=ProductOut)
async def deactivate(session: SessionDep, context: Manager, product_id: UUID, payload: VersionIn) -> ProductOut:
    return await product_out(
        session,
        context,
        await service.update_product(
            session, context, product_id, ProductPatch(version=payload.version, is_active=False)
        ),
    )


@router.post("/catalog/products/{product_id}/units", response_model=UnitOut, status_code=201)
async def add_unit(session: SessionDep, context: Manager, product_id: UUID, payload: UnitIn) -> ProductUnit:
    return await service.create_unit(session, context, product_id, payload)


@router.post("/catalog/products/{product_id}/units/{unit_id}/deactivate", response_model=UnitOut)
async def deactivate_unit(session: SessionDep, context: Manager, product_id: UUID, unit_id: UUID) -> ProductUnit:
    await service.writable(session, context)
    await service.get_owned_entity(session, Product, context.organization.id, product_id, lock=True)
    unit = await service.unit_owned(session, context.organization.id, unit_id)
    if unit.product_id != product_id:
        from app.core.errors import AppError

        raise AppError("not_found", 404)
    if unit.is_base:
        from app.core.errors import AppError

        raise AppError("base_unit_required", 409)
    unit.is_active = False
    await service.logged(session, context, "unit.deactivated", unit)
    return unit


@router.get("/pricing/price-lists", response_model=Page[PriceListOut])
async def price_lists(session: SessionDep, context: PriceViewer, page: PageParamsDep) -> Page[PriceListOut]:
    await service.default_list(session, context.organization.id)
    count, rows = await fetch_page(
        session,
        select(PriceList).where(PriceList.company_id == context.organization.id),
        page,
        order_by=[PriceList.is_default.desc(), PriceList.name],
        tie_breaker=PriceList.id,
    )
    return Page[PriceListOut].of(page, count, [PriceListOut.model_validate(row) for row in rows.scalars()])


@router.post("/pricing/price-lists", response_model=PriceListOut, status_code=201)
async def add_list(session: SessionDep, context: PriceManager, payload: PriceListIn) -> PriceList:
    await service.writable(session, context)
    await service.default_list(session, context.organization.id)
    price_list = PriceList(company_id=context.organization.id, **payload.model_dump())
    session.add(price_list)
    await service.logged(session, context, "price_list.created", price_list)
    return price_list


@router.patch("/pricing/price-lists/{list_id}", response_model=PriceListOut)
async def patch_list(session: SessionDep, context: PriceManager, list_id: UUID, payload: PriceListPatch) -> PriceList:
    await service.writable(session, context)
    price_list = await service.get_owned_entity(session, PriceList, context.organization.id, list_id, lock=True)
    service.version(price_list, payload.version)
    if price_list.is_default and payload.is_active is False:
        from app.core.errors import AppError

        raise AppError("default_price_list_required", 409)
    for key, value in payload.model_dump(exclude_unset=True, exclude={"version"}).items():
        setattr(price_list, key, value)
    price_list.version += 1
    await service.logged(session, context, "price_list.updated", price_list)
    return price_list


@router.get("/pricing/price-lists/{list_id}/prices", response_model=Page[MatrixOut])
async def matrix(
    session: SessionDep,
    context: PriceViewer,
    list_id: UUID,
    page: PageParamsDep,
    at: AwareDatetime | None = None,
    product_id: UUID | None = None,
    category_id: UUID | None = None,
    search: str = "",
) -> Page[MatrixOut]:
    await service.default_list(session, context.organization.id)
    await service.get_owned_entity(session, PriceList, context.organization.id, list_id)
    query = (
        select(ProductUnit, Product)
        .join(Product)
        .where(
            Product.company_id == context.organization.id, Product.is_active.is_(True), ProductUnit.is_active.is_(True)
        )
    )
    if product_id:
        query = query.where(Product.id == product_id)
    if category_id:
        query = query.where(Product.category_id == category_id)
    if search:
        query = query.where(or_(Product.name.ilike(f"%{search}%"), Product.sku.ilike(f"%{search}%")))
    count, rows = await fetch_page(
        session, query, page, order_by=[Product.name, ProductUnit.code], tie_breaker=ProductUnit.id
    )
    results = []
    when: datetime = at or utcnow()
    for unit, product in rows:
        current = await session.scalar(
            select(Price).where(
                Price.price_list_id == list_id,
                Price.product_unit_id == unit.id,
                Price.valid_from <= when,
                (Price.valid_to.is_(None) | (Price.valid_to > when)),
            )
        )
        future = await session.scalar(
            select(Price)
            .where(Price.price_list_id == list_id, Price.product_unit_id == unit.id, Price.valid_from > when)
            .order_by(Price.valid_from)
            .limit(1)
        )
        results.append(
            MatrixOut(
                product_id=product.id,
                sku=product.sku,
                name=product.name,
                unit=UnitOut.model_validate(unit),
                current=PriceOut.model_validate(current) if current else None,
                future=PriceOut.model_validate(future) if future else None,
                resolved_price=await service.resolve(session, list_id, unit.id, when),
            )
        )
    return Page[MatrixOut].of(page, count, results)


@router.post(
    "/pricing/prices",
    response_model=PriceOut,
    status_code=201,
    dependencies=[idempotent(permission="pricing.manage")],
)
async def add_price(session: SessionDep, context: PriceManager, payload: PriceIn) -> Price:
    return await service.set_price(session, context, payload)


@router.post(
    "/pricing/prices/bulk",
    response_model=list[PriceOut],
    status_code=201,
    dependencies=[idempotent(permission="pricing.manage")],
)
async def bulk_prices(session: SessionDep, context: PriceManager, payload: BulkPricesIn) -> list[Price]:
    return [await service.set_price(session, context, row) for row in payload.rows]


@router.delete("/pricing/prices/{price_id}", status_code=204)
async def delete_price(session: SessionDep, context: PriceManager, price_id: UUID) -> Response:
    await service.cancel_price(session, context, price_id)
    return Response(status_code=204)


@router.get("/pricing/prices/history", response_model=Page[PriceOut])
async def price_history(
    session: SessionDep, context: PriceViewer, price_list_id: UUID, product_unit_id: UUID, page: PageParamsDep
) -> Page[PriceOut]:
    await service.get_owned_entity(session, PriceList, context.organization.id, price_list_id)
    await service.unit_owned(session, context.organization.id, product_unit_id)
    count, rows = await fetch_page(
        session,
        select(Price).where(Price.price_list_id == price_list_id, Price.product_unit_id == product_unit_id),
        page,
        order_by=[Price.valid_from.desc()],
        tie_breaker=Price.id,
    )
    return Page[PriceOut].of(page, count, [PriceOut.model_validate(row) for row in rows.scalars()])


@router.get("/imports/templates/{kind}")
async def import_template(context: Importer, kind: imports.Kind) -> Response:
    return Response(
        imports.template(kind, context.user.language),
        media_type=imports.MIME,
        headers={"Content-Disposition": f'attachment; filename="{kind.lower()}.xlsx"'},
    )


@router.post("/imports", response_model=ImportOut, status_code=202)
async def import_upload(
    session: SessionDep, context: Importer, file: Annotated[UploadFile, File()], kind: Annotated[imports.Kind, Form()]
) -> ImportJob:
    return await imports.upload(session, context, file, kind)


@router.get("/imports", response_model=Page[ImportOut])
async def import_list(session: SessionDep, context: Importer, page: PageParamsDep) -> Page[ImportOut]:
    count, rows = await fetch_page(
        session,
        select(ImportJob).where(ImportJob.company_id == context.organization.id),
        page,
        order_by=[ImportJob.created_at.desc()],
        tie_breaker=ImportJob.id,
    )
    return Page[ImportOut].of(page, count, [ImportOut.model_validate(row) for row in rows.scalars()])


@router.get("/imports/{job_id}", response_model=ImportOut)
async def import_detail(session: SessionDep, context: Importer, job_id: UUID) -> ImportJob:
    return await imports.owned(session, context, job_id)


@router.get("/imports/{job_id}/rows", response_model=Page[ImportRowOut])
async def import_rows(session: SessionDep, context: Importer, job_id: UUID, page: PageParamsDep) -> Page[ImportRowOut]:
    await imports.owned(session, context, job_id)
    count, rows = await fetch_page(
        session,
        select(ImportRow).where(ImportRow.import_id == job_id),
        page,
        order_by=[ImportRow.row_number],
        tie_breaker=ImportRow.id,
    )
    return Page[ImportRowOut].of(page, count, [ImportRowOut.model_validate(row) for row in rows.scalars()])


@router.get("/imports/{job_id}/errors", response_model=Page[ImportErrorOut])
async def import_errors(
    session: SessionDep, context: Importer, job_id: UUID, page: PageParamsDep
) -> Page[ImportErrorOut]:
    await imports.owned(session, context, job_id)
    count, rows = await fetch_page(
        session,
        select(ImportError).where(ImportError.import_id == job_id),
        page,
        order_by=[ImportError.row_number],
        tie_breaker=ImportError.id,
    )
    return Page[ImportErrorOut].of(page, count, [ImportErrorOut.model_validate(row) for row in rows.scalars()])


@router.post(
    "/imports/{job_id}/confirm",
    response_model=ImportOut,
    status_code=202,
    dependencies=[idempotent(permission="import.run")],
)
async def import_confirm(session: SessionDep, context: Importer, job_id: UUID) -> ImportJob:
    return await imports.confirm(session, context, job_id)


@router.post("/imports/{job_id}/cancel", response_model=ImportOut)
async def import_cancel(session: SessionDep, context: Importer, job_id: UUID) -> ImportJob:
    await service.writable(session, context)
    job = await imports.owned(session, context, job_id, lock=True)
    await imports.transition(session, job, "CANCELLED", actor_id=context.user.id)
    return job
