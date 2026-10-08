"""P09 finance API contracts; amounts are exact Decimal values."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.modules.finance.domain import AgingBucket

PaymentStatus = Literal["PENDING", "CONFIRMED", "REJECTED", "CANCELLED"]
PaymentMethod = Literal["CASH", "BANK_TRANSFER"]
ChargeStatus = Literal["OPEN", "PARTIALLY_PAID", "PAID"]
AdjustmentStatus = Literal["PENDING_APPROVAL", "APPROVED", "REJECTED"]
AdjustmentType = Literal["DEBIT", "CREDIT", "REFUND"]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]


class RecordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    partnership_id: UUID
    amount: Decimal
    method: PaymentMethod
    reference: str | None = Field(default=None, max_length=100)
    note: str | None = Field(default=None, max_length=5000)
    delivery_id: UUID | None = None
    confirm: bool = False


class CourierPaymentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount: Decimal
    note: str | None = Field(default=None, max_length=5000)


class VersionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(gt=0)


class RejectIn(VersionIn):
    reason: Reason


class AdjustmentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    partnership_id: UUID
    type: AdjustmentType
    amount: Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=5000)]


class ResolveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note: Reason


class DateRange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date_from: date | None = None
    date_to: date | None = None

    @model_validator(mode="after")
    def ordered(self) -> "DateRange":
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("date_from must not follow date_to")
        return self


class BalanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    partnership_id: UUID
    balance: Decimal
    outstanding: Decimal
    unapplied: Decimal
    overdue: Decimal
    credit_limit: Decimal
    available: Decimal
    aging: dict[AgingBucket, Decimal]


class PartnerBalanceOut(BalanceOut):
    company_id: UUID
    store_id: UUID
    partner_name: str


class SummaryOut(BaseModel):
    currency: str = "TJS"
    balance: Decimal
    outstanding: Decimal
    unapplied: Decimal
    overdue: Decimal
    aging: dict[AgingBucket, Decimal]


class AllocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    partnership_id: UUID
    charge_id: UUID
    credit_id: UUID
    amount: Decimal
    created_at: datetime


class PreviewLine(BaseModel):
    charge_id: UUID
    amount: Decimal
    due_date: date
    source_id: UUID


class PreviewOut(BaseModel):
    amount: Decimal
    allocated: Decimal
    unapplied: Decimal
    lines: list[PreviewLine]


class ChargeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    partnership_id: UUID
    company_id: UUID
    store_id: UUID
    kind: Literal["ORDER", "ADJUSTMENT", "REFUND"]
    source_id: UUID
    amount: Decimal
    currency: str
    due_date: date
    allocated_amount: Decimal
    status: ChargeStatus
    created_at: datetime
    paid_at: datetime | None


class ChargeDetail(ChargeOut):
    allocations: list[AllocationOut]


class FinancePaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    partnership_id: UUID
    company_id: UUID
    store_id: UUID
    amount: Decimal
    currency: str
    method: PaymentMethod
    reference: str | None
    status: PaymentStatus
    recorded_by: UUID
    recorded_side: Literal["COMPANY", "STORE"]
    delivery_id: UUID | None
    note: str | None
    confirmed_by: UUID | None
    confirmed_at: datetime | None
    rejected_reason: str | None
    cancelled_at: datetime | None
    created_at: datetime
    updated_at: datetime | None
    version: int


class HistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    payment_id: UUID
    from_status: PaymentStatus | None
    to_status: PaymentStatus
    actor_id: UUID
    reason: str | None
    created_at: datetime


class PaymentDetail(FinancePaymentOut):
    history: list[HistoryOut]
    allocations: list[AllocationOut]


class AdjustmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    partnership_id: UUID
    type: AdjustmentType
    amount: Decimal
    reason: str
    source: Literal["MANUAL", "DISPUTE"]
    source_id: UUID | None
    status: AdjustmentStatus
    created_by: UUID
    approved_by: UUID | None
    approved_at: datetime | None
    self_approved: bool
    rejected_reason: str | None
    created_at: datetime
    updated_at: datetime | None
    version: int


class LedgerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    entry_type: str
    direction: Literal["DEBIT", "CREDIT"]
    amount: Decimal
    currency: str
    source_type: str
    source_id: UUID
    balance_after: Decimal
    description: str
    created_by: UUID | None
    created_at: datetime


class StatementOut(BaseModel):
    partnership_id: UUID
    date_from: date | None
    date_to: date | None
    opening_balance: Decimal
    closing_balance: Decimal
    entries: list[LedgerOut]


class ReconciliationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    partnership_id: UUID
    check_code: str
    expected: str
    actual: str
    detected_at: datetime
    resolved_at: datetime | None
    resolved_by: UUID | None
    note: str | None
