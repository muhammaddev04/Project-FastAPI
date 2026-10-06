from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin, TimestampMixin


class Partnership(IdMixin, TimestampMixin, Base):
    __tablename__ = "partnerships"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING','ACTIVE','SUSPENDED','TERMINATED','DECLINED','CANCELLED')", name="status"
        ),
        CheckConstraint("initiated_by_side IN ('COMPANY','STORE')", name="initiated_by_side"),
        Index(
            "uq_partnership_open",
            "company_id",
            "store_id",
            unique=True,
            postgresql_where=text("status IN ('PENDING','ACTIVE','SUSPENDED')"),
        ),
        Index(
            "uq_partnership_customer_code",
            "company_id",
            "customer_code",
            unique=True,
            postgresql_where=text("customer_code IS NOT NULL"),
        ),
        Index("ix_partnerships_company_status", "company_id", "status"),
        Index("ix_partnerships_store_status", "store_id", "status"),
    )
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"))
    store_id: Mapped[UUID] = mapped_column(ForeignKey("stores.id"))
    status: Mapped[str] = mapped_column(String(16), default="PENDING", server_default="PENDING")
    initiated_by_side: Mapped[str] = mapped_column(String(8))
    initiated_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    customer_code: Mapped[str | None] = mapped_column(String(32))
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_reason: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class PartnershipTerms(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "partnership_terms"
    __table_args__ = (
        UniqueConstraint("partnership_id", "version_no"),
        CheckConstraint("version_no >= 1", name="version_no"),
        CheckConstraint("credit_limit >= 0 AND minimum_order_amount >= 0 AND delivery_fee >= 0", name="money"),
        CheckConstraint("credit_days BETWEEN 0 AND 180", name="credit_days"),
        CheckConstraint("return_days BETWEEN 0 AND 60", name="return_days"),
        CheckConstraint("dispute_window_hours BETWEEN 1 AND 168", name="dispute_window_hours"),
        CheckConstraint(
            "free_delivery_threshold IS NULL OR free_delivery_threshold > 0", name="free_delivery_threshold"
        ),
        CheckConstraint(
            "cardinality(payment_methods) > 0 AND payment_methods <@ ARRAY['CASH','BANK_TRANSFER']::varchar[] "
            "AND array_position(payment_methods, NULL) IS NULL",
            name="payment_methods",
        ),
        Index("ix_partnership_terms_effective", "partnership_id", "effective_from"),
    )
    partnership_id: Mapped[UUID] = mapped_column(ForeignKey("partnerships.id"))
    version_no: Mapped[int] = mapped_column(Integer)
    price_list_id: Mapped[UUID] = mapped_column(ForeignKey("price_lists.id"))
    credit_limit: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    credit_days: Mapped[int] = mapped_column(SmallInteger)
    payment_methods: Mapped[list[str]] = mapped_column(ARRAY(String(16)))
    minimum_order_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    delivery_fee: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    free_delivery_threshold: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    return_days: Mapped[int] = mapped_column(SmallInteger, default=14, server_default="14")
    dispute_window_hours: Mapped[int] = mapped_column(SmallInteger, default=48, server_default="48")
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
