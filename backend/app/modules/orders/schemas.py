from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Status = Literal[
    "NEW",
    "VIEWED",
    "CONFIRMED",
    "PARTIALLY_CONFIRMED",
    "ASSEMBLING",
    "READY_FOR_DELIVERY",
    "IN_TRANSIT",
    "DELIVERED",
    "DELIVERY_FAILED",
    "DISPUTED",
    "COMPLETED",
    "REJECTED",
    "CANCELLED",
]
Quantity = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=3)]
Money = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]


class VersionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1)


class ReasonIn(VersionIn):
    reason: Reason


class ItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_unit_id: UUID
    quantity: Quantity = Field(gt=0)


class CreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    partnership_id: UUID
    items: list[ItemIn] = Field(min_length=1, max_length=200)
    store_note: str | None = Field(default=None, max_length=5000)


class CheckoutIn(BaseModel):
    store_note: str | None = Field(default=None, max_length=5000)


class CartQuantityIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    quantity: Quantity


class ConfirmLine(BaseModel):
    item_id: UUID
    confirmed_quantity: Quantity


class ConfirmIn(VersionIn):
    lines: list[ConfirmLine] = Field(min_length=1, max_length=200)
    discount: Money = Decimal("0")
    discount_reason: Reason | None = None
    override_credit_reason: Reason | None = None
    override_minimum_reason: Reason | None = None
    company_note: str | None = Field(default=None, max_length=5000)


class Output(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class WarehouseItem(Output):
    id: UUID
    product_id: UUID
    product_unit_id: UUID
    product_name_snapshot: str
    sku_snapshot: str
    unit_code_snapshot: str
    unit_name_snapshot: dict[str, str]
    unit_coefficient_snapshot: Decimal
    allow_fraction_snapshot: bool
    base_unit_snapshot: str
    requested_quantity: Decimal
    confirmed_quantity: Decimal | None
    rejected_quantity: Decimal = Decimal("0")


class ItemOut(WarehouseItem):
    unit_price: Decimal
    line_total: Decimal


class HistoryOut(Output):
    id: UUID
    from_status: str | None
    to_status: str
    actor_id: UUID | None
    actor_type: str
    reason: str | None
    details: dict[str, Any]
    created_at: datetime


class OrderBase(Output):
    id: UUID
    company_id: UUID
    store_id: UUID
    partnership_id: UUID
    order_number: str
    source: str
    status: Status
    partner_name: str = ""
    delivery_address: str
    delivery_latitude: Decimal | None
    delivery_longitude: Decimal | None
    store_note: str | None
    company_note: str | None
    created_by: UUID
    created_at: datetime
    updated_at: datetime | None
    version: int
    history: list[HistoryOut] = []


class OrderWarehouseView(OrderBase):
    items: list[WarehouseItem] = []


class OrderOut(OrderBase):
    currency: str
    requested_subtotal: Decimal
    subtotal: Decimal | None
    discount: Decimal
    discount_reason: str | None
    delivery_fee: Decimal
    total: Decimal | None
    terms_id: UUID | None
    terms_snapshot: dict[str, Any] | None
    confirmed_by: UUID | None
    confirmed_at: datetime | None
    delivered_at: datetime | None
    completed_at: datetime | None
    cancelled_at: datetime | None
    cancel_reason: str | None
    rejection_reason: str | None
    credit_override_reason: str | None
    minimum_override_reason: str | None
    items: list[ItemOut] = []


class CatalogUnit(Output):
    id: UUID
    code: str
    name: dict[str, str]
    coefficient: Decimal
    allow_fraction: bool
    min_order_qty: Decimal
    price: Decimal
    availability_status: Literal["IN_STOCK", "LOW", "OUT_OF_STOCK"]


class CatalogProduct(Output):
    id: UUID
    name: str
    sku: str
    barcode: str | None
    description: str | None
    category_id: UUID | None
    image_file_id: UUID | None
    base_unit: str
    units: list[CatalogUnit]


class CartLine(BaseModel):
    product_unit_id: UUID
    product_name: str
    unit_code: str
    quantity: Decimal
    allow_fraction: bool
    min_order_qty: Decimal
    price: Decimal | None
    line_total: Decimal
    availability_status: str
    orderable: bool


class CartOut(BaseModel):
    partnership_id: UUID
    items: list[CartLine]
    subtotal: Decimal
    delivery_fee: Decimal
    minimum_order_amount: Decimal
    warnings: list[dict[str, str]]


class CreditOut(BaseModel):
    allowed: bool
    limit: Decimal
    outstanding: Decimal
    unapplied: Decimal


class PreviewLine(BaseModel):
    item_id: UUID
    available: Decimal
    confirmed_quantity: Decimal


class ConfirmationPreview(BaseModel):
    lines: list[PreviewLine]
    credit: CreditOut
    terms: dict[str, Any]
    subtotal: Decimal
    delivery_fee: Decimal
    total: Decimal
