from __future__ import annotations

# P01 §5 permission registry keyed by (organization type, role). Later parts add their own codes.
_MEMBER_ADMIN = frozenset(
    {"members.view", "members.invite", "members.change_role", "members.suspend", "members.revoke"}
)

PERMISSIONS: dict[tuple[str, str], frozenset[str]] = {
    ("COMPANY", "OWNER"): _MEMBER_ADMIN,
    ("COMPANY", "MANAGER"): frozenset({"members.view"}),
    ("COMPANY", "OPERATOR"): frozenset(),
    ("COMPANY", "WAREHOUSE"): frozenset(),
    ("COMPANY", "COURIER"): frozenset(),
    ("STORE", "OWNER"): _MEMBER_ADMIN,
    ("STORE", "SELLER"): frozenset(),
}


def permissions_for(org_type: str, role: str) -> frozenset[str]:
    return PERMISSIONS.get((org_type, role), frozenset())
