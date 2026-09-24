from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field, PlainSerializer
from pydantic_core import PydanticCustomError

from app.modules.identity.schemas import MembershipOut, OrgType

_PHONE = re.compile(r"^\+[1-9][0-9]{7,14}$")
_TAX_ID = re.compile(r"^[0-9]{9,12}$")


def _phone(value: str) -> str:
    """E.164; Tajik numbers are +992 followed by exactly 9 digits (TZ §20)."""
    value = re.sub(r"[\s()-]", "", value)
    if not _PHONE.match(value) or (value.startswith("+992") and len(value) != 13):
        raise PydanticCustomError("invalid_phone", "invalid phone")
    return value


def _tax_id(value: str) -> str:
    """ORG-004: Tajik taxpayer number (ИНН) of 9-12 digits."""
    value = value.strip()
    if not _TAX_ID.match(value):
        raise PydanticCustomError("invalid_tax_identifier", "invalid tax identifier")
    return value


Phone = Annotated[str, AfterValidator(_phone)]
TaxIdentifier = Annotated[str, AfterValidator(_tax_id)]
Coordinate = Annotated[Decimal, Field(max_digits=9, decimal_places=6), PlainSerializer(str, return_type=str)]
VerificationStatus = Literal["NOT_SUBMITTED", "PENDING", "APPROVED", "REJECTED"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class _ProfileFields(_Strict):
    """The minimum P02 asks for: who the business is (legal name, tax id) and how to reach/locate it."""

    name: str = Field(min_length=2, max_length=200)
    legal_name: str = Field(min_length=2, max_length=255)
    phone: Phone
    email: EmailStr | None = None
    city: str = Field(min_length=2, max_length=100)
    address: str = Field(min_length=3, max_length=500)


class CompanyCreate(_ProfileFields):
    """ORG-001: tax identifier is mandatory for a company."""

    tax_identifier: TaxIdentifier


class StoreCreate(_ProfileFields):
    """ORG-002: tax identifier optional; coordinates optional but both-or-none (entered or from 'my location')."""

    tax_identifier: TaxIdentifier | None = None
    latitude: Annotated[Decimal, Field(ge=-90, le=90, max_digits=9, decimal_places=6)] | None = None
    longitude: Annotated[Decimal, Field(ge=-180, le=180, max_digits=9, decimal_places=6)] | None = None


class OrganizationUpdate(_Strict):
    """PATCH /organization: optimistic concurrency with `version` (01_GLOBAL §7.8)."""

    version: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=2, max_length=200)
    legal_name: str | None = Field(default=None, min_length=2, max_length=255)
    tax_identifier: TaxIdentifier | None = None
    phone: Phone | None = None
    email: EmailStr | None = None
    city: str | None = Field(default=None, min_length=2, max_length=100)
    address: str | None = Field(default=None, min_length=3, max_length=500)
    latitude: Annotated[Decimal, Field(ge=-90, le=90, max_digits=9, decimal_places=6)] | None = None
    longitude: Annotated[Decimal, Field(ge=-180, le=180, max_digits=9, decimal_places=6)] | None = None


class OrganizationProfile(BaseModel):
    id: UUID
    type: OrgType
    name: str
    status: str
    legal_name: str
    tax_identifier: str | None
    public_code: str | None
    phone: str
    email: str | None
    city: str
    address: str
    latitude: Coordinate | None
    longitude: Coordinate | None
    verification_status: VerificationStatus
    verified_at: datetime | None
    legal_locked: bool
    version: int


class OrganizationCreated(BaseModel):
    organization: OrganizationProfile
    membership: MembershipOut
