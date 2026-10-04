from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Protocol
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.errors import AppError
from app.core.events import DomainEvent, event_bus
from app.core.time import new_id, utcnow
from app.modules.identity.models import Membership, Organization, User
from app.modules.subscriptions.domain import (
    Lifecycle,
    LimitKind,
    SubAction,
    SubscriptionStatus,
    activate_from_payment,
    check_usage,
    due_transitions,
    require_action,
)
from app.modules.subscriptions.models import (
    Plan,
    PlanChangeRequest,
    Subscription,
    SubscriptionHistory,
    SubscriptionPayment,
    SubscriptionReminder,
)


async def seed_plans(session: AsyncSession) -> None:
    """Idempotent bootstrap; existing prices and limits are never overwritten."""
    for order, (code, price, stores, users, products) in enumerate(
        [("START", 300, 30, 5, 500), ("STANDARD", 700, 150, 15, 3000), ("LARGE", 1500, None, None, None)], 1
    ):
        await session.execute(
            insert(Plan)
            .values(
                id=new_id(),
                code=code,
                name={"tg": code, "ru": code, "en": code},
                price_monthly=price,
                max_active_stores=stores,
                max_users=users,
                max_products=products,
                sort_order=order,
            )
            .on_conflict_do_nothing(index_elements=[Plan.code])
        )


async def get_plan(session: AsyncSession, code: str, *, public: bool = False, lock: bool = False) -> Plan:
    query = select(Plan).where(Plan.code == code)
    if public:
        query = query.where(Plan.is_public.is_(True))
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    plan = (await session.scalars(query)).one_or_none()
    if plan is None:
        raise AppError("not_found", 404)
    return plan


async def get_subscription(
    session: AsyncSession, *, company_id: UUID | None = None, subscription_id: UUID | None = None, lock: bool = False
) -> Subscription:
    query = select(Subscription)
    query = (
        query.where(Subscription.company_id == company_id)
        if company_id
        else query.where(Subscription.id == subscription_id)
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    subscription = (await session.scalars(query)).one_or_none()
    if subscription is None:
        raise AppError("not_found", 404)
    return subscription


def lifecycle(subscription: Subscription) -> Lifecycle:
    return Lifecycle(
        SubscriptionStatus(subscription.status),
        subscription.trial_ends_at,
        subscription.current_period_end,
        subscription.grace_ends_at,
        subscription.soft_block_ends_at,
        subscription.cancel_at_period_end,
    )


async def emit(session: AsyncSession, subscription: Subscription, event: str, **extra: object) -> None:
    await event_bus.publish(
        session,
        DomainEvent(
            event,
            {
                "subscription_id": str(subscription.id),
                "company_id": str(subscription.company_id),
                **extra,
            },
            org_id=subscription.company_id,
        ),
    )


async def reminder(session: AsyncSession, subscription: Subscription, kind: str, anchor: datetime) -> bool:
    inserted = (
        await session.execute(
            insert(SubscriptionReminder)
            .values(
                id=new_id(),
                subscription_id=subscription.id,
                kind=kind,
                anchor_at=anchor,
            )
            .on_conflict_do_nothing(index_elements=["subscription_id", "kind", "anchor_at"])
            .returning(SubscriptionReminder.id)
        )
    ).scalar_one_or_none()
    if inserted is None:
        return False
    await emit(
        session,
        subscription,
        "SUBSCRIPTION_EXPIRING",
        kind=kind,
        anchor_at=anchor.isoformat(),
        status=subscription.status,
    )
    return True


async def transition(
    session: AsyncSession,
    subscription: Subscription,
    target: str,
    reason: str,
    *,
    actor_id: UUID | None = None,
    effective_at: datetime | None = None,
) -> None:
    before = subscription.status
    subscription.status = target
    subscription.status_changed_at = effective_at or utcnow()
    subscription.version += 1
    session.add(
        SubscriptionHistory(
            subscription_id=subscription.id, from_status=before, to_status=target, reason=reason, actor_id=actor_id
        )
    )
    await audit.record(
        session,
        "subscription.status_changed",
        "subscription",
        subscription.id,
        actor_id=actor_id,
        org_id=subscription.company_id,
        old={"status": before},
        new={"status": target},
        reason=reason,
    )
    await emit(
        session, subscription, "SUBSCRIPTION_STATUS_CHANGED", from_status=before, to_status=target, reason=reason
    )
    if target in {"GRACE", "SOFT_BLOCK", "FULL_BLOCK"}:
        await reminder(session, subscription, target, subscription.status_changed_at)


class TrialStarter:
    async def start_trial(self, session: AsyncSession, company_id: UUID) -> None:
        # Company row serializes retries; uniqueness also protects against duplicate events.
        from app.modules.organizations.models import Company

        company = (
            await session.scalars(select(Company).where(Company.id == company_id).with_for_update())
        ).one_or_none()
        if company is None:
            raise AppError("not_found", 404)
        existing = (
            await session.scalars(select(Subscription).where(Subscription.company_id == company_id))
        ).one_or_none()
        if existing is not None:
            return
        plan = await get_plan(session, "STANDARD")
        now = utcnow()
        subscription = Subscription(
            company_id=company_id,
            plan_id=plan.id,
            status="TRIAL",
            trial_ends_at=now + timedelta(days=14),
            status_changed_at=now,
        )
        session.add(subscription)
        await session.flush()
        session.add(
            SubscriptionHistory(
                subscription_id=subscription.id, from_status=None, to_status="TRIAL", reason="Company trial started"
            )
        )
        await audit.record(
            session,
            "subscription.status_changed",
            "subscription",
            subscription.id,
            org_id=company_id,
            new={"status": "TRIAL"},
            reason="Company trial started",
        )
        await emit(session, subscription, "SUBSCRIPTION_STATUS_CHANGED", from_status=None, to_status="TRIAL")


class UsagePort(Protocol):
    async def count(self, session: AsyncSession, company_id: UUID, kind: LimitKind) -> int: ...


class FutureUsage:
    async def count(self, session: AsyncSession, company_id: UUID, kind: LimitKind) -> int:
        # P04 products and P06 partnerships install these counters when their tables exist.
        return 0


usage_port: UsagePort = FutureUsage()


async def usage(session: AsyncSession, company_id: UUID) -> dict[str, int]:
    users = (
        await session.execute(
            select(func.count())
            .select_from(Membership)
            .where(Membership.organization_id == company_id, Membership.status == "ACTIVE")
        )
    ).scalar_one()
    return {
        "users": users,
        "products": await usage_port.count(session, company_id, LimitKind.PRODUCTS),
        "active_stores": await usage_port.count(session, company_id, LimitKind.ACTIVE_STORES),
    }


class SubscriptionGuard:
    async def require(self, session: AsyncSession, company_id: UUID, action: SubAction) -> None:
        org = await session.get(Organization, company_id)
        if org is None:
            raise AppError("not_found", 404)
        if org.type == "STORE":
            return
        subscription = await get_subscription(session, company_id=company_id, lock=True)
        await evaluate(session, subscription, utcnow())
        require_action(company_id, SubscriptionStatus(subscription.status), action)

    async def check_limit(self, session: AsyncSession, org_id: UUID, kind: str, adding: int = 1) -> None:
        org = await session.get(Organization, org_id)
        if org is None:
            raise AppError("not_found", 404)
        if org.type == "STORE":
            return
        if kind == "users":
            await self.require(session, org_id, SubAction.MEMBER_INVITE)
        subscription = await get_subscription(session, company_id=org_id, lock=True)
        plan = (
            await session.scalars(
                select(Plan)
                .where(Plan.id == subscription.plan_id)
                .with_for_update(read=True)
                .execution_options(populate_existing=True)
            )
        ).one()
        counts = await usage(session, org_id)
        limit_kind = LimitKind(kind)
        maximum = {"users": plan.max_users, "products": plan.max_products, "active_stores": plan.max_active_stores}[
            kind
        ]
        check_usage(limit_kind, counts[kind], maximum, adding)


guard = SubscriptionGuard()


async def evaluate(session: AsyncSession, subscription: Subscription, now: datetime) -> int:
    changes = due_transitions(lifecycle(subscription), now)
    for change in changes:
        subscription.grace_ends_at = change.state.grace_ends_at
        subscription.soft_block_ends_at = change.state.soft_block_ends_at
        await transition(
            session, subscription, change.after.value, "Subscription deadline reached", effective_at=change.effective_at
        )
    return len(changes)


async def tick(session: AsyncSession, now: datetime | None = None) -> int:
    now = now or utcnow()
    query = (
        select(Subscription)
        .where(
            or_(
                (Subscription.status == "TRIAL") & (Subscription.trial_ends_at <= now),
                (Subscription.status == "ACTIVE") & (Subscription.current_period_end <= now),
                (Subscription.status == "GRACE") & (Subscription.grace_ends_at <= now),
                (Subscription.status == "SOFT_BLOCK") & (Subscription.soft_block_ends_at <= now),
            )
        )
        .order_by(Subscription.id)
        .with_for_update(skip_locked=True)
        .execution_options(populate_existing=True)
    )
    total = 0
    for subscription in await session.scalars(query):
        total += await evaluate(session, subscription, now)
    return total


async def send_reminders(session: AsyncSession, now: datetime | None = None) -> int:
    now = now or utcnow()
    total = 0
    query = (
        select(Subscription)
        .where(Subscription.status.in_(["TRIAL", "ACTIVE"]))
        .order_by(Subscription.id)
        .with_for_update(skip_locked=True)
    )
    for subscription in await session.scalars(query):
        anchor = subscription.trial_ends_at if subscription.status == "TRIAL" else subscription.current_period_end
        if anchor is None:
            continue
        for days in (7, 3, 1):
            if anchor - timedelta(days=days) <= now < anchor - timedelta(days=days - 1):
                total += await reminder(session, subscription, f"{subscription.status}_{days}", anchor)
    return total


async def record_payment(
    session: AsyncSession,
    subscription_id: UUID,
    admin: User,
    *,
    months: int,
    amount: Decimal,
    method: str,
    reference: str | None,
    override_amount_reason: str | None,
) -> Subscription:
    if not admin.is_superadmin:
        raise AppError("permission_denied", 403)
    subscription = await get_subscription(session, subscription_id=subscription_id, lock=True)
    plan = (
        await session.scalars(
            select(Plan)
            .where(Plan.id == subscription.plan_id)
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        )
    ).one()
    expected = plan.price_monthly * months
    if amount != expected and not override_amount_reason:
        raise AppError("validation_error", 422, {"expected_amount": str(expected), "field": "override_amount_reason"})
    now = utcnow()
    activated, start, end = activate_from_payment(lifecycle(subscription), now, months)
    payment = SubscriptionPayment(
        subscription_id=subscription.id,
        plan_id=plan.id,
        months=months,
        amount=amount,
        currency=plan.currency,
        method=method,
        reference=reference,
        period_start=start,
        period_end=end,
        recorded_by=admin.id,
    )
    session.add(payment)
    subscription.current_period_start = start
    subscription.current_period_end = end
    subscription.grace_ends_at = activated.grace_ends_at
    subscription.soft_block_ends_at = activated.soft_block_ends_at
    subscription.cancel_at_period_end = False
    await session.flush()
    if subscription.status != "ACTIVE":
        await transition(session, subscription, "ACTIVE", "Manual subscription payment", actor_id=admin.id)
    else:
        subscription.version += 1
    await audit.record(
        session,
        "subscription.payment_recorded",
        "subscription_payment",
        payment.id,
        actor_id=admin.id,
        org_id=subscription.company_id,
        new={"amount": str(amount), "expected_amount": str(expected), "months": months},
        reason=override_amount_reason,
    )
    await emit(
        session,
        subscription,
        "SUBSCRIPTION_PAYMENT_RECORDED",
        payment_id=str(payment.id),
        period_start=start.isoformat(),
        period_end=end.isoformat(),
    )
    return subscription


async def request_plan(session: AsyncSession, company_id: UUID, user: User, code: str) -> PlanChangeRequest:
    await get_subscription(session, company_id=company_id, lock=True)
    plan = await get_plan(session, code, public=True)
    request = PlanChangeRequest(company_id=company_id, requested_plan_id=plan.id, requested_by=user.id)
    session.add(request)
    await session.flush()
    await audit.record(session, "subscription.plan_requested", "plan_change_request", request.id, org_id=company_id)
    await event_bus.publish(
        session,
        DomainEvent(
            "PLAN_CHANGE_REQUESTED",
            {"company_id": str(company_id), "request_id": str(request.id), "plan_code": code},
            org_id=company_id,
        ),
    )
    return request


def install() -> None:
    from app.modules.identity import ports as identity_ports
    from app.modules.organizations import ports as organization_ports

    identity_ports.subscription_guard = guard
    organization_ports.subscription_starter = TrialStarter()
