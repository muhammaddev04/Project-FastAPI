from typing import Literal
from uuid import UUID

from pydantic import Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.filtering import ListQuery
from app.core.pagination import Page
from app.core.time import utcnow
from app.modules.catalog import service as pricing
from app.modules.catalog.models import Category, Price, PriceList, Product, ProductUnit
from app.modules.catalog.schemas import CategoryOut
from app.modules.identity.deps import OrgContext
from app.modules.inventory.models import Stock
from app.modules.orders import service
from app.modules.orders.cart import availability
from app.modules.orders.schemas import CatalogProduct, CatalogUnit
from app.modules.partnerships import service as partners
from app.modules.partnerships.models import Partnership


class ProductQuery(ListQuery):
    category_id: UUID | None = None
    search: str | None = Field(default=None, max_length=100)
    ordering: Literal["name", "-name", "sku", "-sku"] = "name"
    filter_columns = {"category_id": Product.category_id}
    search_columns = (Product.name, Product.sku, Product.barcode)
    ordering_columns = {"name": Product.name, "sku": Product.sku}


async def access(session: AsyncSession, ctx: OrgContext, partnership_id: UUID) -> Partnership:
    partners.require(ctx, "store_catalog.view" if ctx.organization.type == "STORE" else "orders.create")
    partner = await partners.get(session, ctx, partnership_id)
    partners.require_active(partner)
    return partner


async def categories(session: AsyncSession, ctx: OrgContext, partnership_id: UUID) -> list[CategoryOut]:
    partner = await access(session, ctx, partnership_id)
    return [
        CategoryOut.model_validate(row)
        for row in await session.scalars(
            select(Category)
            .where(Category.company_id == partner.company_id, Category.is_active.is_(True))
            .order_by(Category.sort_order, Category.id)
        )
    ]


async def products(
    session: AsyncSession, ctx: OrgContext, partnership_id: UUID, query: ProductQuery
) -> Page[CatalogProduct]:
    partner = await access(session, ctx, partnership_id)
    terms = await service.current_terms(session, partner.id)
    now = utcnow()
    default = await session.scalar(
        select(PriceList.id).where(
            PriceList.company_id == partner.company_id, PriceList.is_default.is_(True), PriceList.is_active.is_(True)
        )
    )
    list_ids = [terms.price_list_id] + ([default] if default else [])
    priced_unit = (
        select(ProductUnit.id)
        .join(Price, Price.product_unit_id == ProductUnit.id)
        .join(PriceList, PriceList.id == Price.price_list_id)
        .where(
            ProductUnit.product_id == Product.id,
            ProductUnit.is_active.is_(True),
            Price.price_list_id.in_(list_ids),
            PriceList.is_active.is_(True),
            Price.valid_from <= now,
            (Price.valid_to.is_(None) | (Price.valid_to > now)),
        )
        .exists()
    )
    count, rows = await query.fetch(
        session,
        select(Product).where(Product.company_id == partner.company_id, Product.is_active.is_(True), priced_unit),
        tie_breaker=Product.id,
    )
    result: list[CatalogProduct] = []
    for row in rows:
        product = row[0]
        stock = await session.get(Stock, product.id)
        units: list[CatalogUnit] = []
        for unit in await session.scalars(
            select(ProductUnit)
            .where(ProductUnit.product_id == product.id, ProductUnit.is_active.is_(True))
            .order_by(ProductUnit.is_base.desc(), ProductUnit.id)
        ):
            price = await pricing.resolve(session, terms.price_list_id, unit.id, now)
            if price is not None:
                units.append(
                    CatalogUnit(
                        id=unit.id,
                        code=unit.code,
                        name=unit.name,
                        coefficient=unit.coefficient,
                        allow_fraction=unit.allow_fraction,
                        min_order_qty=unit.min_order_qty,
                        price=price,
                        availability_status=availability(stock),
                    )
                )
        if units:
            result.append(
                CatalogProduct(
                    id=product.id,
                    name=product.name,
                    sku=product.sku,
                    barcode=product.barcode,
                    description=product.description,
                    category_id=product.category_id,
                    image_file_id=product.image_file_id,
                    base_unit=product.base_unit,
                    units=units,
                )
            )
    return Page[CatalogProduct].of(query.page, count, result)
