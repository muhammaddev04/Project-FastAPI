from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.core.pagination import Page

Money = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
Limit = Annotated[int, Field(gt=0)]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=500)]


class PlanFields(BaseModel):
    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{0,15}$")
    name: dict[str, str]
    price_monthly: Money
    currency: Literal["TJS"] = "TJS"
    max_active_stores: Limit | None = None
    max_users: Limit | None = None
    max_products: Limit | None = None
    is_public: bool = True
    sort_order: int = Field(default=0, ge=-32768, le=32767)

    @field_validator("name")
    @classmethod
    def localized_name(cls, value: dict[str, str]) -> dict[str, str]:
        if set(value) != {"tg", "ru", "en"} or any(not name.strip() or len(name) > 100 for name in value.values()):
            raise ValueError("Plan names require nonempty tg, ru and en translations of at most 100 characters")
        return {key: name.strip() for key, name in value.items()}


class PlanOut(PlanFields):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    version: int
    created_at: datetime
    updated_at: datetime | None


class PlanUpdate(BaseModel):
    version: int = Field(gt=0)
    code: str | None = Field(default=None, pattern=r"^[A-Z][A-Z0-9_]{0,15}$")
    name: dict[str, str] | None = None
    price_monthly: Money | None = None
    currency: Literal["TJS"] | None = None
    max_active_stores: Limit | None = None
    max_users: Limit | None = None
    max_products: Limit | None = None
    is_public: bool | None = None
    sort_order: int | None = Field(default=None, ge=-32768, le=32767)

    @field_validator("name")
    @classmethod
    def localized_name(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        return PlanFields.localized_name(value) if value is not None else None

    @model_validator(mode="after")
    def required_values_not_null(self) -> Self:
        for field in self.model_fields_set & {"code", "name", "price_monthly", "currency", "is_public", "sort_order"}:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class PaymentIn(BaseModel):
    months: int = Field(ge=1, le=12)
    amount: Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]
    method: Literal["CASH", "BANK_TRANSFER"]
    reference: str | None = Field(default=None, max_length=100)
    override_amount_reason: Reason | None = None


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    subscription_id: UUID
    plan_id: UUID
    months: int
    amount: Decimal
    currency: str
    method: str
    reference: str | None
    period_start: datetime
    period_end: datetime
    recorded_by: UUID
    created_at: datetime


class HistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    from_status: str | None
    to_status: str
    reason: str
    actor_id: UUID | None
    created_at: datetime


class SubscriptionOut(BaseModel):
    id: UUID
    company_id: UUID
    company_name: str
    status: str
    plan: PlanOut
    trial_ends_at: datetime | None
    current_period_start: datetime | None
    current_period_end: datetime | None
    grace_ends_at: datetime | None
    soft_block_ends_at: datetime | None
    cancel_at_period_end: bool
    status_changed_at: datetime
    version: int
    usage: dict[str, int]
    limits: dict[str, int | None]
    allowed_actions: list[str]


class SubscriptionDetail(SubscriptionOut):
    history: list[HistoryOut]
    payments: list[PaymentOut]


class CancelIn(BaseModel):
    value: bool


class PlanRequestIn(BaseModel):
    plan_code: str = Field(min_length=1, max_length=16)


class ChangePlanIn(PlanRequestIn):
    reason: Reason


class ExtendTrialIn(BaseModel):
    days: int = Field(ge=1, le=30)
    reason: Reason


class PlanRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    company_id: UUID
    requested_plan_id: UUID
    requested_by: UUID
    status: str
    created_at: datetime
    handled_by: UUID | None
    handled_at: datetime | None


class PlanRequestDetail(PlanRequestOut):
    company_name: str
    plan_code: str


class RequestHandleIn(BaseModel):
    status: Literal["DONE", "DISMISSED"]
    reason: Reason


SubscriptionPage = Page[SubscriptionOut]
PaymentPage = Page[PaymentOut]
PlanPage = Page[PlanOut]
RequestPage = Page[PlanRequestDetail]
