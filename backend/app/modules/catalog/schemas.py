from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Sku = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
]
BaseUnit = Literal["PCS", "KG", "G", "L", "ML", "M", "PACK"]
Quantity = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=3)]
Money = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]


class Output(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class CategoryIn(BaseModel):
    name: Name
    parent_id: UUID | None = None
    sort_order: int = 0
    is_active: bool = True


class CategoryPatch(BaseModel):
    version: int = Field(gt=0)
    name: Name | None = None
    parent_id: UUID | None = None
    sort_order: int | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def required_values(self) -> Self:
        for key in self.model_fields_set - {"parent_id"}:
            if getattr(self, key) is None:
                raise ValueError(f"{key} cannot be null")
        return self


class CategoryOut(Output):
    id: UUID
    parent_id: UUID | None
    name: str
    sort_order: int
    is_active: bool
    version: int
    children: list["CategoryOut"] = Field(default_factory=list)


class ProductIn(BaseModel):
    sku: Sku
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    category_id: UUID | None = None
    description: str | None = Field(default=None, max_length=10000)
    barcode: str | None = Field(default=None, min_length=1, max_length=32)
    base_unit: BaseUnit
    image_file_id: UUID | None = None
    is_active: bool = True


class ProductPatch(BaseModel):
    version: int = Field(gt=0)
    sku: Sku | None = None
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)] | None = None
    category_id: UUID | None = None
    description: str | None = Field(default=None, max_length=10000)
    barcode: str | None = Field(default=None, min_length=1, max_length=32)
    base_unit: BaseUnit | None = None
    image_file_id: UUID | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def required_values(self) -> Self:
        for key in self.model_fields_set & {"sku", "name", "base_unit", "is_active"}:
            if getattr(self, key) is None:
                raise ValueError(f"{key} cannot be null")
        return self


class UnitIn(BaseModel):
    code: Annotated[str, StringConstraints(min_length=1, max_length=16, pattern=r"^[A-Za-z0-9._-]+$")]
    name: dict[str, str]
    coefficient: Quantity
    allow_fraction: bool = False
    min_order_qty: Quantity = Decimal("1")

    @field_validator("name")
    @classmethod
    def languages(cls, value: dict[str, str]) -> dict[str, str]:
        if set(value) != {"tg", "ru", "en"} or any(not item.strip() or len(item) > 120 for item in value.values()):
            raise ValueError("All three unit names are required")
        return {key: item.strip() for key, item in value.items()}


class UnitOut(Output):
    id: UUID
    product_id: UUID
    code: str
    name: dict[str, str]
    coefficient: Decimal
    is_base: bool
    allow_fraction: bool
    min_order_qty: Decimal
    is_active: bool


class PriceOut(Output):
    id: UUID
    price_list_id: UUID
    product_unit_id: UUID
    price: Decimal
    valid_from: datetime
    valid_to: datetime | None
    created_at: datetime


class ProductOut(Output):
    id: UUID
    category_id: UUID | None
    sku: str
    name: str
    description: str | None
    barcode: str | None
    base_unit: str
    image_file_id: UUID | None
    is_active: bool
    version: int
    created_at: datetime
    units: list[UnitOut] = Field(default_factory=list)
    prices: list[PriceOut] | None = None


class VersionIn(BaseModel):
    version: int = Field(gt=0)


class PriceListIn(BaseModel):
    code: Annotated[str, StringConstraints(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9._-]+$")]
    name: Name
    is_active: bool = True


class PriceListPatch(BaseModel):
    version: int = Field(gt=0)
    name: Name | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def required_values(self) -> Self:
        if any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError("Null is not allowed")
        return self


class PriceListOut(Output):
    id: UUID
    code: str
    name: str
    is_default: bool
    is_active: bool
    version: int


class PriceIn(BaseModel):
    price_list_id: UUID
    product_unit_id: UUID
    price: Money
    valid_from: AwareDatetime | None = None


class BulkPricesIn(BaseModel):
    rows: list[PriceIn] = Field(min_length=1, max_length=500)


class MatrixOut(BaseModel):
    product_id: UUID
    sku: str
    name: str
    unit: UnitOut
    current: PriceOut | None
    future: PriceOut | None
    resolved_price: Decimal | None


class ImportOut(Output):
    id: UUID
    kind: str
    status: str
    file_id: UUID
    total_rows: int
    error_count: int
    summary: dict[str, object]
    failure_reason: str | None
    version: int
    created_at: datetime


class ImportRowOut(Output):
    id: UUID
    row_number: int
    data: dict[str, object]
    action: str


class ImportErrorOut(Output):
    id: UUID
    row_number: int
    field: str
    error_code: str
    message_key: str
    params: dict[str, object]
