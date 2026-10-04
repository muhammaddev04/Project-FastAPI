from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from app.core.errors import AppError
from app.modules.subscriptions.domain import (
    Lifecycle,
    LimitKind,
    SubAction,
    SubscriptionStatus,
    activate_from_payment,
    add_calendar_months,
    check_usage,
    due_transitions,
    payment_period,
    require_action,
)

COMPANY = UUID("00000000-0000-0000-0000-000000000001")
NOW = datetime(2026, 1, 31, 12, 30, tzinfo=UTC)


@pytest.mark.parametrize("status", list(SubscriptionStatus))
@pytest.mark.parametrize("action", list(SubAction))
def test_sub_006_guard_matrix(status: SubscriptionStatus, action: SubAction) -> None:
    # Expected permissions are written independently of the production action sets.
    denied = {
        SubscriptionStatus.SOFT_BLOCK: {"NEW_ORDER", "PARTNERSHIP_NEW", "MEMBER_INVITE"},
        SubscriptionStatus.FULL_BLOCK: {
            "NEW_ORDER",
            "PARTNERSHIP_NEW",
            "MEMBER_INVITE",
            "ORDER_FULFILLMENT",
            "CATALOG_WRITE",
        },
        SubscriptionStatus.CANCELLED: {
            "NEW_ORDER",
            "PARTNERSHIP_NEW",
            "MEMBER_INVITE",
            "ORDER_FULFILLMENT",
            "CATALOG_WRITE",
        },
    }
    if action.value in denied.get(status, set()):
        with pytest.raises(AppError) as error:
            require_action(COMPANY, status, action)
        assert error.value.code == "subscription_blocked"
        assert error.value.http_status == 403
        assert error.value.details == {"status": status.value, "company_id": str(COMPANY)}
    else:
        require_action(COMPANY, status, action)


@pytest.mark.parametrize(
    ("start", "months", "expected"),
    [
        (NOW, 1, datetime(2026, 2, 28, 12, 30, tzinfo=UTC)),
        (NOW.replace(year=2024), 1, datetime(2024, 2, 29, 12, 30, tzinfo=UTC)),
        (NOW, 2, datetime(2026, 3, 31, 12, 30, tzinfo=UTC)),
        (NOW.replace(month=12), 1, datetime(2027, 1, 31, 12, 30, tzinfo=UTC)),
        (NOW.replace(year=2024, month=2, day=29), 12, datetime(2025, 2, 28, 12, 30, tzinfo=UTC)),
    ],
)
def test_sub_004_calendar_months(start: datetime, months: int, expected: datetime) -> None:
    assert add_calendar_months(start, months) == expected


@pytest.mark.parametrize("status", list(SubscriptionStatus))
@pytest.mark.parametrize("remaining", [-1, 0, 5])
def test_sub_004_payment_start(status: SubscriptionStatus, remaining: int) -> None:
    end = NOW + timedelta(days=remaining)
    start, new_end = payment_period(status, end, NOW, 1)
    assert start == (end if status == SubscriptionStatus.ACTIVE and remaining > 0 else NOW)
    assert new_end > start


def test_sub_004_active_without_period_uses_now() -> None:
    assert payment_period(SubscriptionStatus.ACTIVE, None, NOW, 1)[0] == NOW


@pytest.mark.parametrize("months", [-1, 0, 13])
def test_sub_004_invalid_months(months: int) -> None:
    with pytest.raises(ValueError):
        add_calendar_months(NOW, months)


@pytest.mark.parametrize("kind", list(LimitKind))
def test_sub_008_limit_boundary_and_downgrade(kind: LimitKind) -> None:
    check_usage(kind, 4, 5)
    with pytest.raises(AppError) as error:
        check_usage(kind, 5, 5)
    assert error.value.code == "subscription_limit_reached"
    assert error.value.http_status == 403
    assert error.value.details == {"limit": kind.value, "current": 5, "max": 5}
    with pytest.raises(AppError):
        check_usage(kind, 9, 5)
    check_usage(kind, 1_000_000, None)


def test_sub_008_bulk_increment() -> None:
    with pytest.raises(AppError):
        check_usage(LimitKind.PRODUCTS, 490, 500, adding=11)
    check_usage(LimitKind.PRODUCTS, 490, 500, adding=10)


@pytest.mark.parametrize(("current", "maximum", "adding"), [(-1, 5, 1), (1, 0, 1), (1, -1, 1), (1, 5, -1)])
def test_sub_008_invalid_counts(current: int, maximum: int, adding: int) -> None:
    with pytest.raises(ValueError):
        check_usage(LimitKind.USERS, current, maximum, adding)


def test_sub_005_delayed_tick_catches_up_without_extending_deadlines() -> None:
    original = Lifecycle(SubscriptionStatus.TRIAL, trial_ends_at=NOW)
    transitions = due_transitions(original, NOW + timedelta(days=22))
    assert [entry.after for entry in transitions] == [
        SubscriptionStatus.GRACE,
        SubscriptionStatus.SOFT_BLOCK,
        SubscriptionStatus.FULL_BLOCK,
    ]
    assert [entry.effective_at for entry in transitions] == [NOW, NOW + timedelta(days=7), NOW + timedelta(days=21)]
    assert transitions[-1].state.grace_ends_at == NOW + timedelta(days=7)
    assert transitions[-1].state.soft_block_ends_at == NOW + timedelta(days=21)
    assert due_transitions(transitions[-1].state, NOW + timedelta(days=22)) == ()
    assert original.status == SubscriptionStatus.TRIAL


@pytest.mark.parametrize(
    ("state", "target"),
    [
        (Lifecycle(SubscriptionStatus.TRIAL, trial_ends_at=NOW), SubscriptionStatus.GRACE),
        (Lifecycle(SubscriptionStatus.ACTIVE, current_period_end=NOW), SubscriptionStatus.GRACE),
        (Lifecycle(SubscriptionStatus.GRACE, grace_ends_at=NOW), SubscriptionStatus.SOFT_BLOCK),
        (Lifecycle(SubscriptionStatus.SOFT_BLOCK, soft_block_ends_at=NOW), SubscriptionStatus.FULL_BLOCK),
    ],
)
def test_sub_005_deadline_inclusive(state: Lifecycle, target: SubscriptionStatus) -> None:
    assert due_transitions(state, NOW - timedelta(microseconds=1)) == ()
    assert due_transitions(state, NOW)[0].after == target


def test_sub_011_cancellation_skips_grace() -> None:
    state = Lifecycle(SubscriptionStatus.ACTIVE, current_period_end=NOW, cancel_at_period_end=True)
    transitions = due_transitions(state, NOW + timedelta(days=100))
    assert len(transitions) == 1
    assert transitions[0].after == SubscriptionStatus.CANCELLED


@pytest.mark.parametrize("status", list(SubscriptionStatus))
def test_payment_reactivates_each_status_and_resets_cancellation(status: SubscriptionStatus) -> None:
    original = Lifecycle(
        status,
        trial_ends_at=NOW - timedelta(days=21),
        current_period_end=NOW + timedelta(days=5),
        grace_ends_at=NOW - timedelta(days=14),
        soft_block_ends_at=NOW,
        cancel_at_period_end=True,
    )
    activated, start, end = activate_from_payment(original, NOW, 1)
    assert activated.status == SubscriptionStatus.ACTIVE
    assert activated.current_period_end == end
    assert activated.grace_ends_at is None
    assert activated.soft_block_ends_at is None
    assert activated.cancel_at_period_end is False
    assert activated.trial_ends_at == original.trial_ends_at
    assert start == (NOW + timedelta(days=5) if status == SubscriptionStatus.ACTIVE else NOW)
    assert original.status == status
    assert original.cancel_at_period_end is True


@pytest.mark.parametrize("status", [SubscriptionStatus.CANCELLED, SubscriptionStatus.FULL_BLOCK])
def test_sub_005_terminal_status_has_no_timed_transition(status: SubscriptionStatus) -> None:
    assert due_transitions(Lifecycle(status), NOW) == ()


@pytest.mark.parametrize(
    "status",
    [SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE, SubscriptionStatus.SOFT_BLOCK],
)
def test_sub_005_missing_deadline_fails_explicitly(status: SubscriptionStatus) -> None:
    with pytest.raises(ValueError, match="expiry deadline"):
        due_transitions(Lifecycle(status), NOW)


def test_subscription_rejects_naive_dates() -> None:
    naive = NOW.replace(tzinfo=None)
    with pytest.raises(ValueError, match="timezone-aware"):
        add_calendar_months(naive, 1)
    with pytest.raises(ValueError, match="timezone-aware"):
        payment_period(SubscriptionStatus.ACTIVE, naive, NOW, 1)
    with pytest.raises(ValueError, match="timezone-aware"):
        due_transitions(Lifecycle(SubscriptionStatus.TRIAL, trial_ends_at=naive), NOW)
