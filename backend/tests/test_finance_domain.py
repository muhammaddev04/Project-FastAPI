"""P09 domain evidence; transactional/database acceptance is still pending."""

import random
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest

from app.core.errors import AppError
from app.modules.finance.domain import (
    ENTRY_DIRECTIONS,
    ChargeInput,
    CreditInput,
    aging,
    aging_bucket,
    allocate_fifo,
    charge_status,
    credit_check,
    local_date,
    order_due_date,
    payment_amount,
    posted_balance,
    reminder_kind,
)

NOW = datetime(2026, 10, 8, 12, tzinfo=UTC)
TODAY = date(2026, 10, 8)
ZERO = Decimal("0.00")


def charge(number: int, amount: str, days: int = 0, allocated: str = "0") -> ChargeInput:
    return ChargeInput(UUID(int=number), Decimal(amount), Decimal(allocated), TODAY + timedelta(days=days), NOW)


def credit(number: int, amount: str, allocated: str = "0") -> CreditInput:
    return CreditInput(UUID(int=number), Decimal(amount), Decimal(allocated), NOW)


def test_fin_034_example_1000_700_500_payment_1200() -> None:
    charges = [charge(1, "1000"), charge(2, "700"), charge(3, "500")]
    lines = allocate_fifo(charges, [credit(4, "1200")])
    assert [(line.charge_id.int, line.amount) for line in lines] == [(1, Decimal("1000")), (2, Decimal("200"))]
    assert [
        charge_status(item.amount, sum((line.amount for line in lines if line.charge_id == item.id), ZERO))
        for item in charges
    ] == ["PAID", "PARTIALLY_PAID", "OPEN"]
    assert all(item.allocated_amount == ZERO for item in charges)


def test_fin_031_fifo_order_by_due_date_created_at_and_id() -> None:
    charges = [
        charge(1, "10", days=1),
        charge(3, "10"),
        replace(charge(4, "10"), created_at=NOW - timedelta(seconds=1)),
        charge(2, "10"),
    ]
    credits = [credit(9, "15"), replace(credit(10, "5"), created_at=NOW - timedelta(seconds=1)), credit(8, "5")]
    lines = allocate_fifo(charges, credits)
    assert [(line.charge_id.int, line.credit_id.int, line.amount) for line in lines] == [
        (4, 10, Decimal("5")),
        (4, 8, Decimal("5")),
        (2, 9, Decimal("10")),
        (3, 9, Decimal("5")),
    ]


def test_fin_033_overpayment_then_next_charge() -> None:
    paid = credit(5, "1200")
    assert allocate_fifo([charge(1, "1000")], [paid])[0].amount == Decimal("1000")
    paid = replace(paid, allocated_amount=Decimal("1000"))
    lines = allocate_fifo([charge(1, "1000", allocated="1000"), charge(2, "500")], [paid])
    assert len(lines) == 1
    assert lines[0].charge_id.int == 2
    assert lines[0].amount == Decimal("200")


def test_fifo_empty_and_fully_allocated_items() -> None:
    assert allocate_fifo([], [credit(1, "10")]) == []
    assert allocate_fifo([charge(1, "10")], []) == []
    lines = allocate_fifo(
        [charge(1, "10", allocated="10"), charge(2, "10")], [credit(3, "10", allocated="10"), credit(4, "5")]
    )
    assert len(lines) == 1
    assert (lines[0].charge_id.int, lines[0].credit_id.int, lines[0].amount) == (2, 4, Decimal("5"))


@pytest.mark.parametrize("seed", range(200))
def test_fifo_conservation_capacity_and_determinism_generated(seed: int) -> None:
    rng = random.Random(seed)
    charges = [
        charge(i + 1, str(rng.randrange(1, 100000) / Decimal(100)), rng.randrange(-100, 100))
        for i in range(rng.randrange(1, 15))
    ]
    credits = [credit(i + 100, str(rng.randrange(1, 100000) / Decimal(100))) for i in range(rng.randrange(1, 15))]
    lines = allocate_fifo(charges, credits)
    allocated = sum((line.amount for line in lines), ZERO)
    outstanding_before = sum((item.remaining for item in charges), ZERO)
    unapplied_before = sum((item.remaining for item in credits), ZERO)
    assert allocated == min(outstanding_before, unapplied_before)
    assert outstanding_before - unapplied_before == (outstanding_before - allocated) - (unapplied_before - allocated)
    assert all(line.amount > ZERO for line in lines)
    updated_charges = [
        replace(item, allocated_amount=sum((line.amount for line in lines if line.charge_id == item.id), ZERO))
        for item in charges
    ]
    updated_credits = [
        replace(item, allocated_amount=sum((line.amount for line in lines if line.credit_id == item.id), ZERO))
        for item in credits
    ]
    assert all(ZERO <= item.allocated_amount <= item.amount for item in [*updated_charges, *updated_credits])
    assert allocate_fifo(updated_charges, updated_credits) == []
    rng.shuffle(charges)
    rng.shuffle(credits)
    assert allocate_fifo(charges, credits) == lines


@pytest.mark.parametrize("value", ["0", "-1", "10000000.01", "0.001", "NaN", "Infinity", "-Infinity"])
def test_fin_020_invalid_amount(value: str) -> None:
    with pytest.raises(AppError):
        payment_amount(Decimal(value))


@pytest.mark.parametrize("value", ["0.01", "1200", "10000000.00", "1.000"])
def test_fin_020_valid_amount(value: str) -> None:
    assert payment_amount(Decimal(value)) == Decimal(value)


def test_fin_001_ledger_directions() -> None:
    for entry_type, direction in ENTRY_DIRECTIONS.items():
        result = posted_balance(Decimal("10"), Decimal("15"), entry_type)
        assert result == (Decimal("25") if direction == "DEBIT" else Decimal("-5"))
    with pytest.raises(ValueError):
        posted_balance(ZERO, Decimal("-1"), "CHARGE")


def test_fin_010_012_due_date_local_boundary_and_frozen_credit_days() -> None:
    before = datetime(2026, 10, 8, 18, 59, 59, tzinfo=UTC)
    after = datetime(2026, 10, 8, 19, tzinfo=UTC)
    assert order_due_date(before, 0) == TODAY
    assert order_due_date(after, 30) == date(2026, 11, 8)
    with pytest.raises(ValueError):
        local_date(datetime(2026, 10, 8))  # noqa: DTZ001 - intentionally invalid input
    with pytest.raises(ValueError):
        order_due_date(after, 181)


@pytest.mark.parametrize(
    "days,bucket",
    [
        (-1, "current"),
        (0, "current"),
        (1, "1-30"),
        (30, "1-30"),
        (31, "31-60"),
        (60, "31-60"),
        (61, "61-90"),
        (90, "61-90"),
        (91, "90+"),
    ],
)
def test_fin_051_052_aging_boundaries(days: int, bucket: str) -> None:
    assert aging_bucket(TODAY - timedelta(days=days), TODAY) == bucket


def test_aging_counts_only_outstanding() -> None:
    result = aging(
        [charge(1, "100", days=-1, allocated="30"), charge(2, "50", days=-91, allocated="50"), charge(3, "10", days=0)],
        TODAY,
    )
    assert result == {"current": Decimal("10"), "1-30": Decimal("70"), "31-60": ZERO, "61-90": ZERO, "90+": ZERO}


def test_fin_050_credit_check_uses_prepayment_and_equal_limit() -> None:
    result = credit_check(Decimal("1000"), Decimal("700"), Decimal("200"), Decimal("500"))
    assert result.allowed
    assert result.balance == Decimal("500")
    assert result.available == Decimal("500")
    assert not credit_check(Decimal("1000"), Decimal("700"), Decimal("200"), Decimal("500.01")).allowed
    assert credit_check(Decimal("1000"), ZERO, Decimal("200"), Decimal("1200")).allowed


@pytest.mark.parametrize(
    "days,kind",
    [(-2, None), (-1, "DUE_SOON"), (0, None), (1, "OVERDUE"), (2, None), (7, None), (8, "OVERDUE"), (15, "OVERDUE")],
)
def test_fin_053_reminder_schedule(days: int, kind: str | None) -> None:
    assert reminder_kind(TODAY - timedelta(days=days), TODAY) == kind


def test_fifo_rejects_invalid_or_duplicate_items() -> None:
    with pytest.raises(ValueError):
        allocate_fifo([charge(1, "1", allocated="2")], [])
    with pytest.raises(ValueError):
        allocate_fifo([charge(1, "1"), charge(1, "2")], [])
    with pytest.raises(ValueError):
        allocate_fifo([], [credit(1, "0.001")])
    with pytest.raises(ValueError):
        allocate_fifo([], [credit(1, "NaN")])
