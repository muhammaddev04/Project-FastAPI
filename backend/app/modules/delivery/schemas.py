from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints

from app.core.money import MoneyStr, QuantityStr

DeliveryStatus = Literal["PLANNED", "ASSIGNED", "IN_TRANSIT", "ARRIVED", "DELIVERED", "FAILED", "CANCELLED"]
RunStatus = Literal["DRAFT", "STARTED", "FINISHED", "CANCELLED"]
FailureReason = Literal["STORE_CLOSED", "REFUSED", "ADDRESS_NOT_FOUND", "NO_CONTACT", "VEHICLE_ISSUE", "OTHER"]
SyncOperation = Literal["DELIVERY_ARRIVE", "DELIVERY_CONFIRM", "DELIVERY_FAIL", "PAYMENT_RECORD"]
SyncResult = Literal["APPLIED", "DUPLICATE", "CONFLICT", "REJECTED"]

Code = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[0-9]{6}$")]
#  DEL-013: an override has to be explained, not waved through.
ManualReason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=2000)]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
Coordinate = Annotated[Decimal, Field(max_digits=9, decimal_places=6)]


class AssignIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    courier_id: UUID
    version: int = Field(ge=1)


class VersionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1)


class CancelIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: Reason
    version: int = Field(ge=1)


class ManualConfirmIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: ManualReason


class ConfirmIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: Code


class FailIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason_code: FailureReason
    note: str | None = Field(default=None, max_length=2000)


class HistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    from_status: DeliveryStatus | None
    to_status: DeliveryStatus
    actor_id: UUID | None
    actor_type: Literal["USER", "SYSTEM"]
    reason: str | None
    source: Literal["ONLINE", "OFFLINE_SYNC"]
    created_at: datetime


class DeliveryOut(BaseModel):
    """The company view. It never carries the code — only the store is shown that (DEL-012)."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    order_id: UUID
    store_id: UUID
    order_number: str | None = None
    order_total: MoneyStr | None = None
    store_name: str | None = None
    attempt_no: int
    status: DeliveryStatus
    run_id: UUID | None
    stop_sequence: int | None
    courier_id: UUID | None
    courier_name: str | None = None
    address: str
    latitude: Coordinate | None
    longitude: Coordinate | None
    code_attempts: int
    code_locked: bool
    confirmation_method: Literal["CODE", "MANUAL_OVERRIDE"] | None
    manual_reason: str | None
    failure_reason_code: FailureReason | None
    failure_note: str | None
    dispatched_at: datetime | None
    arrived_at: datetime | None
    delivered_at: datetime | None
    failed_at: datetime | None
    version: int
    created_at: datetime


class DeliveryDetailOut(DeliveryOut):
    history: list[HistoryOut] = []


class RunIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    courier_id: UUID
    run_date: date
    delivery_ids: Annotated[list[UUID], Field(min_length=1, max_length=100)]


class RunPatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    delivery_ids: Annotated[list[UUID], Field(min_length=1, max_length=100)]
    version: int = Field(ge=1)


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    courier_id: UUID
    courier_name: str | None = None
    run_date: date
    status: RunStatus
    started_at: datetime | None
    finished_at: datetime | None
    version: int
    created_at: datetime
    stop_count: int = 0


class RunDetailOut(RunOut):
    stops: list[DeliveryOut] = []


class CourierItemOut(BaseModel):
    """What a courier needs to hand the goods over. Prices are deliberately absent."""

    model_config = ConfigDict(from_attributes=True)
    product_name: str
    sku: str
    unit_code: str
    quantity: QuantityStr


class CourierStopOut(BaseModel):
    id: UUID
    run_id: UUID | None
    order_id: UUID
    order_number: str
    attempt_no: int
    status: DeliveryStatus
    stop_sequence: int | None
    store_name: str
    store_phone: str
    address: str
    latitude: Coordinate | None
    longitude: Coordinate | None
    order_total: MoneyStr | None
    items: list[CourierItemOut] = []
    code_locked: bool = False
    version: int


class CourierTodayOut(BaseModel):
    runs: list[RunOut] = []
    run_id: UUID | None
    run_status: RunStatus | None
    run_date: date | None
    stops: list[CourierStopOut] = []


class StoreDeliveryOut(BaseModel):
    """DEL-012: the one place the code is returned, and only to a store member while it is in flight."""

    status: DeliveryStatus
    attempt_no: int
    courier_name: str | None = None
    courier_phone: str | None = None
    code: str | None = None
    dispatched_at: datetime | None = None
    arrived_at: datetime | None = None
    delivered_at: datetime | None = None


class SyncOperationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: UUID
    operation_type: SyncOperation
    entity_id: UUID
    #  DEL-021: the queued code travels here and is never written to `courier_sync_operations.payload`.
    payload: dict[str, Any] = Field(default_factory=dict)
    expected_status: DeliveryStatus | None = None
    client_created_at: AwareDatetime


class SyncIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operations: Annotated[list[SyncOperationIn], Field(min_length=1, max_length=100)]


class SyncResultOut(BaseModel):
    operation_id: UUID
    result_status: SyncResult
    error: str | None = None
    server_state: DeliveryOut | None = None


class SyncOut(BaseModel):
    results: list[SyncResultOut] = []
