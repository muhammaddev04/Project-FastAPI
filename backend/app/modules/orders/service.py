"""P07: one transactional writer for orders; company locks precede partnership/order/stock locks."""

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.errors import AppError
from app.core.events import DomainEvent, event_bus
from app.core.sequences import SequenceService
from app.core.time import new_id, utcnow
from app.modules.catalog import service as pricing
from app.modules.catalog.models import Product, ProductUnit
from app.modules.identity.deps import OrgContext
from app.modules.identity.team_service import lock_org
from app.modules.inventory.service import SourceRef, stock_service
from app.modules.orders import ports
from app.modules.orders.models import Order, OrderItem, OrderStatusHistory
from app.modules.orders.schemas import ConfirmationPreview, ConfirmIn, CreditOut, ItemIn, PreviewLine
from app.modules.organizations.models import Store
from app.modules.partnerships import service as partners
from app.modules.partnerships.models import Partnership, PartnershipTerms
from app.modules.partnerships.schemas import TermsOut
from app.modules.subscriptions import service as subscriptions
from app.modules.subscriptions.domain import SubAction

ZERO = Decimal("0")
EARLY = {"NEW", "VIEWED"}
RESERVED = {"CONFIRMED", "PARTIALLY_CONFIRMED", "ASSEMBLING", "READY_FOR_DELIVERY", "DELIVERY_FAILED"}
WAREHOUSE_STATUSES = RESERVED | {"IN_TRANSIT", "DELIVERED", "DISPUTED", "COMPLETED"}
TRANSITIONS: dict[str, set[str]] = {
    "view": {"NEW"},
    "confirm": EARLY,
    "partial": EARLY,
    "reject": EARLY,
    "cancel": EARLY | RESERVED,
    "assemble": {"CONFIRMED", "PARTIALLY_CONFIRMED"},
    "ready": {"ASSEMBLING"},
    "reattempt": {"DELIVERY_FAILED"},
    "dispatch": {"READY_FOR_DELIVERY"},
    "deliver": {"IN_TRANSIT"},
    "fail": {"IN_TRANSIT"},
    "dispute": {"DELIVERED"},
    "complete": {"DELIVERED", "DISPUTED"},
    "terminate": EARLY,
}
TARGETS = {
    "view": "VIEWED",
    "confirm": "CONFIRMED",
    "partial": "PARTIALLY_CONFIRMED",
    "reject": "REJECTED",
    "cancel": "CANCELLED",
    "assemble": "ASSEMBLING",
    "ready": "READY_FOR_DELIVERY",
    "reattempt": "READY_FOR_DELIVERY",
    "dispatch": "IN_TRANSIT",
    "deliver": "DELIVERED",
    "fail": "DELIVERY_FAILED",
    "dispute": "DISPUTED",
    "complete": "COMPLETED",
    "terminate": "CANCELLED",
}
EVENTS = {
    "NEW": "ORDER_CREATED",
    "CONFIRMED": "ORDER_CONFIRMED",
    "PARTIALLY_CONFIRMED": "ORDER_CONFIRMED",
    "REJECTED": "ORDER_REJECTED",
    "CANCELLED": "ORDER_CANCELLED",
    "ASSEMBLING": "ORDER_ASSEMBLING",
    "READY_FOR_DELIVERY": "ORDER_READY",
    "IN_TRANSIT": "ORDER_DISPATCHED",
    "DELIVERED": "ORDER_DELIVERED",
    "DELIVERY_FAILED": "ORDER_DELIVERY_FAILED",
    "DISPUTED": "ORDER_DISPUTED",
    "COMPLETED": "ORDER_COMPLETED",
}


@dataclass(frozen=True)
class SystemActor:
    source: Literal["DELIVERY", "DISPUTE", "COMPLETION", "PARTNERSHIP"]


def q2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def q3(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def amount(value: Decimal) -> Decimal:
    if not value.is_finite() or value < 0 or value > Decimal("9999999999.99"):
        raise AppError("validation_error", 422, {"field": "amount", "reason": "out_of_range"})
    return q2(value)


def check_quantity(value: Decimal, fraction: bool, minimum: Decimal = ZERO, *, positive: bool = False) -> None:
    if (
        not value.is_finite()
        or value < minimum
        or value < 0
        or value > Decimal("99999999999.999")
        or q3(value) != value
        or (positive and value <= 0)
        or (not fraction and value != value.to_integral_value())
    ):
        raise AppError("quantity_invalid", 422)


def fee(terms: PartnershipTerms, subtotal: Decimal) -> Decimal:
    return (
        ZERO
        if terms.free_delivery_threshold is not None and subtotal >= terms.free_delivery_threshold
        else terms.delivery_fee
    )


async def current_terms(session: AsyncSession, partnership_id: UUID) -> PartnershipTerms:
    terms = await partners.terms_service.current(session, partnership_id)
    if terms is None:
        raise AppError("product_not_orderable", 409, {"reason": "no_effective_terms"})
    return terms


async def get(session: AsyncSession, ctx: OrgContext, order_id: UUID) -> Order:
    partners.require(ctx, "orders.view")
    column = Order.company_id if ctx.organization.type == "COMPANY" else Order.store_id
    query = select(Order).where(Order.id == order_id, column == ctx.organization.id)
    if ctx.membership.role == "WAREHOUSE":
        query = query.where(Order.status.in_(WAREHOUSE_STATUSES))
    order = await session.scalar(query)
    if order is None:
        raise AppError("not_found", 404)
    return order


async def items(session: AsyncSession, order_id: UUID) -> list[OrderItem]:
    return list(await session.scalars(select(OrderItem).where(OrderItem.order_id == order_id).order_by(OrderItem.id)))


async def locked(session: AsyncSession, order: Order) -> Order:
    await lock_org(session, order.company_id)
    await subscriptions.get_subscription(session, company_id=order.company_id, lock=True)
    await session.execute(select(Partnership).where(Partnership.id == order.partnership_id).with_for_update())
    result = (
        await session.scalars(
            select(Order).where(Order.id == order.id).with_for_update().execution_options(populate_existing=True)
        )
    ).one()
    return result


def version(order: Order, expected: int) -> None:
    if order.version != expected:
        raise AppError("version_conflict", 409, {"current_version": order.version})


def transition_allowed(order: Order, action: str) -> None:
    if order.status not in TRANSITIONS[action]:
        raise AppError("invalid_transition", 409)


async def _apply_transition(
    session: AsyncSession,
    order: Order,
    target: str,
    actor: OrgContext | SystemActor,
    reason: str | None = None,
    *,
    initial: bool = False,
) -> None:
    before = None if initial else order.status
    order.status = target
    if not initial:
        order.version += 1
    actor_id = actor.user.id if isinstance(actor, OrgContext) else None
    session.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=before,
            to_status=target,
            actor_id=actor_id,
            actor_type="USER" if actor_id else "SYSTEM",
            reason=reason,
            details={"system": actor.source} if isinstance(actor, SystemActor) else {},
        )
    )
    await session.flush()
    await audit.record(
        session,
        "order.created" if initial else "order.transition",
        "orders",
        order.id,
        actor_id=actor_id,
        org_id=order.company_id,
        old={"status": before} if before else None,
        new={"status": target},
        reason=reason,
    )
    if target in EVENTS:
        await event_bus.publish(
            session,
            DomainEvent(
                EVENTS[target],
                {
                    "order_id": str(order.id),
                    "order_number": order.order_number,
                    "company_id": str(order.company_id),
                    "store_id": str(order.store_id),
                    "partnership_id": str(order.partnership_id),
                    "status": target,
                    "total": str(order.total) if order.total is not None else None,
                    "partial": target == "PARTIALLY_CONFIRMED",
                },
                org_id=order.company_id,
            ),
        )


async def orderable(
    session: AsyncSession, partner: Partnership, unit_id: UUID, at: datetime
) -> tuple[Product, ProductUnit, Decimal]:
    row = (
        await session.execute(
            select(Product, ProductUnit)
            .join(ProductUnit)
            .where(
                Product.company_id == partner.company_id,
                ProductUnit.id == unit_id,
                Product.is_active.is_(True),
                ProductUnit.is_active.is_(True),
            )
            .with_for_update(read=True)
        )
    ).one_or_none()
    if row is None:
        raise AppError("product_not_orderable", 422, {"product_unit_id": str(unit_id)})
    product, unit = row
    terms = await current_terms(session, partner.id)
    price = await pricing.resolve(session, terms.price_list_id, unit_id, at)
    if price is None:
        raise AppError("product_not_orderable", 422, {"product_unit_id": str(unit_id)})
    return product, unit, price


class OrderService:
    async def reject(self, session: AsyncSession, ctx: OrgContext, order_id: UUID, reason: str, expected: int) -> Order:
        return await self.action(session, ctx, order_id, "reject", expected, reason)

    async def cancel(self, session: AsyncSession, ctx: OrgContext, order_id: UUID, reason: str, expected: int) -> Order:
        return await self.action(session, ctx, order_id, "cancel", expected, reason)

    async def start_assembling(self, session: AsyncSession, ctx: OrgContext, order_id: UUID, expected: int) -> Order:
        return await self.action(session, ctx, order_id, "assemble", expected)

    async def mark_ready(self, session: AsyncSession, ctx: OrgContext, order_id: UUID, expected: int) -> Order:
        return await self.action(session, ctx, order_id, "ready", expected)

    async def reattempt(self, session: AsyncSession, ctx: OrgContext, order_id: UUID, expected: int) -> Order:
        return await self.action(session, ctx, order_id, "reattempt", expected)

    async def dispatch(self, session: AsyncSession, actor: SystemActor, order_id: UUID) -> Order:
        return await self.system(session, actor, order_id, "dispatch")

    async def deliver(self, session: AsyncSession, actor: SystemActor, order_id: UUID, delivered_at: datetime) -> Order:
        return await self.system(session, actor, order_id, "deliver", delivered_at=delivered_at)

    async def fail_delivery(self, session: AsyncSession, actor: SystemActor, order_id: UUID, reason: str) -> Order:
        return await self.system(session, actor, order_id, "fail", reason=reason)

    async def mark_disputed(self, session: AsyncSession, actor: SystemActor, order_id: UUID) -> Order:
        return await self.system(session, actor, order_id, "dispute")

    async def complete(self, session: AsyncSession, actor: SystemActor, order_id: UUID) -> Order:
        return await self.system(session, actor, order_id, "complete")

    async def create(
        self,
        session: AsyncSession,
        ctx: OrgContext,
        partnership_id: UUID,
        lines: list[ItemIn],
        note: str | None,
        *,
        source: Literal["STORE", "COMPANY_ON_BEHALF"],
    ) -> Order:
        partners.require(ctx, "orders.create", "STORE" if source == "STORE" else "COMPANY")
        # Orders permission is independent of partners.view (e.g. warehouse), but creators have both.
        partner = await partners.locked(session, ctx, partnership_id)
        partners.require_active(partner)
        await subscriptions.guard.require(session, partner.company_id, SubAction.NEW_ORDER)
        terms = await current_terms(session, partner.id)
        merged: dict[UUID, Decimal] = {}
        if not lines or len(lines) > 200:
            raise AppError("validation_error", 422, {"field": "items"})
        for line in lines:
            merged[line.product_unit_id] = merged.get(line.product_unit_id, ZERO) + line.quantity
        snapshots: list[OrderItem] = []
        now = utcnow()
        for unit_id in sorted(merged):
            product, unit, price = await orderable(session, partner, unit_id, now)
            quantity = merged[unit_id]
            check_quantity(quantity, unit.allow_fraction, unit.min_order_qty, positive=True)
            snapshots.append(
                OrderItem(
                    id=new_id(),
                    product_id=product.id,
                    product_unit_id=unit.id,
                    product_name_snapshot=product.name,
                    sku_snapshot=product.sku,
                    unit_code_snapshot=unit.code,
                    unit_name_snapshot=dict(unit.name),
                    unit_coefficient_snapshot=unit.coefficient,
                    allow_fraction_snapshot=unit.allow_fraction,
                    base_unit_snapshot=product.base_unit,
                    requested_quantity=quantity,
                    unit_price=price,
                    line_total=amount(quantity * price),
                )
            )
        subtotal = amount(sum((row.line_total for row in snapshots), ZERO))
        if subtotal < terms.minimum_order_amount:
            raise AppError(
                "minimum_order_not_met", 422, {"minimum": str(terms.minimum_order_amount), "subtotal": str(subtotal)}
            )
        store = (
            await session.scalars(select(Store).where(Store.id == partner.store_id).with_for_update(read=True))
        ).one()
        number = await SequenceService(session).next("order_number", f"{partner.company_id}:{now.year}")
        if number > 999999:
            raise AppError("validation_error", 409, {"reason": "order_number_exhausted"})
        order = Order(
            id=new_id(),
            company_id=partner.company_id,
            store_id=partner.store_id,
            partnership_id=partner.id,
            order_number=f"ORD-{now.year}-{number:06}",
            source=source,
            status="NEW",
            requested_subtotal=subtotal,
            delivery_address=store.address,
            delivery_latitude=store.latitude,
            delivery_longitude=store.longitude,
            store_note=note,
            created_by=ctx.user.id,
        )
        session.add(order)
        await session.flush()
        for row in snapshots:
            row.order_id = order.id
        session.add_all(snapshots)
        await _apply_transition(session, order, "NEW", ctx, initial=True)
        return order

    async def mark_viewed(self, session: AsyncSession, ctx: OrgContext, order_id: UUID) -> Order:
        partners.require(ctx, "orders.view", "COMPANY")
        order = await locked(session, await get(session, ctx, order_id))
        if order.status == "NEW":
            await _apply_transition(session, order, "VIEWED", ctx)
        return order

    async def confirm(self, session: AsyncSession, ctx: OrgContext, order_id: UUID, payload: ConfirmIn) -> Order:
        partners.require(ctx, "orders.confirm", "COMPANY")
        order = await locked(session, await get(session, ctx, order_id))
        version(order, payload.version)
        transition_allowed(order, "confirm")
        partner = (await session.scalars(select(Partnership).where(Partnership.id == order.partnership_id))).one()
        if partner.status not in {"ACTIVE", "SUSPENDED"}:
            raise AppError("partnership_not_active", 403)
        await subscriptions.guard.require(session, order.company_id, SubAction.ORDER_FULFILLMENT)
        rows = await items(session, order.id)
        values = {row.item_id: row.confirmed_quantity for row in payload.lines}
        if len(values) != len(payload.lines) or set(values) != {row.id for row in rows} or not any(values.values()):
            raise AppError("validation_error", 422, {"field": "lines"})
        for row in rows:
            value = values[row.id]
            check_quantity(value, row.allow_fraction_snapshot)
            if value > row.requested_quantity:
                raise AppError("quantity_invalid", 422)
        terms = await current_terms(session, order.partnership_id)
        subtotal = sum((q2(values[row.id] * row.unit_price) for row in rows), ZERO)
        if payload.discount > 0:
            partners.require(ctx, "orders.discount")
            if payload.discount > subtotal or not payload.discount_reason:
                raise AppError("validation_error", 422, {"field": "discount"})
        for field, reason in (("credit", payload.override_credit_reason), ("minimum", payload.override_minimum_reason)):
            if reason:
                partners.require(ctx, "orders.override")
                await audit.record(
                    session,
                    f"order.{field}_override",
                    "orders",
                    order.id,
                    actor_id=ctx.user.id,
                    org_id=order.company_id,
                    reason=reason,
                )
        if subtotal < terms.minimum_order_amount and not payload.override_minimum_reason:
            raise AppError(
                "minimum_order_not_met", 422, {"minimum": str(terms.minimum_order_amount), "subtotal": str(subtotal)}
            )
        delivery_fee = fee(terms, subtotal)
        total = amount(subtotal - payload.discount + delivery_fee)
        credit = await ports.credit.check(session, order.partnership_id, total)
        if not credit.allowed and not payload.override_credit_reason:
            raise AppError("credit_limit_exceeded", 409, {key: str(value) for key, value in asdict(credit).items()})
        await stock_service.reserve(
            session,
            order.company_id,
            [
                (row.product_id, q3(values[row.id] * row.unit_coefficient_snapshot))
                for row in rows
                if values[row.id] > 0
            ],
            SourceRef(order.company_id, order.id),
            ctx.user.id,
        )
        for row in rows:
            row.confirmed_quantity = values[row.id]
            row.line_total = q2(row.confirmed_quantity * row.unit_price)
        order.terms_id = terms.id
        order.terms_snapshot = TermsOut.model_validate(terms).model_dump(mode="json")
        order.subtotal, order.discount, order.discount_reason = subtotal, payload.discount, payload.discount_reason
        order.delivery_fee, order.total = delivery_fee, total
        order.company_note = payload.company_note
        order.credit_override_reason = payload.override_credit_reason
        order.minimum_override_reason = payload.override_minimum_reason
        order.confirmed_by, order.confirmed_at = ctx.user.id, utcnow()
        if payload.discount:
            await audit.record(
                session,
                "order.discount_applied",
                "orders",
                order.id,
                actor_id=ctx.user.id,
                org_id=order.company_id,
                new={"discount": str(payload.discount)},
                reason=payload.discount_reason,
            )
        partial = any(values[row.id] < row.requested_quantity for row in rows)
        await _apply_transition(session, order, TARGETS["partial" if partial else "confirm"], ctx)
        return order

    async def action(
        self,
        session: AsyncSession,
        ctx: OrgContext,
        order_id: UUID,
        action: Literal["reject", "cancel", "assemble", "ready", "reattempt"],
        expected: int,
        reason: str | None = None,
    ) -> Order:
        permission = {
            "reject": "orders.reject",
            "cancel": "orders.cancel",
            "assemble": "orders.assemble",
            "ready": "orders.assemble",
            "reattempt": "orders.reattempt",
        }[action]
        partners.require(ctx, permission)
        order = await locked(session, await get(session, ctx, order_id))
        version(order, expected)
        if action == "cancel" and order.status == "IN_TRANSIT":
            raise AppError("cancellation_not_allowed", 409)
        transition_allowed(order, action)
        if ctx.organization.type == "STORE":
            if (
                action != "cancel"
                or order.status not in EARLY
                or (ctx.membership.role == "SELLER" and order.created_by != ctx.user.id)
            ):
                raise AppError("cancellation_not_allowed", 403)
        elif action in {"assemble", "ready", "reattempt"}:
            await subscriptions.guard.require(session, order.company_id, SubAction.ORDER_FULFILLMENT)
        if action in {"reject", "cancel"} and not (reason and reason.strip()):
            raise AppError("validation_error", 422, {"field": "reason"})
        if action == "cancel":
            if order.status in RESERVED:
                await ports.delivery_cancellation.cancel_for_order(session, order.id)
                await stock_service.release(session, SourceRef(order.company_id, order.id), ctx.user.id, reason)
            order.cancelled_at, order.cancel_reason = utcnow(), reason
        if action == "reject":
            order.rejection_reason = reason
        await _apply_transition(session, order, TARGETS[action], ctx, reason)
        return order

    async def system(
        self,
        session: AsyncSession,
        actor: SystemActor,
        order_id: UUID,
        action: Literal["dispatch", "deliver", "fail", "dispute", "complete", "terminate"],
        *,
        reason: str | None = None,
        delivered_at: datetime | None = None,
    ) -> Order:
        allowed = {
            "DELIVERY": {"dispatch", "deliver", "fail"},
            "DISPUTE": {"dispute", "complete"},
            "COMPLETION": {"complete"},
            "PARTNERSHIP": {"terminate"},
        }
        if not isinstance(actor, SystemActor) or action not in allowed[actor.source]:
            raise AppError("permission_denied", 403)
        raw = await session.get(Order, order_id)
        if raw is None:
            raise AppError("not_found", 404)
        order = await locked(session, raw)
        transition_allowed(order, action)
        if action == "fail" and not (reason and reason.strip()):
            raise AppError("validation_error", 422, {"field": "reason"})
        if action == "complete":
            if actor.source == "COMPLETION":
                deadline = (
                    order.delivered_at
                    + timedelta(hours=int((order.terms_snapshot or {}).get("dispute_window_hours", 48)))
                    if order.delivered_at
                    else None
                )
                if order.status != "DELIVERED" or deadline is None or deadline > utcnow():
                    raise AppError("invalid_transition", 409)
            elif order.status != "DISPUTED":
                raise AppError("invalid_transition", 409)
            if await ports.open_dispute.has_open(session, order.id):
                raise AppError("invalid_transition", 409)
            order.completed_at = utcnow()
        if action == "deliver":
            if delivered_at is not None and (delivered_at.tzinfo is None or delivered_at > utcnow()):
                raise AppError("validation_error", 422, {"field": "delivered_at"})
            await stock_service.ship(session, SourceRef(order.company_id, order.id), None)
            order.delivered_at = delivered_at or utcnow()
        if action == "terminate":
            order.cancelled_at, order.cancel_reason = utcnow(), reason
        await _apply_transition(session, order, TARGETS[action], actor, reason)
        return order

    async def preview(self, session: AsyncSession, ctx: OrgContext, order_id: UUID) -> ConfirmationPreview:
        partners.require(ctx, "orders.confirm", "COMPANY")
        order = await get(session, ctx, order_id)
        transition_allowed(order, "confirm")
        terms = await current_terms(session, order.partnership_id)
        rows = await items(session, order.id)
        stocks = await stock_service.availability(session, order.company_id, [row.product_id for row in rows])
        remaining = {key: row.available for key, row in stocks.items()}
        lines: list[PreviewLine] = []
        subtotal = ZERO
        for row in rows:
            available = max(remaining.get(row.product_id, ZERO), ZERO) / row.unit_coefficient_snapshot
            available = available.quantize(
                Decimal("0.001") if row.allow_fraction_snapshot else Decimal("1"), rounding=ROUND_DOWN
            )
            confirmed = min(available, row.requested_quantity)
            remaining[row.product_id] = remaining.get(row.product_id, ZERO) - q3(
                confirmed * row.unit_coefficient_snapshot
            )
            lines.append(PreviewLine(item_id=row.id, available=available, confirmed_quantity=confirmed))
            subtotal += q2(confirmed * row.unit_price)
        delivery_fee = fee(terms, subtotal)
        total = subtotal + delivery_fee
        return ConfirmationPreview(
            lines=lines,
            credit=CreditOut(**asdict(await ports.credit.check(session, order.partnership_id, total))),
            terms=TermsOut.model_validate(terms).model_dump(mode="json"),
            subtotal=subtotal,
            delivery_fee=delivery_fee,
            total=total,
        )

    async def cancel_open_for_partnership(self, session: AsyncSession, partnership_id: UUID, reason: str) -> None:
        ids = list(
            await session.scalars(
                select(Order.id)
                .where(Order.partnership_id == partnership_id, Order.status.in_(EARLY))
                .order_by(Order.id)
            )
        )
        for order_id in ids:
            await self.system(session, SystemActor("PARTNERSHIP"), order_id, "terminate", reason=reason)


order_service = OrderService()


async def complete_due(session: AsyncSession) -> int:
    count = 0
    ids = list(
        await session.scalars(select(Order.id).where(Order.status == "DELIVERED").order_by(Order.company_id, Order.id))
    )
    for order_id in ids:
        try:
            async with session.begin_nested():
                await order_service.system(session, SystemActor("COMPLETION"), order_id, "complete")
                count += 1
        except AppError as exc:
            if exc.code != "invalid_transition":
                raise
    return count


class PartnershipCancellation:
    async def cancel_open_orders(self, session: AsyncSession, partnership_id: UUID, reason: str) -> None:
        await order_service.cancel_open_for_partnership(session, partnership_id, reason)


class OrderNumbers:
    async def resolve(self, session: AsyncSession, company_id: UUID, source_ids: list[UUID]) -> dict[UUID, str]:
        rows = (
            await session.execute(
                select(Order.id, Order.order_number).where(Order.company_id == company_id, Order.id.in_(source_ids))
            )
        ).all()
        return {row[0]: row[1] for row in rows}


def install() -> None:
    from app.modules.inventory import ports as stock_ports
    from app.modules.partnerships import ports as partnership_ports

    stock_ports.order_numbers = OrderNumbers()
    partnership_ports.order_cancellation = PartnershipCancellation()
