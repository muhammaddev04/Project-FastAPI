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

PERMISSIONS: dict[tuple[str, str], frozenset[str]] = {
    ("COMPANY", "OWNER"): _MEMBER_ADMIN
    | _ORG_OWNER
    | _CATALOG_ADMIN
    | _STOCK_ADMIN
    | {"subscription.view", "subscription.manage"},
    ("COMPANY", "MANAGER"): frozenset(
        {"members.view", "org.view", "org.edit_contacts", "verification.view", "subscription.view"}
    )
    | _CATALOG_ADMIN
    | _STOCK_ADMIN,
    ("COMPANY", "OPERATOR"): frozenset({"org.view", "catalog.view", "pricing.view", "stock.view"}),
    ("COMPANY", "WAREHOUSE"): frozenset({"org.view", "catalog.view", "stock.view", "stock.receive", "stock.settings"}),
    ("COMPANY", "COURIER"): frozenset({"org.view"}),
    ("STORE", "OWNER"): _MEMBER_ADMIN | _ORG_OWNER,
    ("STORE", "SELLER"): frozenset({"org.view"}),
}


def permissions_for(org_type: str, role: str) -> frozenset[str]:
    return PERMISSIONS.get((org_type, role), frozenset())
