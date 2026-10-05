from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Nonnegative = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=3)]
Positive = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=3)]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=2000)]
MovementType = Literal["RECEIPT", "ADJUSTMENT", "WRITE_OFF", "RESERVE", "RELEASE", "SHIP", "RETURN_IN"]
SourceType = Literal["MANUAL", "IMPORT", "ORDER", "RETURN"]


class StockOut(BaseModel):
    product_id: UUID
    name: str
    sku: str
    barcode: str | None
    base_unit: str
    category_id: UUID | None
    is_active: bool
    quantity: Decimal
    reserved_quantity: Decimal
    available: Decimal
    low_stock_threshold: Decimal | None
    last_movement_at: datetime | None
    version: int


class ReservationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    source_id: UUID
    source_type: str
    quantity: Decimal
    created_at: datetime
    # The order resolver is installed in P07 when orders and their numbers exist.
    order_number: str | None = None


class StockDetail(StockOut):
    reservations: list[ReservationOut]


class ThresholdIn(BaseModel):
    version: int = Field(gt=0)
    low_stock_threshold: Nonnegative | None


class ReceiptLine(BaseModel):
    product_id: UUID
    unit_id: UUID
    quantity: Positive


class ReceiptIn(BaseModel):
    items: list[ReceiptLine] = Field(min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=2000)


class AdjustmentIn(BaseModel):
    product_id: UUID
    actual_quantity: Nonnegative
    reason: Reason


class WriteOffIn(ReceiptLine):
    reason: Reason


class MovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    product_id: UUID
    company_id: UUID
    type: MovementType
    quantity_delta: Decimal
    reserved_delta: Decimal
    quantity_after: Decimal
    reserved_after: Decimal
    source_type: SourceType
    source_id: UUID | None
    reason: str | None
    created_by: UUID | None
    created_at: datetime


class ReceiptOut(BaseModel):
    received: int
