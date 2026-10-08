"""P10 return and dispute calculations shared by previews, APIs and dispute resolution.

Pure functions only: no session, no I/O, no mutation of their arguments. The unit
fraction rule stays with `orders.service.check_quantity`, which already owns it, so a
caller validates the shape of a quantity there and the arithmetic rules here.

A dispute never touches the ledger (DSP-020). The only financial effects in this module
are the credit a completed return earns (RET-010) and the ceiling on a dispute
adjustment (DSP-021); both are calculated here and posted by the finance service.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID

from app.core.errors import AppError
from app.core.money import q2, q3

ZERO = Decimal("0.00")
ZERO_QUANTITY = Decimal("0.000")
ONE = Decimal("1")
#: DSP-002: a payment can be disputed for 30 days after it was recorded, whatever its status.
PAYMENT_DISPUTE_WINDOW = timedelta(days=30)
#: DSP-024: the first warning is due after 48 hours in OPEN, then one every 24 hours.
SLA_FIRST_WARNING = timedelta(hours=48)
SLA_REPEAT_EVERY = timedelta(hours=24)

ReturnStatus = Literal["REQUESTED", "APPROVED", "REJECTED", "CANCELLED", "RECEIVED", "COMPLETED"]
ReturnReason = Literal["DAMAGED", "EXPIRED", "WRONG_ITEM", "NOT_ORDERED", "QUALITY", "OTHER"]
ReturnSource = Literal["STORE_REQUEST", "DISPUTE"]
DisputeStatus = Literal["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED", "WITHDRAWN"]
DisputeTarget = Literal["ORDER", "PAYMENT"]
DisputeType = Literal["QUANTITY", "PRICE", "DAMAGED", "DELIVERY", "PAYMENT", "OTHER"]
ResolutionType = Literal["NO_ACTION", "ADJUSTMENT_CREDIT", "CONVERTED_TO_RETURN"]

#: RET-001: the order must have reached the customer before anything can come back.
RETURNABLE_ORDER_STATUSES = frozenset({"DELIVERED", "DISPUTED", "COMPLETED"})
#: DSP-001: only a delivered order can be disputed; the window is counted from delivery.
DISPUTABLE_ORDER_STATUSES = frozenset({"DELIVERED"})

RETURN_TRANSITIONS: dict[str, tuple[frozenset[str], ReturnStatus]] = {
    "approve": (frozenset({"REQUESTED"}), "APPROVED"),
    "reject": (frozenset({"REQUESTED"}), "REJECTED"),
    "cancel": (frozenset({"REQUESTED", "APPROVED"}), "CANCELLED"),
    "receive": (frozenset({"APPROVED"}), "RECEIVED"),
    "complete": (frozenset({"RECEIVED"}), "COMPLETED"),
}
DISPUTE_TRANSITIONS: dict[str, tuple[frozenset[str], DisputeStatus]] = {
    "start_review": (frozenset({"OPEN"}), "UNDER_REVIEW"),
    "resolve": (frozenset({"OPEN", "UNDER_REVIEW"}), "RESOLVED"),
    "reject": (frozenset({"OPEN", "UNDER_REVIEW"}), "REJECTED"),
    "withdraw": (frozenset({"OPEN", "UNDER_REVIEW"}), "WITHDRAWN"),
}
#: Statuses that hold the one open return / dispute per order (the partial unique indexes).
OPEN_RETURN_STATUSES = frozenset({"REQUESTED", "APPROVED", "RECEIVED"})
OPEN_DISPUTE_STATUSES = frozenset({"OPEN", "UNDER_REVIEW"})


def ensure_returnable_order(status: str) -> None:
    """RET-001."""
    if status not in RETURNABLE_ORDER_STATUSES:
        raise AppError("invalid_transition", 409, {"reason": "order_not_returnable", "status": status})


def return_deadline(delivered_at: datetime, return_days: int) -> datetime | None:
    """RET-002: the moment a return stops being possible, or None when returns are off."""
    if return_days <= 0:
        return None
    return delivered_at + timedelta(days=return_days)


def ensure_return_window(delivered_at: datetime, return_days: int, now: datetime) -> None:
    """RET-002: `return_days = 0` forbids returns outright."""
    deadline = return_deadline(delivered_at, return_days)
    if deadline is None or now > deadline:
        raise AppError("return_window_closed", 422, {"return_days": return_days})


def max_returnable(confirmed_quantity: Decimal, accepted_quantity: Decimal) -> Decimal:
    """RET-003: what is left of a line after every completed return of it."""
    return max(q3(confirmed_quantity - accepted_quantity), ZERO_QUANTITY)


def ensure_return_quantity(requested: Decimal, confirmed_quantity: Decimal, accepted_quantity: Decimal) -> Decimal:
    """RET-003: a request may not exceed the delivered quantity less earlier accepted returns."""
    available = max_returnable(confirmed_quantity, accepted_quantity)
    if requested <= ZERO_QUANTITY or requested > available:
        raise AppError("return_quantity_exceeds", 422, {"max_returnable": str(available)})
    return q3(requested)


def ensure_within(value: Decimal, ceiling: Decimal, field: str) -> Decimal:
    """The requested -> approved -> received -> accepted -> restock ladder of the state machine."""
    if value < ZERO_QUANTITY or value > ceiling:
        raise AppError("quantity_invalid", 422, {"field": field, "max": str(ceiling)})
    return q3(value)


def discount_factor(subtotal: Decimal, discount: Decimal) -> Decimal:
    """RET-010: the order discount is shared across lines in proportion to their value.

    Kept unquantized on purpose: rounding happens once per line, on the credit itself.
    """
    if subtotal <= ZERO:
        return ONE
    return (subtotal - discount) / subtotal


def line_credit(accepted_quantity: Decimal, unit_price: Decimal, factor: Decimal) -> Decimal:
    """RET-010: credit for one returned line. The delivery fee is never refunded."""
    return q2(accepted_quantity * unit_price * factor)


def restock_base_quantity(restock_quantity: Decimal, coefficient_snapshot: Decimal) -> Decimal:
    """RET-012: the warehouse works in base units, so the order unit is converted back."""
    return q3(restock_quantity * coefficient_snapshot)


@dataclass(frozen=True)
class CompletionLine:
    """One line of a completion request, in the order item's own unit."""

    return_item_id: UUID
    unit_price: Decimal
    coefficient_snapshot: Decimal
    accepted_quantity: Decimal
    restock_quantity: Decimal


@dataclass(frozen=True)
class CompletionCredit:
    """What completing a return will credit and restock, before anything is written."""

    lines: tuple[tuple[UUID, Decimal], ...]
    total_credit: Decimal
    restock: tuple[tuple[UUID, Decimal], ...]


def completion_credit(lines: Iterable[CompletionLine], subtotal: Decimal, discount: Decimal) -> CompletionCredit:
    """RET-010 and RET-012 together: the preview and the posting share this calculation."""
    factor = discount_factor(subtotal, discount)
    credits: list[tuple[UUID, Decimal]] = []
    restock: list[tuple[UUID, Decimal]] = []
    for line in lines:
        credits.append((line.return_item_id, line_credit(line.accepted_quantity, line.unit_price, factor)))
        if line.restock_quantity > ZERO_QUANTITY:
            restock.append(
                (line.return_item_id, restock_base_quantity(line.restock_quantity, line.coefficient_snapshot))
            )
    return CompletionCredit(tuple(credits), q2(sum((amount for _, amount in credits), ZERO)), tuple(restock))


def ensure_return_transition(status: str, action: str) -> ReturnStatus:
    """The return state machine of P10 section 2."""
    allowed, target = RETURN_TRANSITIONS[action]
    if status not in allowed:
        raise AppError("invalid_transition", 409, {"status": status, "action": action})
    return target


def ensure_disputable_order(status: str) -> None:
    """DSP-001: the order status half of the window rule."""
    if status not in DISPUTABLE_ORDER_STATUSES:
        raise AppError("invalid_transition", 409, {"reason": "order_not_disputable", "status": status})


def ensure_dispute_window(delivered_at: datetime, dispute_window_hours: int, now: datetime) -> None:
    """DSP-001."""
    if now > delivered_at + timedelta(hours=dispute_window_hours):
        raise AppError("dispute_window_closed", 422, {"dispute_window_hours": dispute_window_hours})


def ensure_payment_dispute_window(created_at: datetime, now: datetime) -> None:
    """DSP-002: any payment status, for 30 days, and the payment itself is untouched."""
    if now > created_at + PAYMENT_DISPUTE_WINDOW:
        raise AppError("dispute_window_closed", 422, {"days": PAYMENT_DISPUTE_WINDOW.days})


def ensure_dispute_transition(status: str, action: str) -> DisputeStatus:
    """The dispute state machine of P10 section 4."""
    allowed, target = DISPUTE_TRANSITIONS[action]
    if status not in allowed:
        raise AppError("invalid_transition", 409, {"status": status, "action": action})
    return target


def ensure_dispute_adjustment(amount: Decimal, order_total: Decimal) -> Decimal:
    """DSP-021: a dispute credit cannot exceed what the order was worth."""
    if amount <= ZERO or amount > order_total:
        raise AppError("validation_error", 422, {"field": "amount", "max": str(q2(order_total))})
    return q2(amount)


def sla_warning_anchor(opened_at: datetime, now: datetime) -> datetime | None:
    """DSP-024: the due warning's anchor, which is also its idempotency key.

    Returns the latest anchor that is due (48h after opening, then every 24h), so a
    repeated or retried run claims the same anchor instead of warning twice.
    """
    elapsed = now - opened_at
    if elapsed < SLA_FIRST_WARNING:
        return None
    repeats = (elapsed - SLA_FIRST_WARNING) // SLA_REPEAT_EVERY
    return opened_at + SLA_FIRST_WARNING + repeats * SLA_REPEAT_EVERY
