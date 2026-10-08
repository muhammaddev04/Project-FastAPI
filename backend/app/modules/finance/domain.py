"""Exact financial calculations shared by posting, previews and credit control.

These functions never write data. The persistence layer must serialize a partnership
before applying an allocation plan and post its ledger in the same transaction.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from app.core.errors import AppError

ZERO = Decimal("0.00")
CENT = Decimal("0.01")
MAX_PAYMENT = Decimal("10000000.00")
FINANCE_TIMEZONE = ZoneInfo("Asia/Dushanbe")
Direction = Literal["DEBIT", "CREDIT"]
EntryType = Literal["CHARGE", "PAYMENT", "CREDIT_NOTE", "ADJUSTMENT_DEBIT", "ADJUSTMENT_CREDIT", "REFUND"]
AgingBucket = Literal["current", "1-30", "31-60", "61-90", "90+"]
ChargeStatus = Literal["OPEN", "PARTIALLY_PAID", "PAID"]
ENTRY_DIRECTIONS: dict[EntryType, Direction] = {
    "CHARGE": "DEBIT",
    "PAYMENT": "CREDIT",
    "CREDIT_NOTE": "CREDIT",
    "ADJUSTMENT_DEBIT": "DEBIT",
    "ADJUSTMENT_CREDIT": "CREDIT",
    "REFUND": "DEBIT",
}


def payment_amount(value: Decimal) -> Decimal:
    """FIN-020: reject extra decimal places rather than silently rounding money."""
    if not value.is_finite() or value <= ZERO or value > MAX_PAYMENT or value % CENT != ZERO:
        raise AppError("validation_error", 422, {"field": "amount"})
    return value.quantize(CENT)


def local_date(timestamp: datetime) -> date:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("Financial timestamps must be timezone-aware")
    return timestamp.astimezone(FINANCE_TIMEZONE).date()


def order_due_date(delivered_at: datetime, credit_days: int) -> date:
    """FIN-010/012: use the frozen order terms and the Dushanbe delivery date."""
    if not 0 <= credit_days <= 180:
        raise ValueError("credit_days must be between zero and 180")
    return local_date(delivered_at) + timedelta(days=credit_days)


def posted_balance(balance: Decimal, amount: Decimal, entry_type: EntryType) -> Decimal:
    if not amount.is_finite() or amount <= ZERO or amount % CENT != ZERO:
        raise ValueError("Ledger amounts must be positive whole cents")
    return balance + amount if ENTRY_DIRECTIONS[entry_type] == "DEBIT" else balance - amount


@dataclass(frozen=True)
class ChargeInput:
    id: UUID
    amount: Decimal
    allocated_amount: Decimal
    due_date: date
    created_at: datetime

    @property
    def remaining(self) -> Decimal:
        return self.amount - self.allocated_amount


@dataclass(frozen=True)
class CreditInput:
    id: UUID
    amount: Decimal
    allocated_amount: Decimal
    created_at: datetime

    @property
    def remaining(self) -> Decimal:
        return self.amount - self.allocated_amount


@dataclass(frozen=True)
class AllocationLine:
    charge_id: UUID
    credit_id: UUID
    amount: Decimal


def _validate_items(items: list[ChargeInput] | list[CreditInput]) -> None:
    if len({item.id for item in items}) != len(items):
        raise ValueError("Duplicate financial item")
    for item in items:
        if (
            not item.amount.is_finite()
            or not item.allocated_amount.is_finite()
            or item.amount <= ZERO
            or not ZERO <= item.allocated_amount <= item.amount
            or item.amount % CENT != ZERO
            or item.allocated_amount % CENT != ZERO
        ):
            raise ValueError("Invalid financial item amounts")
        local_date(item.created_at)


def allocate_fifo(charges: list[ChargeInput], credits: list[CreditInput]) -> list[AllocationLine]:
    """FIN-031/032: stable greedy allocation without changing either input."""
    _validate_items(charges)
    _validate_items(credits)
    ordered_charges = sorted(charges, key=lambda item: (item.due_date, item.created_at, item.id))
    ordered_credits = sorted(credits, key=lambda item: (item.created_at, item.id))
    lines: list[AllocationLine] = []
    credit_index = 0
    credit_left = ordered_credits[0].remaining if ordered_credits else ZERO
    for charge in ordered_charges:
        charge_left = charge.remaining
        while charge_left > ZERO and credit_index < len(ordered_credits):
            if credit_left == ZERO:
                credit_index += 1
                if credit_index < len(ordered_credits):
                    credit_left = ordered_credits[credit_index].remaining
                continue
            allocated = min(charge_left, credit_left)
            lines.append(AllocationLine(charge.id, ordered_credits[credit_index].id, allocated))
            charge_left -= allocated
            credit_left -= allocated
    return lines


def charge_status(amount: Decimal, allocated_amount: Decimal) -> ChargeStatus:
    if not amount.is_finite() or not allocated_amount.is_finite() or amount <= ZERO:
        raise ValueError("Invalid charge amount")
    if not ZERO <= allocated_amount <= amount:
        raise ValueError("Invalid allocated amount")
    if allocated_amount == amount:
        return "PAID"
    return "PARTIALLY_PAID" if allocated_amount > ZERO else "OPEN"


def aging_bucket(due_date: date, today: date) -> AgingBucket:
    days = (today - due_date).days
    if days <= 0:
        return "current"
    if days <= 30:
        return "1-30"
    if days <= 60:
        return "31-60"
    if days <= 90:
        return "61-90"
    return "90+"


def aging(charges: list[ChargeInput], today: date) -> dict[AgingBucket, Decimal]:
    _validate_items(charges)
    result: dict[AgingBucket, Decimal] = {
        "current": ZERO,
        "1-30": ZERO,
        "31-60": ZERO,
        "61-90": ZERO,
        "90+": ZERO,
    }
    for charge in charges:
        result[aging_bucket(charge.due_date, today)] += charge.remaining
    return result


@dataclass(frozen=True)
class CreditCheck:
    allowed: bool
    limit: Decimal
    balance: Decimal
    outstanding: Decimal
    unapplied: Decimal
    available: Decimal


def credit_check(limit: Decimal, outstanding: Decimal, unapplied: Decimal, amount: Decimal) -> CreditCheck:
    """FIN-002/050: prepayments increase available credit through the net balance."""
    values = (limit, outstanding, unapplied, amount)
    if any(not value.is_finite() or value < ZERO or value % CENT != ZERO for value in values):
        raise ValueError("Credit values must be nonnegative whole cents")
    balance = outstanding - unapplied
    return CreditCheck(balance + amount <= limit, limit, balance, outstanding, unapplied, limit - balance)


def reminder_kind(due_date: date, today: date) -> Literal["DUE_SOON", "OVERDUE"] | None:
    """FIN-053: first overdue day, then every seven days; deduplication belongs in DB."""
    days = (today - due_date).days
    if days == -1:
        return "DUE_SOON"
    if days >= 1 and (days - 1) % 7 == 0:
        return "OVERDUE"
    return None
