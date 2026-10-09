"""P11 channel rules; owner deferred SMS on 2026-10-09."""

from dataclasses import dataclass


@dataclass(frozen=True)
class EventPolicy:
    group: str
    telegram: bool = True


POLICIES: dict[str, EventPolicy] = {}


def _register(events: str, policy: EventPolicy) -> None:
    for event in events.split():
        POLICIES[event] = policy


_register(
    "VERIFICATION_SUBMITTED PLAN_CHANGE_REQUESTED STOCK_RECONCILIATION_MISMATCH FINANCE_RECONCILIATION_MISMATCH",
    EventPolicy("admin"),
)
_register("VERIFICATION_APPROVED VERIFICATION_REJECTED", EventPolicy("account"))
_register("SUBSCRIPTION_EXPIRING SUBSCRIPTION_STATUS_CHANGED", EventPolicy("billing"))
_register("IMPORT_COMPLETED IMPORT_FAILED", EventPolicy("catalog"))
_register("LOW_STOCK", EventPolicy("stock", telegram=False))
_register(
    "PARTNERSHIP_INVITED PARTNERSHIP_REQUESTED PARTNERSHIP_ACTIVATED PARTNERSHIP_SUSPENDED "
    "PARTNERSHIP_TERMINATED TERMS_CHANGED",
    EventPolicy("partners"),
)
_register(
    "ORDER_CREATED ORDER_CONFIRMED ORDER_PARTIALLY_CONFIRMED ORDER_REJECTED ORDER_CANCELLED", EventPolicy("orders")
)
_register("ORDER_READY", EventPolicy("delivery", telegram=False))
_register(
    "DELIVERY_ASSIGNED DELIVERY_CODE_LOCKED DELIVERY_MANUAL_CONFIRMED DELIVERY_DISPATCHED "
    "DELIVERY_COMPLETED DELIVERY_FAILED",
    EventPolicy("delivery"),
)
_register(
    "PAYMENT_RECORDED PAYMENT_CONFIRMED PAYMENT_REJECTED ADJUSTMENT_APPROVED DEBT_DUE_SOON DEBT_OVERDUE "
    "ADJUSTMENT_PENDING_APPROVAL",
    EventPolicy("finance"),
)
_register(
    "RETURN_REQUESTED RETURN_APPROVED RETURN_REJECTED RETURN_CANCELLED RETURN_RECEIVED RETURN_COMPLETED",
    EventPolicy("returns"),
)
_register("EXPORT_READY", EventPolicy("exports"))
_register(
    "DISPUTE_OPENED DISPUTE_UNDER_REVIEW DISPUTE_MESSAGE DISPUTE_MESSAGE_ADDED DISPUTE_RESOLVED DISPUTE_REJECTED "
    "DISPUTE_WITHDRAWN DISPUTE_SLA_WARNING",
    EventPolicy("disputes"),
)

GROUPS = tuple(dict.fromkeys(policy.group for policy in POLICIES.values()))


def channel_enabled(policy: EventPolicy, channel: str, preference: bool | None) -> bool:
    if channel == "IN_APP":
        return True
    if channel == "TELEGRAM":
        return policy.telegram if preference is None else preference
    if channel == "SMS":
        return False
    raise ValueError("Unknown notification channel")
