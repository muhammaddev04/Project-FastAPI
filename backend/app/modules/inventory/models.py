from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin, TimestampMixin


class Stock(TimestampMixin, Base):
    __tablename__ = "stocks"
    __table_args__ = (
        CheckConstraint("quantity >= 0", name="quantity_nonnegative"),
        CheckConstraint("reserved_quantity >= 0", name="reserved_nonnegative"),
        CheckConstraint("reserved_quantity <= quantity", name="reserved_le_quantity"),
        CheckConstraint("low_stock_threshold IS NULL OR low_stock_threshold >= 0", name="threshold_nonnegative"),
    )
    product_id: Mapped[UUID] = mapped_column(ForeignKey("products.id"), primary_key=True)
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=0, server_default="0")
    reserved_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=0, server_default="0")
    low_stock_threshold: Mapped[Decimal | None] = mapped_column(Numeric(14, 3))
    last_movement_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    @property
    def available(self) -> Decimal:
        return self.quantity - self.reserved_quantity


class StockMovement(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "stock_movements"
    __table_args__ = (
        CheckConstraint(
            "type IN ('RECEIPT','ADJUSTMENT','WRITE_OFF','RESERVE','RELEASE','SHIP','RETURN_IN')", name="type"
        ),
        CheckConstraint("source_type IN ('MANUAL','IMPORT','ORDER','RETURN')", name="source_type"),
        CheckConstraint(
            "quantity_after >= 0 AND reserved_after >= 0 AND reserved_after <= quantity_after", name="balances"
        ),
        CheckConstraint(
            "type NOT IN ('ADJUSTMENT','WRITE_OFF') OR (reason IS NOT NULL AND length(btrim(reason)) >= 5)",
            name="reason",
        ),
        Index("ix_stock_movements_product_created", "product_id", "created_at"),
        Index("ix_stock_movements_company_created", "company_id", "created_at"),
        Index("ix_stock_movements_source", "source_type", "source_id"),
    )
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"))
    product_id: Mapped[UUID] = mapped_column(ForeignKey("products.id"))
    type: Mapped[str] = mapped_column(String(16))
    quantity_delta: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    reserved_delta: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    quantity_after: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    reserved_after: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    source_type: Mapped[str] = mapped_column(String(16))
    source_id: Mapped[UUID | None]
    reason: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))


class StockReservation(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "stock_reservations"
    __table_args__ = (
        CheckConstraint("source_type = 'ORDER'", name="source_type"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("status IN ('ACTIVE','RELEASED','SHIPPED')", name="status"),
        Index(
            "uq_stock_reservations_active_source",
            "source_type",
            "source_id",
            "product_id",
            unique=True,
            postgresql_where=text("status = 'ACTIVE'"),
        ),
        Index("ix_stock_reservations_company_source", "company_id", "source_type", "source_id"),
    )
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"))
    product_id: Mapped[UUID] = mapped_column(ForeignKey("products.id"), index=True)
    source_type: Mapped[str] = mapped_column(String(16), default="ORDER")
    source_id: Mapped[UUID]
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", server_default="ACTIVE")
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
