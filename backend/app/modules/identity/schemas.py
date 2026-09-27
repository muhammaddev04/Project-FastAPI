from __future__ import annotations

import re
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

_PHONE_SEPARATORS = re.compile(r"[\s\-().]")
_E164 = re.compile(r"\+[1-9][0-9]{7,14}")

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
    #: CR-003: 5-minute signed URL of the company logo / store image (SEC-008), null when there is none.
    logo_url: str | None = None


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
    #: CR-003: 5-minute signed URL of the user's own avatar (SEC-008), null when there is none.
    avatar_url: str | None = None
    last_login_at: datetime | None
    created_at: datetime
    memberships: list[MembershipOut]
    onboarding: Onboarding


class MeUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    full_name: str | None = Field(default=None, min_length=2, max_length=150)
    language: Language | None = None
    #: CR-003: optional contact phone (CR-001: never a login). `null` or "" clears it; spaces, dashes and
    #: brackets are removed, then the value must be E.164 (P01 §2.1).
    phone: str | None = None

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, value: object) -> object:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("phone must be a string")
        cleaned = _PHONE_SEPARATORS.sub("", value)
        if cleaned == "":
            return None
        if not _E164.fullmatch(cleaned):
            raise ValueError("phone must be in international E.164 format, e.g. +992900000000")
        return cleaned


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
