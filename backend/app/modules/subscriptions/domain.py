"""Canonical P03 policies shared by API, workers and future order services.

Pure decisions only: the transactional service must persist each returned transition
with history, audit and an outbox event before committing.
"""

from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from enum import StrEnum
from uuid import UUID

from app.core.errors import AppError


class SubscriptionStatus(StrEnum):
    TRIAL = "TRIAL"
    ACTIVE = "ACTIVE"
    GRACE = "GRACE"
    SOFT_BLOCK = "SOFT_BLOCK"
    FULL_BLOCK = "FULL_BLOCK"
    CANCELLED = "CANCELLED"


class SubAction(StrEnum):
    READ = "READ"
    EXPORT = "EXPORT"
    PAYMENT = "PAYMENT"
    NEW_ORDER = "NEW_ORDER"
    ORDER_FULFILLMENT = "ORDER_FULFILLMENT"
    ORDER_CLOSE = "ORDER_CLOSE"
    CATALOG_WRITE = "CATALOG_WRITE"
    PARTNERSHIP_NEW = "PARTNERSHIP_NEW"
    MEMBER_INVITE = "MEMBER_INVITE"
    RETURNS_DISPUTES = "RETURNS_DISPUTES"


class LimitKind(StrEnum):
    ACTIVE_STORES = "active_stores"
    USERS = "users"
    PRODUCTS = "products"


_ALWAYS_ALLOWED = frozenset(
    {SubAction.READ, SubAction.EXPORT, SubAction.PAYMENT, SubAction.ORDER_CLOSE, SubAction.RETURNS_DISPUTES}
)
_SOFT_ALLOWED = _ALWAYS_ALLOWED | {SubAction.ORDER_FULFILLMENT, SubAction.CATALOG_WRITE}


def allowed_actions(status: SubscriptionStatus) -> frozenset[SubAction]:
    if status in {SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE}:
        return frozenset(SubAction)
    if status == SubscriptionStatus.SOFT_BLOCK:
        return _SOFT_ALLOWED
    return _ALWAYS_ALLOWED


def require_action(company_id: UUID, status: SubscriptionStatus, action: SubAction) -> None:
    if action not in allowed_actions(status):
        raise AppError("subscription_blocked", 403, {"status": status.value, "company_id": str(company_id)})


def check_usage(kind: LimitKind, current: int, maximum: int | None, adding: int = 1) -> None:
    if current < 0 or adding < 0 or (maximum is not None and maximum <= 0):
        raise ValueError("Usage and increments must be nonnegative; finite limits must be positive")
    if maximum is not None and current + adding > maximum:
        raise AppError("subscription_limit_reached", 403, {"limit": kind.value, "current": current, "max": maximum})


def _require_aware(value: datetime) -> None:
    if value.utcoffset() is None:
        raise ValueError("Subscription deadlines must be timezone-aware")


def add_calendar_months(start: datetime, months: int) -> datetime:
    _require_aware(start)
    if not 1 <= months <= 12:
        raise ValueError("Payment months must be between 1 and 12")
    month_index = start.year * 12 + start.month - 1 + months
    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1
    return start.replace(year=year, month=month, day=min(start.day, monthrange(year, month)[1]))


def payment_period(
    status: SubscriptionStatus, current_period_end: datetime | None, now: datetime, months: int
) -> tuple[datetime, datetime]:
    _require_aware(now)
    if current_period_end is not None:
        _require_aware(current_period_end)
    start = (
        current_period_end
        if status == SubscriptionStatus.ACTIVE and current_period_end is not None and current_period_end > now
        else now
    )
    return start, add_calendar_months(start, months)


@dataclass(frozen=True)
class Lifecycle:
    status: SubscriptionStatus
    trial_ends_at: datetime | None = None
    current_period_end: datetime | None = None
    grace_ends_at: datetime | None = None
    soft_block_ends_at: datetime | None = None
    cancel_at_period_end: bool = False


@dataclass(frozen=True)
class Transition:
    before: SubscriptionStatus
    after: SubscriptionStatus
    effective_at: datetime
    state: Lifecycle


def activate_from_payment(state: Lifecycle, now: datetime, months: int) -> tuple[Lifecycle, datetime, datetime]:
    """Decision for a verified, idempotent manual payment in the caller's transaction."""
    start, end = payment_period(state.status, state.current_period_end, now, months)
    activated = replace(
        state,
        status=SubscriptionStatus.ACTIVE,
        current_period_end=end,
        grace_ends_at=None,
        soft_block_ends_at=None,
        cancel_at_period_end=False,
    )
    return activated, start, end


def due_transitions(state: Lifecycle, now: datetime) -> tuple[Transition, ...]:
    """Catch up every overdue stage; deadlines derive from expiry, never worker time.

    The caller locks the subscription row and persists all returned transitions in
    order. Re-evaluating the final state returns an empty tuple.
    """
    _require_aware(now)
    for deadline in (state.trial_ends_at, state.current_period_end, state.grace_ends_at, state.soft_block_ends_at):
        if deadline is not None:
            _require_aware(deadline)
    transitions: list[Transition] = []
    while True:
        before = state.status
        match before:
            case SubscriptionStatus.TRIAL:
                deadline = state.trial_ends_at
                next_status = SubscriptionStatus.GRACE
            case SubscriptionStatus.ACTIVE:
                deadline = state.current_period_end
                next_status = SubscriptionStatus.CANCELLED if state.cancel_at_period_end else SubscriptionStatus.GRACE
            case SubscriptionStatus.GRACE:
                deadline = state.grace_ends_at
                next_status = SubscriptionStatus.SOFT_BLOCK
            case SubscriptionStatus.SOFT_BLOCK:
                deadline = state.soft_block_ends_at
                next_status = SubscriptionStatus.FULL_BLOCK
            case _:
                break
        if deadline is None:
            raise ValueError(f"{before.value} requires its expiry deadline")
        if now < deadline:
            break
        state = replace(state, status=next_status)
        if next_status == SubscriptionStatus.GRACE:
            state = replace(state, grace_ends_at=deadline + timedelta(days=7))
        elif next_status == SubscriptionStatus.SOFT_BLOCK:
            state = replace(state, soft_block_ends_at=deadline + timedelta(days=14))
        transitions.append(Transition(before, next_status, deadline, state))
    return tuple(transitions)
