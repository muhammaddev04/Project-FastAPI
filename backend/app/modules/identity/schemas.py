from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

OrgType = Literal["COMPANY", "STORE"]
Language = Literal["tg", "ru", "en"]


class MembershipOut(BaseModel):
    id: UUID
    organization_id: UUID
    org_type: OrgType
    org_name: str
    org_status: str
    role: str
    status: str
    joined_at: datetime
    permissions: list[str]
    #: The organization's P02 verification status (NOT_SUBMITTED / PENDING / APPROVED / REJECTED).
    verification_status: str | None = None


class Onboarding(BaseModel):
    """P01 §10: what the user chose at registration; `/welcome/company|store` opens with it when they own nothing."""

    org_type: OrgType | None
    org_name: str | None


class MeResponse(BaseModel):
    """GET /me (P01 §6, CR-001): user + memberships with org_type, org_name, org_status and permissions."""

    id: UUID
    email: str
    phone: str | None
    full_name: str
    email_verified: bool
    language: Language
    status: str
    is_superadmin: bool
    phone_verified_at: datetime | None
    last_login_at: datetime | None
    created_at: datetime
    memberships: list[MembershipOut]
    onboarding: Onboarding


class MeUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    full_name: str | None = Field(default=None, min_length=2, max_length=150)
    language: Language | None = None


class MemberOut(BaseModel):
    id: UUID
    user_id: UUID
    full_name: str
    email: str
    phone: str | None
    role: str
    status: str
    joined_at: datetime


class MemberPage(BaseModel):
    """API-002 pagination envelope."""

    count: int
    limit: int
    offset: int
    results: list[MemberOut]
