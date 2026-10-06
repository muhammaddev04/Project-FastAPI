from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.errors import AppError
from app.core.events import DomainEvent, event_bus
from app.core.time import new_id, utcnow
from app.modules.catalog.models import Category, Price, PriceList, Product, ProductUnit
from app.modules.catalog.schemas import CategoryIn, CategoryPatch, PriceIn, ProductIn, ProductPatch, UnitIn
from app.modules.files.service import get_owned
from app.modules.identity.deps import OrgContext
from app.modules.identity.team_service import lock_org
from app.modules.subscriptions import service as subscriptions
from app.modules.subscriptions.domain import LimitKind, SubAction


async def get_owned_entity[Owned: (Category, Product, PriceList)](
    session: AsyncSession, model: type[Owned], company_id: UUID, entity_id: UUID, *, lock: bool = False
) -> Owned:
    query = select(model).where(model.id == entity_id, model.company_id == company_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    entity = (await session.scalars(query)).one_or_none()
    if entity is None:
        raise AppError("not_found", 404)
    return entity


async def writable(session: AsyncSession, context: OrgContext) -> None:
    if context.organization.type != "COMPANY":
        raise AppError("permission_denied", 403)
    await lock_org(session, context.organization.id)
    await subscriptions.guard.require(session, context.organization.id, SubAction.CATALOG_WRITE)


def version(entity: Category | Product | PriceList, expected: int) -> None:
    if entity.version != expected:
        raise AppError("version_conflict", 409, {"current_version": entity.version})


async def logged(
    session: AsyncSession,
    context: OrgContext,
    action: str,
    entity: Category | Product | ProductUnit | PriceList | Price,
    *,
    old: dict[str, Any] | None = None,
    new: dict[str, Any] | None = None,
    event: str | None = None,
) -> None:
    await session.flush()
    await audit.record(
        session,
        action,
        entity.__tablename__,
        entity.id,
        actor_id=context.user.id,
        org_id=context.organization.id,
        old=old,
        new=new,
    )
    if event:
        await event_bus.publish(
            session,
            DomainEvent(
                event,
                {"id": str(entity.id), "company_id": str(context.organization.id)},
                org_id=context.organization.id,
            ),
        )


async def validate_category(session: AsyncSession, company_id: UUID, category_id: UUID | None) -> None:
    if category_id:
        category = await get_owned_entity(session, Category, company_id, category_id)
        if not category.is_active:
            raise AppError("validation_error", 422, {"field": "category_id", "reason": "inactive"})


async def validate_parent(
    session: AsyncSession, company_id: UUID, parent_id: UUID | None, category_id: UUID | None = None
) -> None:
    if not parent_id:
        return
    parent = await get_owned_entity(session, Category, company_id, parent_id)
    if parent_id == category_id or parent.parent_id or not parent.is_active:
        raise AppError("validation_error", 422, {"field": "parent_id", "reason": "category_depth"})
    if category_id and await session.scalar(select(Category.id).where(Category.parent_id == category_id).limit(1)):
        raise AppError("validation_error", 422, {"field": "parent_id", "reason": "category_depth"})


async def create_category(session: AsyncSession, context: OrgContext, payload: CategoryIn) -> Category:
    await writable(session, context)
    await validate_parent(session, context.organization.id, payload.parent_id)
    category = Category(company_id=context.organization.id, **payload.model_dump())
    session.add(category)
    await logged(session, context, "category.created", category)
    return category


async def update_category(
    session: AsyncSession, context: OrgContext, category_id: UUID, payload: CategoryPatch
) -> Category:
    await writable(session, context)
    category = await get_owned_entity(session, Category, context.organization.id, category_id, lock=True)
    version(category, payload.version)
    changes = payload.model_dump(exclude_unset=True, exclude={"version"})
    if "parent_id" in changes:
        await validate_parent(session, context.organization.id, payload.parent_id, category_id)
    if changes.get("is_active") is False:
        has_products = await session.scalar(select(Product.id).where(Product.category_id == category_id).limit(1))
        has_children = await session.scalar(
            select(Category.id).where(Category.parent_id == category_id, Category.is_active.is_(True)).limit(1)
        )
        if has_products or has_children:
            raise AppError("category_not_empty", 409)
    for key, value in changes.items():
        setattr(category, key, value)
    category.version += 1
    await logged(session, context, "category.updated", category, new=changes)
    return category


class ProductUsage:
    async def count(self, session: AsyncSession, company_id: UUID, kind: LimitKind) -> int:
        if kind == LimitKind.PRODUCTS:
            return int(
                await session.scalar(
                    select(func.count())
                    .select_from(Product)
                    .where(Product.company_id == company_id, Product.is_active.is_(True))
                )
                or 0
            )
        if kind == LimitKind.ACTIVE_STORES:
            from app.modules.partnerships.service import active_store_count

            return await active_store_count(session, company_id)
        return 0


class UsageReferences(Protocol):
    async def has_activity(self, session: AsyncSession, product_id: UUID) -> bool: ...


class FutureReferences:
    async def has_activity(self, session: AsyncSession, product_id: UUID) -> bool:
        # P05/P07 install implementations when stock movements/order items exist.
        return False


references: UsageReferences = FutureReferences()


async def create_product(session: AsyncSession, context: OrgContext, payload: ProductIn) -> Product:
    await writable(session, context)
    await validate_category(session, context.organization.id, payload.category_id)
    if payload.image_file_id:
        image = await get_owned(session, context.organization.id, payload.image_file_id)
        if image.category != "PRODUCT_IMAGE":
            raise AppError("validation_error", 422, {"field": "image_file_id"})
    if payload.is_active:
        await subscriptions.guard.check_limit(session, context.organization.id, "products")
    product = Product(company_id=context.organization.id, created_by=context.user.id, **payload.model_dump())
    session.add(product)
    await session.flush()
    session.add(
        ProductUnit(
            product_id=product.id,
            code=product.base_unit,
            name={lang: product.base_unit for lang in ("tg", "ru", "en")},
            coefficient=Decimal(1),
            is_base=True,
            allow_fraction=product.base_unit in {"KG", "G", "L", "ML", "M"},
        )
    )
    await logged(session, context, "product.created", product, event="PRODUCT_CREATED")
    return product


async def update_product(
    session: AsyncSession, context: OrgContext, product_id: UUID, payload: ProductPatch
) -> Product:
    await writable(session, context)
    product = await get_owned_entity(session, Product, context.organization.id, product_id, lock=True)
    version(product, payload.version)
    changes = payload.model_dump(exclude_unset=True, exclude={"version"})
    if "category_id" in changes:
        await validate_category(session, context.organization.id, payload.category_id)
    if payload.image_file_id:
        image = await get_owned(session, context.organization.id, payload.image_file_id)
        if image.category != "PRODUCT_IMAGE":
            raise AppError("validation_error", 422, {"field": "image_file_id"})
    if changes.get("is_active") is True and not product.is_active:
        await subscriptions.guard.check_limit(session, context.organization.id, "products")
    if payload.base_unit and payload.base_unit != product.base_unit:
        units = list(await session.scalars(select(ProductUnit).where(ProductUnit.product_id == product.id)))
        priced = await session.scalar(
            select(Price.id).where(Price.product_unit_id.in_([unit.id for unit in units])).limit(1)
        )
        if await references.has_activity(session, product.id) or priced or len(units) > 1:
            raise AppError("base_unit_immutable", 409)
        # Recreate the unused base unit; its code/coefficient are never updated.
        await session.delete(units[0])
        await session.flush()
        session.add(
            ProductUnit(
                product_id=product.id,
                code=payload.base_unit,
                name={lang: payload.base_unit for lang in ("tg", "ru", "en")},
                coefficient=Decimal(1),
                is_base=True,
                allow_fraction=payload.base_unit in {"KG", "G", "L", "ML", "M"},
            )
        )
    previous = product.is_active
    for key, value in changes.items():
        setattr(product, key, value)
    product.version += 1
    action = (
        "product.updated"
        if product.is_active == previous
        else "product.activated"
        if product.is_active
        else "product.deactivated"
    )
    await logged(
        session,
        context,
        action,
        product,
        new={key: str(value) if isinstance(value, UUID) else value for key, value in changes.items()},
        event="PRODUCT_DEACTIVATED" if previous and not product.is_active else None,
    )
    return product


async def create_unit(session: AsyncSession, context: OrgContext, product_id: UUID, payload: UnitIn) -> ProductUnit:
    await writable(session, context)
    await get_owned_entity(session, Product, context.organization.id, product_id, lock=True)
    unit = ProductUnit(product_id=product_id, **payload.model_dump())
    session.add(unit)
    await logged(session, context, "unit.created", unit)
    return unit


async def unit_owned(session: AsyncSession, company_id: UUID, unit_id: UUID) -> ProductUnit:
    unit = await session.scalar(
        select(ProductUnit).join(Product).where(ProductUnit.id == unit_id, Product.company_id == company_id)
    )
    if unit is None:
        raise AppError("not_found", 404)
    return unit


async def default_list(session: AsyncSession, company_id: UUID) -> PriceList:
    await session.execute(
        insert(PriceList)
        .values(id=new_id(), company_id=company_id, code="DEFAULT", name="Default", is_default=True)
        .on_conflict_do_nothing(index_elements=["company_id", "code"])
    )
    result = await session.scalar(
        select(PriceList).where(PriceList.company_id == company_id, PriceList.is_default.is_(True))
    )
    assert result is not None
    return result


async def set_price(session: AsyncSession, context: OrgContext, payload: PriceIn) -> Price:
    await writable(session, context)
    price_list = await get_owned_entity(session, PriceList, context.organization.id, payload.price_list_id, lock=True)
    unit = await unit_owned(session, context.organization.id, payload.product_unit_id)
    if not price_list.is_active or not unit.is_active:
        raise AppError("validation_error", 422, {"reason": "inactive"})
    now = utcnow()
    starts = payload.valid_from or now
    if payload.valid_from and starts < now:
        raise AppError("validation_error", 422, {"field": "valid_from", "reason": "past"})
    current = await session.scalar(
        select(Price)
        .where(Price.price_list_id == price_list.id, Price.product_unit_id == unit.id, Price.valid_to.is_(None))
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if current:
        if current.valid_from > now:
            raise AppError("price_overlap", 409, {"reason": "cancel_future_first"})
        current.valid_to = starts
        await session.flush()
    price = Price(
        price_list_id=price_list.id,
        product_unit_id=unit.id,
        price=payload.price,
        valid_from=starts,
        created_by=context.user.id,
    )
    session.add(price)
    await logged(
        session,
        context,
        "price.set",
        price,
        old={"price": str(current.price)} if current else None,
        new={"price": str(payload.price), "valid_from": starts.isoformat()},
        event="PRICE_CHANGED",
    )
    return price


async def cancel_price(session: AsyncSession, context: OrgContext, price_id: UUID) -> None:
    await writable(session, context)
    target = await session.scalar(
        select(Price).join(PriceList).where(Price.id == price_id, PriceList.company_id == context.organization.id)
    )
    if target is None:
        raise AppError("not_found", 404)
    await get_owned_entity(session, PriceList, context.organization.id, target.price_list_id, lock=True)
    await session.refresh(target)
    if target.valid_from <= utcnow():
        raise AppError("price_immutable", 409)
    previous = await session.scalar(
        select(Price)
        .where(
            Price.price_list_id == target.price_list_id,
            Price.product_unit_id == target.product_unit_id,
            Price.valid_to == target.valid_from,
        )
        .with_for_update()
    )
    await logged(session, context, "price.cancelled", target)
    await session.delete(target)
    await session.flush()
    if previous:
        previous.valid_to = None
        await session.flush()


async def resolve(session: AsyncSession, price_list_id: UUID, product_unit_id: UUID, at: datetime) -> Decimal | None:
    price_list = await session.get(PriceList, price_list_id)
    if price_list is None:
        return None
    unit = await session.scalar(
        select(ProductUnit)
        .join(Product)
        .where(
            ProductUnit.id == product_unit_id,
            Product.company_id == price_list.company_id,
            Product.is_active.is_(True),
            ProductUnit.is_active.is_(True),
        )
    )
    if unit is None:
        return None
    fallback = await session.scalar(
        select(PriceList.id).where(PriceList.company_id == price_list.company_id, PriceList.is_default.is_(True))
    )
    for list_id in dict.fromkeys([price_list_id, fallback]):
        value = await session.scalar(
            select(Price.price)
            .join(PriceList)
            .where(
                Price.price_list_id == list_id,
                PriceList.is_active.is_(True),
                Price.product_unit_id == product_unit_id,
                Price.valid_from <= at,
                (Price.valid_to.is_(None) | (Price.valid_to > at)),
            )
        )
        if value is not None:
            return value
    return None


def install() -> None:
    subscriptions.usage_port = ProductUsage()
