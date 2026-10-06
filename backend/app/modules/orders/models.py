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
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin, TimestampMixin

STATUSES = (
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
)


class Cart(IdMixin, Base):
    __tablename__ = "carts"
    __table_args__ = (UniqueConstraint("partnership_id", "user_id"),)
    partnership_id: Mapped[UUID] = mapped_column(ForeignKey("partnerships.id"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class CartItem(IdMixin, Base):
    __tablename__ = "cart_items"
    __table_args__ = (UniqueConstraint("cart_id", "product_unit_id"), CheckConstraint("quantity > 0", name="quantity"))
    cart_id: Mapped[UUID] = mapped_column(ForeignKey("carts.id", ondelete="CASCADE"))
    product_unit_id: Mapped[UUID] = mapped_column(ForeignKey("product_units.id"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Order(IdMixin, TimestampMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("company_id", "order_number"),
        UniqueConstraint("id", "company_id", "store_id", "partnership_id"),
        CheckConstraint("status IN (" + ",".join(repr(s) for s in STATUSES) + ")", name="status"),
        CheckConstraint("source IN ('STORE','COMPANY_ON_BEHALF')", name="source"),
        CheckConstraint("currency = 'TJS'", name="currency"),
        CheckConstraint(
            "requested_subtotal >= 0 AND (subtotal IS NULL OR subtotal >= 0) AND delivery_fee >= 0", name="amounts"
        ),
        CheckConstraint("discount >= 0 AND (subtotal IS NULL OR discount <= subtotal)", name="discount"),
        CheckConstraint("discount = 0 OR length(trim(discount_reason)) > 0", name="discount_reason"),
        CheckConstraint(
            "total IS NULL OR (subtotal IS NOT NULL AND total = subtotal - discount + delivery_fee)", name="total"
        ),
        Index("ix_orders_company_status_created", "company_id", "status", "created_at"),
        Index("ix_orders_store_created", "store_id", "created_at"),
        Index("ix_orders_partnership_status", "partnership_id", "status"),
        Index(
            "ix_orders_number_trgm",
            "order_number",
            postgresql_using="gin",
            postgresql_ops={"order_number": "gin_trgm_ops"},
        ),
    )
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"))
    store_id: Mapped[UUID] = mapped_column(ForeignKey("stores.id"))
    partnership_id: Mapped[UUID] = mapped_column(ForeignKey("partnerships.id"))
    order_number: Mapped[str] = mapped_column(String(20))
    # COMPANY_ON_BEHALF has 17 characters; TZ's VARCHAR(16) cannot hold its own enum literal.
    source: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(24))
    currency: Mapped[str] = mapped_column(String(3), default="TJS", server_default="TJS")
    requested_subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    subtotal: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    discount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, server_default="0")
    discount_reason: Mapped[str | None] = mapped_column(Text)
    delivery_fee: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, server_default="0")
    total: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    terms_id: Mapped[UUID | None] = mapped_column(ForeignKey("partnership_terms.id"))
    terms_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    delivery_address: Mapped[str] = mapped_column(String(500))
    delivery_latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    delivery_longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    store_note: Mapped[str | None] = mapped_column(Text)
    company_note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    confirmed_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_reason: Mapped[str | None] = mapped_column(Text)
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    credit_override_reason: Mapped[str | None] = mapped_column(Text)
    minimum_override_reason: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class OrderItem(IdMixin, Base):
    __tablename__ = "order_items"
    __table_args__ = (
        UniqueConstraint("order_id", "product_unit_id"),
        CheckConstraint("requested_quantity > 0 AND unit_coefficient_snapshot > 0 AND unit_price > 0", name="positive"),
        CheckConstraint(
            "confirmed_quantity IS NULL OR (confirmed_quantity >= 0 AND confirmed_quantity <= requested_quantity)",
            name="confirmed",
        ),
        CheckConstraint(
            "line_total = round(coalesce(confirmed_quantity, requested_quantity) * unit_price, 2)", name="line_total"
        ),
    )
    order_id: Mapped[UUID] = mapped_column(ForeignKey("orders.id"), index=True)
    product_id: Mapped[UUID] = mapped_column(ForeignKey("products.id"))
    product_unit_id: Mapped[UUID] = mapped_column(ForeignKey("product_units.id"))
    product_name_snapshot: Mapped[str] = mapped_column(String(255))
    sku_snapshot: Mapped[str] = mapped_column(String(64))
    unit_code_snapshot: Mapped[str] = mapped_column(String(16))
    unit_name_snapshot: Mapped[dict[str, str]] = mapped_column(JSONB)
    unit_coefficient_snapshot: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    allow_fraction_snapshot: Mapped[bool] = mapped_column(Boolean)
    base_unit_snapshot: Mapped[str] = mapped_column(String(8))
    requested_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    confirmed_quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 3))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2))


class OrderStatusHistory(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "order_status_history"
    __table_args__ = (
        CheckConstraint("actor_type IN ('USER','SYSTEM')", name="actor_type"),
        Index("ix_order_history_created", "order_id", "created_at"),
    )
    order_id: Mapped[UUID] = mapped_column(ForeignKey("orders.id"))
    from_status: Mapped[str | None] = mapped_column(String(24))
    to_status: Mapped[str] = mapped_column(String(24))
    actor_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    actor_type: Mapped[str] = mapped_column(String(8))
    reason: Mapped[str | None] = mapped_column(Text)
    details: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, default=dict, server_default="{}")
