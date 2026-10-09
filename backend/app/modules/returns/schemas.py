"""P10 return and dispute API contracts. Quantities and money are exact Decimal values."""

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

ReturnStatus = Literal["REQUESTED", "APPROVED", "REJECTED", "CANCELLED", "RECEIVED", "COMPLETED"]
ReturnReason = Literal["DAMAGED", "EXPIRED", "WRONG_ITEM", "NOT_ORDERED", "QUALITY", "OTHER"]
DisputeStatus = Literal["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED", "WITHDRAWN"]
DisputeType = Literal["QUANTITY", "PRICE", "DAMAGED", "DELIVERY", "PAYMENT", "OTHER"]
ResolutionType = Literal["NO_ACTION", "ADJUSTMENT_CREDIT", "CONVERTED_TO_RETURN"]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=5000)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=5000)]
Quantity = Annotated[Decimal, Field(max_digits=14, decimal_places=3)]
Money = Annotated[Decimal, Field(max_digits=12, decimal_places=2)]


class VersionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(gt=0)


class ReasonIn(VersionIn):
    reason: Reason


class CancelIn(VersionIn):
    # A store cancels its own request without explaining; the company must say why.
    reason: Reason | None = None


class LineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    order_item_id: UUID
    quantity: Annotated[Quantity, Field(gt=0)]


class ReturnIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    order_id: UUID
    reason_code: ReturnReason
    note: str | None = Field(default=None, max_length=5000)
    items: list[LineIn] = Field(min_length=1, max_length=200)


class ApproveLineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    approved_quantity: Annotated[Quantity, Field(ge=0)]


class ApproveIn(VersionIn):
    items: list[ApproveLineIn] = Field(min_length=1, max_length=200)


class ReceiveLineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    received_quantity: Annotated[Quantity, Field(ge=0)]


class ReceiveIn(VersionIn):
    items: list[ReceiveLineIn] = Field(min_length=1, max_length=200)


class CompleteLineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    accepted_quantity: Annotated[Quantity, Field(ge=0)]
    restock_quantity: Annotated[Quantity, Field(ge=0)]


class CompleteIn(VersionIn):
    items: list[CompleteLineIn] = Field(min_length=1, max_length=200)


class ReturnableOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    order_item_id: UUID
    product_name: str
    unit_code: str
    allow_fraction: bool
    confirmed_quantity: Quantity
    returned_quantity: Quantity
    max_returnable: Quantity
    return_deadline: datetime | None


class ReturnItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    order_item_id: UUID
    requested_quantity: Quantity
    approved_quantity: Quantity | None
    received_quantity: Quantity | None
    accepted_quantity: Quantity | None
    restock_quantity: Quantity | None
    line_credit: Money | None


class ReturnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    return_number: str
    company_id: UUID
    store_id: UUID
    partnership_id: UUID
    order_id: UUID
    status: ReturnStatus
    reason_code: ReturnReason
    note: str | None
    source: Literal["STORE_REQUEST", "DISPUTE"]
    dispute_id: UUID | None
    rejection_reason: str | None
    cancel_reason: str | None
    total_credit: Money | None
    credit_note_id: UUID | None
    requested_at: datetime | None
    approved_at: datetime | None
    received_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    version: int


class ReturnHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    from_status: ReturnStatus | None
    to_status: ReturnStatus
    actor_id: UUID | None
    actor_type: Literal["USER", "SYSTEM"]
    reason: str | None
    created_at: datetime


class ReturnDetail(ReturnOut):
    items: list[ReturnItemOut]
    history: list[ReturnHistoryOut]


class CreditLineOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    return_item_id: UUID
    line_credit: Money


class CompletionPreviewOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lines: list[CreditLineOut]
    total_credit: Money


class DisputeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_type: Literal["ORDER", "PAYMENT"]
    type: DisputeType
    description: Note
    order_id: UUID | None = None
    payment_id: UUID | None = None
    file_ids: list[UUID] = Field(default_factory=list, max_length=10)


class MessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    file_id: UUID | None = None


class DisputeResolveIn(VersionIn):
    # Named apart from the finance ResolveIn so the generated API contract keeps both plain.
    resolution_type: ResolutionType
    resolution_note: Note
    amount: Annotated[Money, Field(gt=0)] | None = None
    return_items: list[LineIn] = Field(default_factory=list, max_length=200)


class DisputeRejectIn(VersionIn):
    resolution_note: Note


class DisputeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    dispute_number: str
    company_id: UUID
    store_id: UUID
    partnership_id: UUID
    target_type: Literal["ORDER", "PAYMENT"]
    order_id: UUID | None
    payment_id: UUID | None
    type: DisputeType
    description: str
    status: DisputeStatus
    opened_by: UUID
    resolution_type: ResolutionType | None
    resolution_note: str | None
    pending_adjustment_id: UUID | None
    adjustment_id: UUID | None
    return_id: UUID | None
    resolved_by: UUID | None
    resolved_at: datetime | None
    created_at: datetime
    version: int


class DisputeMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    dispute_id: UUID
    author_id: UUID | None
    author_side: Literal["COMPANY", "STORE", "SYSTEM"]
    body: str
    file_id: UUID | None
    created_at: datetime


class DisputeDetail(DisputeOut):
    messages: list[DisputeMessageOut]
