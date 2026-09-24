from __future__ import annotations

# Permission registry keyed by (organization type, role); each TZ part adds its codes (P01 §5, P02 §4).
_MEMBER_ADMIN = frozenset(
    {"members.view", "members.invite", "members.change_role", "members.suspend", "members.revoke"}
)
_ORG_OWNER = frozenset({"org.view", "org.edit_contacts", "org.edit_legal", "verification.submit", "verification.view"})

PERMISSIONS: dict[tuple[str, str], frozenset[str]] = {
    ("COMPANY", "OWNER"): _MEMBER_ADMIN | _ORG_OWNER,
    ("COMPANY", "MANAGER"): frozenset({"members.view", "org.view", "org.edit_contacts", "verification.view"}),
    ("COMPANY", "OPERATOR"): frozenset({"org.view"}),
    ("COMPANY", "WAREHOUSE"): frozenset({"org.view"}),
    ("COMPANY", "COURIER"): frozenset({"org.view"}),
    ("STORE", "OWNER"): _MEMBER_ADMIN | _ORG_OWNER,
    ("STORE", "SELLER"): frozenset({"org.view"}),
}


def permissions_for(org_type: str, role: str) -> frozenset[str]:
    return PERMISSIONS.get((org_type, role), frozenset())
