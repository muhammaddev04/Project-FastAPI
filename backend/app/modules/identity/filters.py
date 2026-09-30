"""P01 §6 `GET /members` query (FND-011): filter `role`, `status`; search `full_name`, `phone`; no ordering."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.core.filtering import ListQuery
from app.modules.identity.models import Membership, User


class MemberQuery(ListQuery):
    role: Literal["OWNER", "MANAGER", "OPERATOR", "WAREHOUSE", "COURIER", "SELLER"] | None = None
    status: Literal["ACTIVE", "SUSPENDED", "REVOKED"] | None = None
    search: str | None = Field(None, max_length=100, description="Part of the full name or phone number.")

    filter_columns = {"role": Membership.role, "status": Membership.status}
    search_columns = (User.full_name, User.phone)
    fixed_ordering = (Membership.joined_at,)
