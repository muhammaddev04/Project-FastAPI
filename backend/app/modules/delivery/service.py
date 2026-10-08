"""P08: one transactional writer for deliveries and runs.

Lock order matches P07 (company, then subscription, then the delivery row), so a delivery action and
the order action it triggers can never deadlock against each other. Every transition that closes a
delivery drives the order through `order_service` in the same transaction, which is what makes
DEL-015 hold: delivery, order, stock and (from P09) the charge either all land or none do.
"""

from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.db import UnitOfWork
from app.core.errors import AppError
from app.core.events import DomainEvent, event_bus
from app.core.time import utcnow
from app.modules.delivery import codes
from app.modules.delivery.models import Delivery, DeliveryRun, DeliveryStatusHistory
from app.modules.identity.deps import OrgContext
from app.modules.identity.models import Membership
from app.modules.identity.team_service import lock_org
from app.modules.orders.models import Order
from app.modules.orders.service import SystemActor, order_service
from app.modules.subscriptions import service as subscriptions
from app.modules.subscriptions.domain import SubAction

Source = Literal["ONLINE", "OFFLINE_SYNC"]

OPEN = {"PLANNED", "ASSIGNED", "IN_TRANSIT", "ARRIVED"}
#  Where the code matters: only here can a delivery still be confirmed or re-coded.
CODE_STATUSES = {"IN_TRANSIT", "ARRIVED"}
TRANSITIONS: dict[str, set[str]] = {
    "assign": {"PLANNED"},
    "unassign": {"ASSIGNED"},
    "dispatch": {"ASSIGNED"},
    "arrive": {"IN_TRANSIT"},
    "deliver": {"IN_TRANSIT", "ARRIVED"},
    "fail": {"IN_TRANSIT", "ARRIVED"},
    "cancel": {"PLANNED", "ASSIGNED"},
}
TARGETS: dict[str, str] = {
    "assign": "ASSIGNED",
    "unassign": "PLANNED",
    "dispatch": "IN_TRANSIT",
    "arrive": "ARRIVED",
    "deliver": "DELIVERED",
    "fail": "FAILED",
    "cancel": "CANCELLED",
}
EVENTS = {
    "ASSIGNED": "DELIVERY_ASSIGNED",
    "IN_TRANSIT": "DELIVERY_DISPATCHED",
    "DELIVERED": "DELIVERY_COMPLETED",
    "FAILED": "DELIVERY_FAILED",
}
#  Roles that may carry a delivery themselves; DEL-004 lets an owner or manager stand in for a courier.
COURIER_ROLES = {"COURIER", "OWNER", "MANAGER"}
FAILURE_REASONS = {"STORE_CLOSED", "REFUSED", "ADDRESS_NOT_FOUND", "NO_CONTACT", "VEHICLE_ISSUE", "OTHER"}
MANUAL_REASON_MIN = 10


@dataclass(frozen=True)
class Actor:
    """Who is driving a transition, and whether it arrived live or from a replayed offline queue."""

    ctx: OrgContext
    source: Source = "ONLINE"


def version(delivery: Delivery, expected: int) -> None:
    if delivery.version != expected:
        raise AppError("version_conflict", 409, {"current_version": delivery.version})


def transition_allowed(delivery: Delivery, action: str) -> None:
    if delivery.status not in TRANSITIONS[action]:
        raise AppError("invalid_transition", 409, {"status": delivery.status})


async def locked(session: AsyncSession, delivery: Delivery) -> Delivery:
    await lock_org(session, delivery.company_id)
    await subscriptions.get_subscription(session, company_id=delivery.company_id, lock=True)
    return (
        await session.scalars(
            select(Delivery)
            .where(Delivery.id == delivery.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).one()


async def _apply(
    session: AsyncSession,
    delivery: Delivery,
    target: str,
    actor: Actor | SystemActor,
    *,
    reason: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    before = delivery.status
    delivery.status = target
    delivery.version += 1
    stamps = {
        "ASSIGNED": "assigned_at",
        "IN_TRANSIT": "dispatched_at",
        "ARRIVED": "arrived_at",
        "DELIVERED": "delivered_at",
        "FAILED": "failed_at",
        "CANCELLED": "cancelled_at",
    }
    if target in stamps:
        setattr(delivery, stamps[target], utcnow())
    if isinstance(actor, Actor):
        actor_id: UUID | None = actor.ctx.user.id
        source: Source = actor.source
    else:
        actor_id, source = None, "ONLINE"
    session.add(
        DeliveryStatusHistory(
            delivery_id=delivery.id,
            from_status=before,
            to_status=target,
            actor_id=actor_id,
            actor_type="USER" if actor_id else "SYSTEM",
            reason=reason,
            source=source,
            details=details or {},
        )
    )
    await session.flush()
    await audit.record(
        session,
        f"delivery.{ {'PLANNED': 'unassigned', 'IN_TRANSIT': 'dispatched'}.get(target, target.lower()) }",
        "deliveries",
        delivery.id,
        actor_id=actor_id,
        org_id=delivery.company_id,
        old={"status": before},
        new={"status": target},
        reason=reason,
    )
    if target in EVENTS:
        # DEL-012: no code in the payload. A notification consumer that needs it reads
        # `code_encrypted` from the row under its own authorisation.
        await event_bus.publish(
            session,
            DomainEvent(
                EVENTS[target],
                {
                    "delivery_id": str(delivery.id),
                    "order_id": str(delivery.order_id),
                    "company_id": str(delivery.company_id),
                    "store_id": str(delivery.store_id),
                    "courier_id": str(delivery.courier_id) if delivery.courier_id else None,
                    "status": target,
                    "attempt_no": delivery.attempt_no,
                },
                org_id=delivery.company_id,
            ),
        )


async def _courier_membership(session: AsyncSession, company_id: UUID, courier_id: UUID) -> Membership:
    membership = await session.scalar(
        select(Membership).where(
            Membership.user_id == courier_id,
            Membership.organization_id == company_id,
            Membership.status == "ACTIVE",
        )
    )
    if membership is None or membership.role not in COURIER_ROLES:
        raise AppError("validation_error", 422, {"field": "courier_id", "reason": "not_a_courier"})
    return membership


def _may_act(ctx: OrgContext, delivery: Delivery) -> None:
    """DEL-003/004: a courier acts only on their own stops; `act_any` stands in for anyone."""
    if "delivery.act_any" in ctx.permissions:
        return
    if "delivery.act_own" not in ctx.permissions:
        raise AppError("permission_denied", 403)
    if delivery.courier_id != ctx.user.id:
        raise AppError("courier_not_assigned", 409)


class DeliveryService:
    async def plan_for_order(self, session: AsyncSession, order: Order) -> Delivery | None:
        """DEL-001: the synchronous ORDER_READY handler. A reattempt gets the next attempt number."""
        existing = await session.scalar(
            select(Delivery.id).where(Delivery.order_id == order.id, Delivery.status.in_(OPEN))
        )
        if existing is not None:
            return None
        attempts = await session.scalar(
            select(func.coalesce(func.max(Delivery.attempt_no), 0)).where(Delivery.order_id == order.id)
        )
        # The order froze the address at checkout (P07), so a later edit to the store profile cannot
        # move a delivery that is already being planned.
        delivery = Delivery(
            company_id=order.company_id,
            store_id=order.store_id,
            order_id=order.id,
            attempt_no=int(attempts or 0) + 1,
            status="PLANNED",
            address=order.delivery_address,
            latitude=order.delivery_latitude,
            longitude=order.delivery_longitude,
        )
        session.add(delivery)
        await session.flush()
        session.add(
            DeliveryStatusHistory(
                delivery_id=delivery.id,
                from_status=None,
                to_status="PLANNED",
                actor_type="SYSTEM",
                source="ONLINE",
                details={"order_status": order.status},
            )
        )
        await session.flush()
        return delivery

    async def cancel_for_order(self, session: AsyncSession, order_id: UUID) -> None:
        """DEL-002: the real DeliveryCancellationPort. A delivery already on the road cannot be dropped."""
        delivery = await session.scalar(
            select(Delivery).where(Delivery.order_id == order_id, Delivery.status.in_(OPEN)).with_for_update()
        )
        if delivery is None:
            return
        if delivery.status in CODE_STATUSES:
            raise AppError("invalid_transition", 409, {"reason": "delivery_in_transit"})
        delivery.run_id, delivery.stop_sequence = None, None
        await _apply(session, delivery, "CANCELLED", SystemActor("DELIVERY"), reason="order_cancelled")

    async def assign(
        self, session: AsyncSession, ctx: OrgContext, delivery: Delivery, courier_id: UUID, expected: int
    ) -> Delivery:
        delivery = await locked(session, delivery)
        version(delivery, expected)
        transition_allowed(delivery, "assign")
        await _courier_membership(session, delivery.company_id, courier_id)
        delivery.courier_id = courier_id
        await _apply(session, delivery, "ASSIGNED", Actor(ctx), details={"courier_id": str(courier_id)})
        return delivery

    async def unassign(self, session: AsyncSession, ctx: OrgContext, delivery: Delivery, expected: int) -> Delivery:
        delivery = await locked(session, delivery)
        version(delivery, expected)
        transition_allowed(delivery, "unassign")
        if delivery.run_id is not None:
            run = await session.get(DeliveryRun, delivery.run_id)
            if run is not None and run.status != "DRAFT":
                raise AppError("run_not_editable", 409)
        delivery.courier_id, delivery.run_id, delivery.stop_sequence = None, None, None
        await _apply(session, delivery, "PLANNED", Actor(ctx))
        return delivery

    async def cancel(
        self, session: AsyncSession, ctx: OrgContext, delivery: Delivery, reason: str, expected: int
    ) -> Delivery:
        delivery = await locked(session, delivery)
        version(delivery, expected)
        transition_allowed(delivery, "cancel")
        delivery.run_id, delivery.stop_sequence = None, None
        await _apply(session, delivery, "CANCELLED", Actor(ctx), reason=reason)
        return delivery

    async def dispatch(self, session: AsyncSession, actor: Actor, delivery: Delivery) -> Delivery:
        """DEL-010: the code is minted here, at the moment the goods leave."""
        delivery = await locked(session, delivery)
        _may_act(actor.ctx, delivery)
        transition_allowed(delivery, "dispatch")
        await subscriptions.guard.require(session, delivery.company_id, SubAction.ORDER_FULFILLMENT)
        code = codes.generate()
        delivery.code_hash = codes.digest(delivery.id, code)
        delivery.code_encrypted = codes.encrypt(delivery.id, code)
        delivery.code_attempts, delivery.code_locked = 0, False
        await order_service.dispatch(session, SystemActor("DELIVERY"), delivery.order_id)
        await _apply(session, delivery, "IN_TRANSIT", actor)
        return delivery

    async def arrive(self, session: AsyncSession, actor: Actor, delivery: Delivery) -> Delivery:
        delivery = await locked(session, delivery)
        _may_act(actor.ctx, delivery)
        transition_allowed(delivery, "arrive")
        await _apply(session, delivery, "ARRIVED", actor)
        return delivery

    async def confirm(self, session: AsyncSession, actor: Actor, delivery: Delivery, code: str) -> Delivery:
        """DEL-011: a wrong code costs an attempt; the fifth locks the delivery until it is re-coded."""
        await self._spend_attempt(actor, delivery.id, code)
        delivery = await locked(session, delivery)
        _may_act(actor.ctx, delivery)
        transition_allowed(delivery, "deliver")
        # Regeneration can race the separate attempt transaction. Validate again under
        # the business lock before accepting the handover.
        if delivery.code_locked:
            raise AppError("delivery_code_locked", 409)
        if not codes.matches(delivery.id, code, delivery.code_hash):
            raise AppError("delivery_code_invalid", 422)
        delivery.confirmation_method = "CODE"
        return await self._complete(session, actor, delivery)

    async def _spend_attempt(self, actor: Actor, delivery_id: UUID, code: str) -> None:
        """Counts a wrong code in its own transaction, then raises.

        The attempt counter is the whole defence against guessing a six-digit code, so it cannot live
        in the request transaction: that transaction is rolled back by the very error that reports the
        wrong code, and the count would reset on every try. This commits the increment first and
        raises afterwards. It also finishes before the caller takes its own lock on the row, so the
        two never wait on each other.
        """
        async with UnitOfWork() as uow:
            inner = uow.session
            row = (
                await inner.scalars(
                    select(Delivery)
                    .where(Delivery.id == delivery_id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            ).one()
            if row.company_id != actor.ctx.organization.id:
                raise AppError("not_found", 404)
            _may_act(actor.ctx, row)
            transition_allowed(row, "deliver")
            if row.code_locked:
                raise AppError("delivery_code_locked", 409)
            if codes.matches(row.id, code, row.code_hash):
                return
            row.code_attempts += 1
            row.code_locked = row.code_attempts >= codes.MAX_ATTEMPTS
            await inner.flush()
            await audit.record(
                inner,
                "delivery.code_locked" if row.code_locked else "delivery.code_rejected",
                "deliveries",
                row.id,
                actor_id=actor.ctx.user.id,
                org_id=row.company_id,
                new={"code_attempts": row.code_attempts},
            )
            if row.code_locked:
                await event_bus.publish(
                    inner,
                    DomainEvent(
                        "DELIVERY_CODE_LOCKED",
                        {
                            "delivery_id": str(row.id),
                            "order_id": str(row.order_id),
                            "company_id": str(row.company_id),
                        },
                        org_id=row.company_id,
                    ),
                )
            locked_now, left = row.code_locked, codes.MAX_ATTEMPTS - row.code_attempts
        # Outside the block, so the increment is committed before the caller sees the failure.
        if locked_now:
            raise AppError("delivery_code_locked", 409)
        raise AppError("delivery_code_invalid", 422, {"attempts_left": left})

    async def manual_confirm(self, session: AsyncSession, ctx: OrgContext, delivery: Delivery, reason: str) -> Delivery:
        """DEL-013: handing over without the code is allowed, but it is named, reasoned and audited."""
        if len(reason.strip()) < MANUAL_REASON_MIN:
            raise AppError("validation_error", 422, {"field": "reason", "reason": "too_short"})
        delivery = await locked(session, delivery)
        transition_allowed(delivery, "deliver")
        delivery.confirmation_method = "MANUAL_OVERRIDE"
        delivery.manual_reason = reason.strip()
        actor = Actor(ctx)
        await audit.record(
            session,
            "delivery.manual_confirm",
            "deliveries",
            delivery.id,
            actor_id=ctx.user.id,
            org_id=delivery.company_id,
            reason=reason.strip(),
        )
        await event_bus.publish(
            session,
            DomainEvent(
                "DELIVERY_MANUAL_CONFIRMED",
                {
                    "delivery_id": str(delivery.id),
                    "order_id": str(delivery.order_id),
                    "company_id": str(delivery.company_id),
                    "store_id": str(delivery.store_id),
                },
                org_id=delivery.company_id,
            ),
        )
        return await self._complete(session, actor, delivery)

    async def _complete(self, session: AsyncSession, actor: Actor, delivery: Delivery) -> Delivery:
        """DEL-015: delivery, order, stock and charge land together or not at all."""
        await subscriptions.guard.require(session, delivery.company_id, SubAction.ORDER_CLOSE)
        delivered_at = utcnow()
        await order_service.deliver(session, SystemActor("DELIVERY"), delivery.order_id, delivered_at)
        await _apply(session, delivery, "DELIVERED", actor, details={"method": delivery.confirmation_method})
        return delivery

    async def fail(
        self, session: AsyncSession, actor: Actor, delivery: Delivery, reason_code: str, note: str | None
    ) -> Delivery:
        if reason_code not in FAILURE_REASONS:
            raise AppError("validation_error", 422, {"field": "reason_code"})
        if reason_code == "OTHER" and not (note and note.strip()):
            raise AppError("validation_error", 422, {"field": "note"})
        delivery = await locked(session, delivery)
        _may_act(actor.ctx, delivery)
        transition_allowed(delivery, "fail")
        delivery.failure_reason_code = reason_code
        delivery.failure_note = note.strip() if note else None
        await order_service.fail_delivery(session, SystemActor("DELIVERY"), delivery.order_id, reason_code)
        await _apply(session, delivery, "FAILED", actor, reason=reason_code)
        return delivery

    async def regenerate_code(self, session: AsyncSession, ctx: OrgContext, delivery: Delivery) -> str:
        """DEL-014: a fresh code clears the attempt count and the lock with it."""
        delivery = await locked(session, delivery)
        if delivery.status not in CODE_STATUSES:
            raise AppError("invalid_transition", 409, {"status": delivery.status})
        code = codes.generate()
        delivery.code_hash = codes.digest(delivery.id, code)
        delivery.code_encrypted = codes.encrypt(delivery.id, code)
        delivery.code_attempts, delivery.code_locked = 0, False
        delivery.version += 1
        await session.flush()
        await audit.record(
            session,
            "delivery.code_regenerated",
            "deliveries",
            delivery.id,
            actor_id=ctx.user.id,
            org_id=delivery.company_id,
        )
        await event_bus.publish(
            session,
            DomainEvent(
                "DELIVERY_DISPATCHED",
                {
                    "delivery_id": str(delivery.id),
                    "order_id": str(delivery.order_id),
                    "company_id": str(delivery.company_id),
                    "store_id": str(delivery.store_id),
                    "courier_id": str(delivery.courier_id) if delivery.courier_id else None,
                    "status": delivery.status,
                    "attempt_no": delivery.attempt_no,
                    "recoded": True,
                },
                org_id=delivery.company_id,
            ),
        )
        return code


delivery_service = DeliveryService()


async def _run_locked(session: AsyncSession, run: DeliveryRun) -> DeliveryRun:
    await lock_org(session, run.company_id)
    await subscriptions.get_subscription(session, company_id=run.company_id, lock=True)
    return (
        await session.scalars(
            select(DeliveryRun)
            .where(DeliveryRun.id == run.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).one()


async def run_stops(session: AsyncSession, run_id: UUID) -> list[Delivery]:
    return list(
        await session.scalars(
            select(Delivery).where(Delivery.run_id == run_id).order_by(Delivery.stop_sequence, Delivery.id)
        )
    )


class RunService:
    """A run is a courier's ordered list of stops for one day. Its membership is fixed once it starts."""

    async def create(
        self, session: AsyncSession, ctx: OrgContext, courier_id: UUID, run_date: Any, delivery_ids: list[UUID]
    ) -> DeliveryRun:
        if not delivery_ids:
            raise AppError("validation_error", 422, {"field": "delivery_ids", "reason": "empty"})
        company_id = ctx.organization.id
        await lock_org(session, company_id)
        await _courier_membership(session, company_id, courier_id)
        run = DeliveryRun(
            company_id=company_id,
            courier_id=courier_id,
            run_date=run_date,
            status="DRAFT",
            created_by=ctx.user.id,
        )
        session.add(run)
        await session.flush()
        await self._set_stops(session, ctx, run, delivery_ids)
        await audit.record(
            session,
            "run.created",
            "delivery_runs",
            run.id,
            actor_id=ctx.user.id,
            org_id=company_id,
            new={"courier_id": str(courier_id), "stops": len(delivery_ids)},
        )
        return run

    async def update(
        self, session: AsyncSession, ctx: OrgContext, run: DeliveryRun, delivery_ids: list[UUID], expected: int
    ) -> DeliveryRun:
        run = await _run_locked(session, run)
        # The status gate comes first: once a run is on the road its shape is closed whatever version
        # the caller is holding, and "it has already started" is the useful answer.
        if run.status != "DRAFT":
            raise AppError("run_not_editable", 409)
        if run.version != expected:
            raise AppError("version_conflict", 409, {"current_version": run.version})
        await self._set_stops(session, ctx, run, delivery_ids)
        run.version += 1
        await audit.record(
            session,
            "run.updated",
            "delivery_runs",
            run.id,
            actor_id=ctx.user.id,
            org_id=run.company_id,
            new={"stops": len(delivery_ids)},
        )
        return run

    async def _set_stops(
        self, session: AsyncSession, ctx: OrgContext, run: DeliveryRun, delivery_ids: list[UUID]
    ) -> None:
        """Rewrites the stop list in the order given. Everything dropped goes back to the unassigned pool."""
        if len(set(delivery_ids)) != len(delivery_ids):
            raise AppError("validation_error", 422, {"field": "delivery_ids", "reason": "duplicate"})
        for previous in await run_stops(session, run.id):
            if previous.id not in delivery_ids:
                previous.run_id, previous.stop_sequence = None, None
                if previous.status == "ASSIGNED":
                    await _apply(session, previous, "PLANNED", Actor(ctx))
                    previous.courier_id = None
        # Clear the old sequence numbers first: the unique index would otherwise trip while two stops
        # briefly share a position during a reorder.
        for stop in await run_stops(session, run.id):
            stop.stop_sequence = None
        await session.flush()
        for position, delivery_id in enumerate(delivery_ids, start=1):
            delivery = await session.get(Delivery, delivery_id)
            if delivery is None or delivery.company_id != run.company_id:
                raise AppError("not_found", 404, {"delivery_id": str(delivery_id)})
            if delivery.status not in {"PLANNED", "ASSIGNED"}:
                raise AppError("invalid_transition", 409, {"delivery_id": str(delivery_id)})
            if delivery.run_id is not None and delivery.run_id != run.id:
                raise AppError("validation_error", 422, {"field": "delivery_ids", "reason": "other_run"})
            if delivery.status == "ASSIGNED" and delivery.courier_id != run.courier_id:
                raise AppError("validation_error", 422, {"field": "delivery_ids", "reason": "other_courier"})
            delivery.run_id, delivery.stop_sequence = run.id, position
            if delivery.status == "PLANNED":
                delivery.courier_id = run.courier_id
                await _apply(session, delivery, "ASSIGNED", Actor(ctx), details={"run_id": str(run.id)})
        await session.flush()

    async def start(self, session: AsyncSession, actor: Actor, run: DeliveryRun) -> DeliveryRun:
        """DRAFT → STARTED dispatches every stop in one transaction, so a run never starts half-way."""
        run = await _run_locked(session, run)
        self._may_drive(actor.ctx, run)
        if run.status != "DRAFT":
            raise AppError("invalid_transition", 409, {"status": run.status})
        stops = await run_stops(session, run.id)
        if not stops:
            raise AppError("validation_error", 422, {"field": "delivery_ids", "reason": "empty"})
        for stop in stops:
            if stop.status == "ASSIGNED":
                await delivery_service.dispatch(session, actor, stop)
        run.status, run.started_at = "STARTED", utcnow()
        run.version += 1
        await self._record(session, actor.ctx, run, "run.started")
        return run

    async def finish(self, session: AsyncSession, actor: Actor, run: DeliveryRun) -> DeliveryRun:
        run = await _run_locked(session, run)
        self._may_drive(actor.ctx, run)
        if run.status != "STARTED":
            raise AppError("invalid_transition", 409, {"status": run.status})
        if any(stop.status in OPEN for stop in await run_stops(session, run.id)):
            raise AppError("invalid_transition", 409, {"reason": "stops_open"})
        run.status, run.finished_at = "FINISHED", utcnow()
        run.version += 1
        await self._record(session, actor.ctx, run, "run.finished")
        return run

    async def cancel(self, session: AsyncSession, ctx: OrgContext, run: DeliveryRun) -> DeliveryRun:
        run = await _run_locked(session, run)
        if run.status != "DRAFT":
            raise AppError("run_not_editable", 409)
        for stop in await run_stops(session, run.id):
            stop.run_id, stop.stop_sequence = None, None
            if stop.status == "ASSIGNED":
                await _apply(session, stop, "PLANNED", Actor(ctx))
                stop.courier_id = None
        run.status = "CANCELLED"
        run.version += 1
        await self._record(session, ctx, run, "run.cancelled")
        return run

    def _may_drive(self, ctx: OrgContext, run: DeliveryRun) -> None:
        if "delivery.act_any" in ctx.permissions:
            return
        if "delivery.act_own" not in ctx.permissions or run.courier_id != ctx.user.id:
            raise AppError("courier_not_assigned", 409)

    async def _record(self, session: AsyncSession, ctx: OrgContext, run: DeliveryRun, action: str) -> None:
        await session.flush()
        await audit.record(
            session,
            action,
            "delivery_runs",
            run.id,
            actor_id=ctx.user.id,
            org_id=run.company_id,
            new={"status": run.status},
        )


run_service = RunService()
