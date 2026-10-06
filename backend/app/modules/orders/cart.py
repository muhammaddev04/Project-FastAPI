from decimal import Decimal
from typing import Literal
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.time import utcnow
from app.modules.catalog import service as pricing
from app.modules.catalog.models import Product, ProductUnit
from app.modules.identity.deps import OrgContext
from app.modules.inventory.models import Stock
from app.modules.orders import service
from app.modules.orders.models import Cart, CartItem, Order
from app.modules.orders.schemas import CartLine, CartOut, ItemIn
from app.modules.partnerships import service as partners


async def personal(session: AsyncSession, ctx: OrgContext, partnership_id: UUID) -> Cart:
    partners.require(ctx, "cart.manage", "STORE")
    await partners.locked(session, ctx, partnership_id)
    await session.execute(
        insert(Cart)
        .values(partnership_id=partnership_id, user_id=ctx.user.id, updated_at=utcnow())
        .on_conflict_do_nothing(index_elements=[Cart.partnership_id, Cart.user_id])
    )
    return (
        await session.scalars(
            select(Cart)
            .where(Cart.partnership_id == partnership_id, Cart.user_id == ctx.user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).one()


def availability(stock: Stock | None) -> Literal["IN_STOCK", "LOW", "OUT_OF_STOCK"]:
    if stock is None or stock.available <= 0:
        return "OUT_OF_STOCK"
    return (
        "LOW" if stock.low_stock_threshold is not None and stock.available < stock.low_stock_threshold else "IN_STOCK"
    )


async def view(session: AsyncSession, ctx: OrgContext, partnership_id: UUID) -> CartOut:
    cart = await personal(session, ctx, partnership_id)
    partner = await partners.get(session, ctx, partnership_id)
    terms = await service.current_terms(session, partnership_id)
    rows = (
        await session.execute(
            select(CartItem, ProductUnit, Product)
            .join(ProductUnit, CartItem.product_unit_id == ProductUnit.id)
            .join(Product, ProductUnit.product_id == Product.id)
            .where(CartItem.cart_id == cart.id)
            .order_by(CartItem.added_at, CartItem.id)
        )
    ).all()
    lines: list[CartLine] = []
    warnings: list[dict[str, str]] = []
    for item, unit, product in rows:
        price = await pricing.resolve(session, terms.price_list_id, unit.id, utcnow())
        orderable = (
            product.company_id == partner.company_id and product.is_active and unit.is_active and price is not None
        )
        try:
            service.check_quantity(item.quantity, unit.allow_fraction, unit.min_order_qty, positive=True)
        except AppError:
            orderable = False
        if not orderable:
            warnings.append({"code": "product_not_orderable", "product_unit_id": str(unit.id)})
        stock = await session.get(Stock, product.id)
        lines.append(
            CartLine(
                product_unit_id=unit.id,
                product_name=product.name,
                unit_code=unit.code,
                quantity=item.quantity,
                allow_fraction=unit.allow_fraction,
                min_order_qty=unit.min_order_qty,
                price=price,
                line_total=service.q2(item.quantity * price) if price is not None else service.ZERO,
                availability_status=availability(stock),
                orderable=orderable,
            )
        )
    subtotal = sum((line.line_total for line in lines), service.ZERO)
    if subtotal < terms.minimum_order_amount:
        warnings.append({"code": "minimum_order_not_met"})
    if partner.status != "ACTIVE":
        warnings.append({"code": "partnership_not_active"})
    return CartOut(
        partnership_id=partnership_id,
        items=lines,
        subtotal=subtotal,
        delivery_fee=service.fee(terms, subtotal),
        minimum_order_amount=terms.minimum_order_amount,
        warnings=warnings,
    )


async def put(
    session: AsyncSession, ctx: OrgContext, partnership_id: UUID, unit_id: UUID, quantity: Decimal
) -> CartOut:
    cart = await personal(session, ctx, partnership_id)
    partner = await partners.get(session, ctx, partnership_id)
    if quantity > 0:
        partners.require_active(partner)
        _, unit, _ = await service.orderable(session, partner, unit_id, utcnow())
        service.check_quantity(quantity, unit.allow_fraction, unit.min_order_qty, positive=True)
        count = len(list(await session.scalars(select(CartItem.product_unit_id).where(CartItem.cart_id == cart.id))))
        existing = await session.scalar(
            select(CartItem).where(CartItem.cart_id == cart.id, CartItem.product_unit_id == unit_id)
        )
        if count >= 200 and existing is None:
            raise AppError("validation_error", 422, {"field": "items", "max_length": 200})
        await session.execute(
            insert(CartItem)
            .values(cart_id=cart.id, product_unit_id=unit_id, quantity=quantity, added_at=utcnow())
            .on_conflict_do_update(
                index_elements=[CartItem.cart_id, CartItem.product_unit_id], set_={"quantity": quantity}
            )
        )
    else:
        await session.execute(delete(CartItem).where(CartItem.cart_id == cart.id, CartItem.product_unit_id == unit_id))
    cart.updated_at = utcnow()
    await session.flush()
    return await view(session, ctx, partnership_id)


async def clear(session: AsyncSession, ctx: OrgContext, partnership_id: UUID) -> None:
    cart = await personal(session, ctx, partnership_id)
    await session.execute(delete(CartItem).where(CartItem.cart_id == cart.id))
    cart.updated_at = utcnow()


async def checkout(session: AsyncSession, ctx: OrgContext, partnership_id: UUID, note: str | None) -> Order:
    cart = await personal(session, ctx, partnership_id)
    rows = list(
        await session.scalars(select(CartItem).where(CartItem.cart_id == cart.id).order_by(CartItem.product_unit_id))
    )
    order = await service.order_service.create(
        session,
        ctx,
        partnership_id,
        [ItemIn(product_unit_id=row.product_unit_id, quantity=row.quantity) for row in rows],
        note,
        source="STORE",
    )
    await session.execute(delete(CartItem).where(CartItem.cart_id == cart.id))
    cart.updated_at = utcnow()
    return order


async def repeat(session: AsyncSession, ctx: OrgContext, order_id: UUID) -> CartOut:
    partners.require(ctx, "cart.manage", "STORE")
    order = await service.get(session, ctx, order_id)
    cart = await personal(session, ctx, order.partnership_id)
    partner = await partners.get(session, ctx, order.partnership_id)
    partners.require_active(partner)
    warnings: list[dict[str, str]] = []
    for row in await service.items(session, order.id):
        try:
            async with session.begin_nested():
                _, unit, _ = await service.orderable(session, partner, row.product_unit_id, utcnow())
                existing = await session.scalar(
                    select(CartItem.quantity).where(CartItem.cart_id == cart.id, CartItem.product_unit_id == unit.id)
                )
                await put(
                    session, ctx, order.partnership_id, unit.id, (existing or service.ZERO) + row.requested_quantity
                )
        except AppError as exc:
            if exc.code not in {"product_not_orderable", "quantity_invalid", "validation_error"}:
                raise
            warnings.append({"code": exc.code, "product_unit_id": str(row.product_unit_id)})
    result = await view(session, ctx, order.partnership_id)
    result.warnings.extend(warnings)
    return result
