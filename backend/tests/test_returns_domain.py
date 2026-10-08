"""P10 domain evidence. Persistence, APIs and the browser flow are still pending."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest

from app.core.errors import AppError
from app.modules.returns.domain import (
    CompletionLine,
    completion_credit,
    discount_factor,
    ensure_disputable_order,
    ensure_dispute_adjustment,
    ensure_dispute_transition,
    ensure_dispute_window,
    ensure_payment_dispute_window,
    ensure_return_quantity,
    ensure_return_transition,
    ensure_return_window,
    ensure_returnable_order,
    ensure_within,
    line_credit,
    max_returnable,
    restock_base_quantity,
    return_deadline,
    sla_warning_anchor,
)

DELIVERED_AT = datetime(2026, 10, 1, 9, tzinfo=UTC)


def line(number: int, price: str, accepted: str, restock: str, coefficient: str = "1.000") -> CompletionLine:
    return CompletionLine(UUID(int=number), Decimal(price), Decimal(coefficient), Decimal(accepted), Decimal(restock))


def test_ret_001_order_status_required() -> None:
    for status in ("DELIVERED", "DISPUTED", "COMPLETED"):
        ensure_returnable_order(status)
    for status in ("DRAFT", "CONFIRMED", "ASSEMBLED", "IN_TRANSIT", "CANCELLED"):
        with pytest.raises(AppError) as error:
            ensure_returnable_order(status)
        assert error.value.http_status == 409


def test_ret_002_window_closed() -> None:
    assert return_deadline(DELIVERED_AT, 14) == DELIVERED_AT + timedelta(days=14)
    ensure_return_window(DELIVERED_AT, 14, DELIVERED_AT + timedelta(days=14))
    with pytest.raises(AppError) as error:
        ensure_return_window(DELIVERED_AT, 14, DELIVERED_AT + timedelta(days=14, seconds=1))
    assert error.value.code == "return_window_closed"


def test_ret_002_zero_days_forbids_returns() -> None:
    assert return_deadline(DELIVERED_AT, 0) is None
    with pytest.raises(AppError) as error:
        ensure_return_window(DELIVERED_AT, 0, DELIVERED_AT)
    assert error.value.code == "return_window_closed"


def test_ret_003_quantity_exceeds_considers_previous_returns() -> None:
    assert max_returnable(Decimal("10.000"), Decimal("4.000")) == Decimal("6.000")
    # Everything already came back: the line is exhausted, not negative.
    assert max_returnable(Decimal("10.000"), Decimal("10.000")) == Decimal("0.000")
    assert ensure_return_quantity(Decimal("6.000"), Decimal("10.000"), Decimal("4.000")) == Decimal("6.000")
    with pytest.raises(AppError) as error:
        ensure_return_quantity(Decimal("6.001"), Decimal("10.000"), Decimal("4.000"))
    assert error.value.code == "return_quantity_exceeds"
    assert error.value.details["max_returnable"] == "6.000"
    with pytest.raises(AppError):
        ensure_return_quantity(Decimal("0.000"), Decimal("10.000"), Decimal("0.000"))


def test_quantity_ladder_is_bounded_by_the_previous_step() -> None:
    assert ensure_within(Decimal("3.000"), Decimal("3.000"), "approved_quantity") == Decimal("3.000")
    # Zero is allowed at every step: an approved line may be received or accepted as nothing.
    assert ensure_within(Decimal("0.000"), Decimal("3.000"), "received_quantity") == Decimal("0.000")
    with pytest.raises(AppError) as error:
        ensure_within(Decimal("3.001"), Decimal("3.000"), "accepted_quantity")
    assert error.value.code == "quantity_invalid"
    assert error.value.details["field"] == "accepted_quantity"


def test_ret_010_credit_with_proportional_discount_no_delivery_fee() -> None:
    # Order: 1000.00 of goods, 100.00 discount, delivery fee excluded from any credit.
    factor = discount_factor(Decimal("1000.00"), Decimal("100.00"))
    assert factor == Decimal("0.9")
    assert line_credit(Decimal("2.000"), Decimal("250.00"), factor) == Decimal("450.00")
    credit = completion_credit(
        [line(1, "250.00", "2.000", "2.000"), line(2, "500.00", "1.000", "0.000")],
        Decimal("1000.00"),
        Decimal("100.00"),
    )
    assert credit.total_credit == Decimal("900.00")
    assert credit.lines == ((UUID(int=1), Decimal("450.00")), (UUID(int=2), Decimal("450.00")))
    # A full-price order keeps the line value, and no delivery fee is ever added back.
    assert completion_credit([line(1, "250.00", "2.000", "0.000")], Decimal("500.00"), Decimal("0")).total_credit == (
        Decimal("500.00")
    )


def test_ret_010_rounds_once_per_line() -> None:
    factor = discount_factor(Decimal("300.00"), Decimal("100.00"))
    # 1 x 10.00 x 2/3 = 6.666... -> 6.67 per line, never a rounded factor reused.
    credit = completion_credit(
        [line(1, "10.00", "1.000", "0.000"), line(2, "10.00", "1.000", "0.000")], Decimal("300.00"), Decimal("100.00")
    )
    assert line_credit(Decimal("1.000"), Decimal("10.00"), factor) == Decimal("6.67")
    assert credit.total_credit == Decimal("13.34")


def test_ret_012_restock_movement_base_units() -> None:
    # A 12-unit box: 2 boxes restocked are 24 base units for the warehouse.
    assert restock_base_quantity(Decimal("2.000"), Decimal("12.000")) == Decimal("24.000")
    credit = completion_credit([line(1, "100.00", "3.000", "2.000", "12.000")], Decimal("300.00"), Decimal("0"))
    assert credit.restock == ((UUID(int=1), Decimal("24.000")),)


def test_ret_012_damaged_not_restocked() -> None:
    # Accepted for credit but zero restock: the goods are damaged and never reach the warehouse.
    credit = completion_credit([line(1, "100.00", "3.000", "0.000", "12.000")], Decimal("300.00"), Decimal("0"))
    assert credit.total_credit == Decimal("300.00")
    assert credit.restock == ()


def test_return_state_machine_valid_invalid() -> None:
    assert ensure_return_transition("REQUESTED", "approve") == "APPROVED"
    assert ensure_return_transition("REQUESTED", "reject") == "REJECTED"
    assert ensure_return_transition("REQUESTED", "cancel") == "CANCELLED"
    assert ensure_return_transition("APPROVED", "cancel") == "CANCELLED"
    assert ensure_return_transition("APPROVED", "receive") == "RECEIVED"
    assert ensure_return_transition("RECEIVED", "complete") == "COMPLETED"
    for status, action in (
        ("REQUESTED", "receive"),
        ("REQUESTED", "complete"),
        ("APPROVED", "approve"),
        ("RECEIVED", "receive"),
        ("COMPLETED", "complete"),
        ("REJECTED", "approve"),
        ("CANCELLED", "receive"),
    ):
        with pytest.raises(AppError) as error:
            ensure_return_transition(status, action)
        assert error.value.code == "invalid_transition"


def test_dsp_001_window_and_order_status() -> None:
    ensure_disputable_order("DELIVERED")
    for status in ("CONFIRMED", "IN_TRANSIT", "COMPLETED", "DISPUTED", "CANCELLED"):
        with pytest.raises(AppError):
            ensure_disputable_order(status)
    ensure_dispute_window(DELIVERED_AT, 48, DELIVERED_AT + timedelta(hours=48))
    with pytest.raises(AppError) as error:
        ensure_dispute_window(DELIVERED_AT, 48, DELIVERED_AT + timedelta(hours=48, seconds=1))
    assert error.value.code == "dispute_window_closed"


def test_dsp_002_payment_dispute_window_is_thirty_days() -> None:
    ensure_payment_dispute_window(DELIVERED_AT, DELIVERED_AT + timedelta(days=30))
    with pytest.raises(AppError) as error:
        ensure_payment_dispute_window(DELIVERED_AT, DELIVERED_AT + timedelta(days=30, seconds=1))
    assert error.value.code == "dispute_window_closed"


def test_dispute_state_machine_valid_invalid() -> None:
    assert ensure_dispute_transition("OPEN", "start_review") == "UNDER_REVIEW"
    assert ensure_dispute_transition("OPEN", "resolve") == "RESOLVED"
    assert ensure_dispute_transition("UNDER_REVIEW", "resolve") == "RESOLVED"
    assert ensure_dispute_transition("OPEN", "reject") == "REJECTED"
    assert ensure_dispute_transition("UNDER_REVIEW", "withdraw") == "WITHDRAWN"
    for status, action in (
        ("UNDER_REVIEW", "start_review"),
        ("RESOLVED", "resolve"),
        ("REJECTED", "reject"),
        ("WITHDRAWN", "withdraw"),
        ("RESOLVED", "start_review"),
    ):
        with pytest.raises(AppError) as error:
            ensure_dispute_transition(status, action)
        assert error.value.code == "invalid_transition"


def test_dsp_021_adjustment_cannot_exceed_the_order() -> None:
    assert ensure_dispute_adjustment(Decimal("1200.00"), Decimal("1200.00")) == Decimal("1200.00")
    for amount in (Decimal("1200.01"), Decimal("0.00"), Decimal("-5.00")):
        with pytest.raises(AppError) as error:
            ensure_dispute_adjustment(amount, Decimal("1200.00"))
        assert error.value.http_status == 422


def test_dsp_024_sla_warning_idempotent() -> None:
    opened = datetime(2026, 10, 1, 9, tzinfo=UTC)
    assert sla_warning_anchor(opened, opened + timedelta(hours=47, minutes=59)) is None
    first = opened + timedelta(hours=48)
    # Every moment inside the same 24-hour step claims one anchor, so a retry warns once.
    assert sla_warning_anchor(opened, first) == first
    assert sla_warning_anchor(opened, first + timedelta(hours=23, minutes=59)) == first
    assert sla_warning_anchor(opened, first + timedelta(hours=24)) == first + timedelta(hours=24)
    assert sla_warning_anchor(opened, first + timedelta(days=7)) == first + timedelta(days=7)
