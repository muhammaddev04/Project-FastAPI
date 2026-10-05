from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin, TimestampMixin


class Category(IdMixin, TimestampMixin, Base):
    __tablename__ = "categories"
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    parent_id: Mapped[UUID | None] = mapped_column(ForeignKey("categories.id"))
    name: Mapped[str] = mapped_column(String(120))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


Index(
    "uq_categories_company_parent_name",
    Category.company_id,
    Category.parent_id,
    func.lower(Category.name),
    unique=True,
    postgresql_nulls_not_distinct=True,
)


class Product(IdMixin, TimestampMixin, Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("company_id", "sku", name="uq_products_company_sku"),
        CheckConstraint("sku ~ '^[A-Za-z0-9._-]+$'", name="sku_format"),
        CheckConstraint("base_unit IN ('PCS','KG','G','L','ML','M','PACK')", name="base_unit"),
        Index(
            "uq_products_company_barcode",
            "company_id",
            "barcode",
            unique=True,
            postgresql_where=text("barcode IS NOT NULL"),
        ),
        Index("ix_products_name_trgm", "name", postgresql_using="gin", postgresql_ops={"name": "gin_trgm_ops"}),
        Index("ix_products_sku_trgm", "sku", postgresql_using="gin", postgresql_ops={"sku": "gin_trgm_ops"}),
    )
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    category_id: Mapped[UUID | None] = mapped_column(ForeignKey("categories.id"))
    sku: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    barcode: Mapped[str | None] = mapped_column(String(32))
    base_unit: Mapped[str] = mapped_column(String(8))
    image_file_id: Mapped[UUID | None] = mapped_column(ForeignKey("stored_files.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class ProductUnit(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "product_units"
    __table_args__ = (
        UniqueConstraint("product_id", "code"),
        CheckConstraint("coefficient > 0", name="coefficient_positive"),
        CheckConstraint("min_order_qty > 0", name="quantity_positive"),
        CheckConstraint("NOT is_base OR coefficient = 1", name="base_coefficient"),
        CheckConstraint("NOT is_base OR is_active", name="base_active"),
        Index("uq_product_units_base", "product_id", unique=True, postgresql_where=text("is_base")),
    )
    product_id: Mapped[UUID] = mapped_column(ForeignKey("products.id"), index=True)
    code: Mapped[str] = mapped_column(String(16))
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    coefficient: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    is_base: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    allow_fraction: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    min_order_qty: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=1, server_default="1")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")


class PriceList(IdMixin, TimestampMixin, Base):
    __tablename__ = "price_lists"
    __table_args__ = (
        UniqueConstraint("company_id", "code"),
        CheckConstraint("NOT is_default OR is_active", name="default_active"),
        Index("uq_price_lists_default", "company_id", unique=True, postgresql_where=text("is_default")),
    )
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    code: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(120))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class Price(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "prices"
    __table_args__ = (
        CheckConstraint("price > 0", name="positive"),
        CheckConstraint("valid_to IS NULL OR valid_to > valid_from", name="valid_period"),
        ExcludeConstraint(
            ("price_list_id", "="),
            ("product_unit_id", "="),
            (func.tstzrange(text("valid_from"), text("valid_to"), "[)"), "&&"),
            name="price_overlap",
            using="gist",
        ),
    )
    price_list_id: Mapped[UUID] = mapped_column(ForeignKey("price_lists.id"), index=True)
    product_unit_id: Mapped[UUID] = mapped_column(ForeignKey("product_units.id"), index=True)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))


class ImportJob(IdMixin, TimestampMixin, Base):
    __tablename__ = "imports"
    __table_args__ = (
        CheckConstraint("kind IN ('PRODUCTS','PRICES','STOCK')", name="kind"),
        CheckConstraint(
            "status IN ('UPLOADED','VALIDATED','CONFIRMED','COMPLETED','FAILED','CANCELLED')", name="status"
        ),
    )
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="UPLOADED", server_default="UPLOADED")
    file_id: Mapped[UUID] = mapped_column(ForeignKey("stored_files.id"))
    total_rows: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    error_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    failure_reason: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    confirmed_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class ImportRow(IdMixin, Base):
    __tablename__ = "import_rows"
    __table_args__ = (
        UniqueConstraint("import_id", "row_number"),
        CheckConstraint("action IN ('CREATE','UPDATE','SKIP')", name="action"),
    )
    import_id: Mapped[UUID] = mapped_column(ForeignKey("imports.id"), index=True)
    row_number: Mapped[int]
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    action: Mapped[str] = mapped_column(String(8))


class ImportError(IdMixin, Base):
    __tablename__ = "import_errors"
    import_id: Mapped[UUID] = mapped_column(ForeignKey("imports.id"), index=True)
    row_number: Mapped[int]
    field: Mapped[str] = mapped_column(String(64))
    error_code: Mapped[str] = mapped_column(String(64))
    message_key: Mapped[str] = mapped_column(String(128))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
