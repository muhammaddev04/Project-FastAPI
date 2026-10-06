from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.core.time import utcnow

Status = Literal["PENDING", "ACTIVE", "SUSPENDED", "TERMINATED", "DECLINED", "CANCELLED"]
Money = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
CustomerCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)]


class TermsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    price_list_id: UUID
    credit_limit: Money = Decimal("0")
    credit_days: int = Field(default=0, ge=0, le=180)
    payment_methods: list[Literal["CASH", "BANK_TRANSFER"]] = Field(min_length=1, max_length=2)
    minimum_order_amount: Money = Decimal("0")
    delivery_fee: Money = Decimal("0")
    free_delivery_threshold: Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)] | None = None
    return_days: int = Field(default=14, ge=0, le=60)
    dispute_window_hours: int = Field(default=48, ge=1, le=168)
    effective_from: AwareDatetime = Field(default_factory=utcnow)
    note: str | None = Field(default=None, max_length=5000)

    @field_validator("payment_methods")
    @classmethod
    def unique_methods(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("Payment methods must be unique")
        return value


class TermsOut(TermsIn):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    partnership_id: UUID
    version_no: int
    created_by: UUID
    created_at: datetime
    price_list_name: str | None = None


class InviteIn(BaseModel):
    store_id: UUID
    customer_code: CustomerCode | None = None
    terms: TermsIn


class RequestIn(BaseModel):
    company_public_code: Annotated[str, StringConstraints(pattern=r"^[A-HJ-NP-Z2-9]{8}$")]


class AcceptIn(BaseModel):
    terms: TermsIn | None = None


class ReasonIn(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]


class DeclineIn(BaseModel):
    reason: str | None = Field(default=None, max_length=5000)


class PatchIn(BaseModel):
    customer_code: CustomerCode | None
    version: int = Field(gt=0)


class PartnerProfile(BaseModel):
    id: UUID
    name: str
    phone: str
    city: str
    address: str
    verification_status: str
    email: str | None = None
    tax_identifier: str | None = None
    latitude: Decimal | None = None
    longitude: Decimal | None = None
    legal_name: str | None = None
    logo_file_id: UUID | None = None
    verified_at: datetime | None = None
    updated_at: datetime | None = None
    version: int | None = None


class LookupOut(BaseModel):
    id: UUID
    name: str
    city: str


class PartnershipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    company_id: UUID
    store_id: UUID
    status: Status
    initiated_by_side: Literal["COMPANY", "STORE"]
    customer_code: str | None
    activated_at: datetime | None
    suspended_at: datetime | None
    ended_at: datetime | None
    end_reason: str | None
    created_at: datetime
    updated_at: datetime | None
    version: int
    partner: PartnerProfile | None = None
    current_terms: TermsOut | None = None
    future_terms: list[TermsOut] = Field(default_factory=list)
