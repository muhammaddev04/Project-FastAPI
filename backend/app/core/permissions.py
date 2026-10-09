from __future__ import annotations

# Permission registry keyed by (organization type, role); each TZ part adds its codes (P01 §5, P02 §4).
_MEMBER_ADMIN = frozenset(
    {"members.view", "members.invite", "members.change_role", "members.suspend", "members.revoke"}
)
# CR-003 `org.edit_branding` (company logo / store image): OWNER only - the image is not among the fields ORG-006 lets
# a MANAGER edit.
_ORG_OWNER = frozenset(
    {"org.view", "org.edit_contacts", "org.edit_legal", "org.edit_branding", "verification.submit", "verification.view"}
)
_CATALOG_ADMIN = frozenset({"catalog.view", "catalog.manage", "pricing.view", "pricing.manage", "import.run"})
_STOCK_ADMIN = frozenset({"stock.view", "stock.receive", "stock.adjust", "stock.write_off", "stock.settings"})
_PARTNERS_VIEW = frozenset({"partners.view", "terms.view"})
_PARTNERS_ADMIN = _PARTNERS_VIEW | {"partners.manage", "terms.manage"}
_ORDER_COMPANY = frozenset({"orders.view", "orders.create", "orders.confirm", "orders.reject"})
_ORDER_ADMIN = _ORDER_COMPANY | {
    "orders.discount",
    "orders.override",
    "orders.assemble",
    "orders.cancel",
    "orders.reattempt",
}
_ORDER_STORE = frozenset({"orders.view", "orders.create", "orders.cancel", "store_catalog.view", "cart.manage"})
# P08 §4. `view_all` is read-only board access; `plan` builds runs; `act_own` is what a courier does on
# the stops assigned to them, and `act_any` lets an owner or manager stand in for a courier.
_DELIVERY_VIEW = frozenset({"delivery.view_all"})
_DELIVERY_ADMIN = _DELIVERY_VIEW | {
    "delivery.plan",
    "delivery.act_own",
    "delivery.act_any",
    "delivery.manual_confirm",
    "delivery.regenerate_code",
}
_FINANCE_VIEW = frozenset({"finance.view", "payments.record"})
_FINANCE_ADMIN = _FINANCE_VIEW | {"payments.confirm", "payments.reject", "adjustments.create"}
# P10 §6. A store asks for a return and opens a dispute; the company decides on both. A warehouse
# only receives goods, and review is wider than resolve so an operator can work a dispute without
# being able to close it.
_RETURNS_VIEW = frozenset({"returns.view"})
_RETURNS_ADMIN = _RETURNS_VIEW | {"returns.approve", "returns.receive", "returns.complete"}
_RETURNS_STORE = _RETURNS_VIEW | {"returns.request", "returns.cancel_own"}
_DISPUTES_VIEW = frozenset({"disputes.view"})
_DISPUTES_REVIEW = _DISPUTES_VIEW | {"disputes.message", "disputes.review"}
_DISPUTES_ADMIN = _DISPUTES_REVIEW | {"disputes.resolve"}
_DISPUTES_STORE = _DISPUTES_VIEW | {"disputes.open", "disputes.withdraw", "disputes.message"}

PERMISSIONS: dict[tuple[str, str], frozenset[str]] = {
    ("COMPANY", "OWNER"): _MEMBER_ADMIN
    | _ORG_OWNER
    | _CATALOG_ADMIN
    | _STOCK_ADMIN
    | _PARTNERS_ADMIN
    | _ORDER_ADMIN
    | _DELIVERY_ADMIN
    | _FINANCE_ADMIN
    | _RETURNS_ADMIN
    | _DISPUTES_ADMIN
    | {"adjustments.approve"}
    | {"partners.terminate", "terms.manage_credit"}
    | {"subscription.view", "subscription.manage"},
    ("COMPANY", "MANAGER"): frozenset(
        {"members.view", "org.view", "org.edit_contacts", "verification.view", "subscription.view"}
    )
    | _CATALOG_ADMIN
    | _STOCK_ADMIN
    | _PARTNERS_ADMIN
    | _ORDER_ADMIN
    | _DELIVERY_ADMIN
    | _FINANCE_ADMIN
    | _RETURNS_ADMIN
    | _DISPUTES_ADMIN,
    ("COMPANY", "OPERATOR"): frozenset({"org.view", "catalog.view", "pricing.view", "stock.view"})
    | _PARTNERS_VIEW
    | _ORDER_COMPANY
    | _DELIVERY_VIEW
    | _FINANCE_VIEW
    | _RETURNS_VIEW
    | _DISPUTES_REVIEW,
    ("COMPANY", "WAREHOUSE"): frozenset(
        {"org.view", "catalog.view", "stock.view", "stock.receive", "stock.settings", "orders.view", "orders.assemble"}
    )
    | _DELIVERY_VIEW
    | _RETURNS_VIEW
    | {"returns.receive"},
    ("COMPANY", "COURIER"): frozenset({"org.view", "delivery.act_own", "payments.record"}),
    ("STORE", "OWNER"): _MEMBER_ADMIN
    | _ORG_OWNER
    | _PARTNERS_VIEW
    | _ORDER_STORE
    | _FINANCE_VIEW
    | _RETURNS_STORE
    | _DISPUTES_STORE
    | {"partners.manage", "partners.terminate", "delivery.view_store"},
    ("STORE", "SELLER"): frozenset({"org.view", "delivery.view_store"})
    | _PARTNERS_VIEW
    | _ORDER_STORE
    | _RETURNS_VIEW
    | _DISPUTES_VIEW,
}


def permissions_for(org_type: str, role: str) -> frozenset[str]:
    return PERMISSIONS.get((org_type, role), frozenset())
