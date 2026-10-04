from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, SmallInteger, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin, TimestampMixin

STATUSES = "'TRIAL','ACTIVE','GRACE','SOFT_BLOCK','FULL_BLOCK','CANCELLED'"


class Plan(IdMixin, TimestampMixin, Base):
    __tablename__ = "subscription_plans"
    __table_args__ = (
        CheckConstraint("price_monthly >= 0", name="price_nonnegative"),
        CheckConstraint("currency = 'TJS'", name="currency"),
        CheckConstraint("max_active_stores IS NULL OR max_active_stores > 0", name="stores_positive"),
        CheckConstraint("max_users IS NULL OR max_users > 0", name="users_positive"),
        CheckConstraint("max_products IS NULL OR max_products > 0", name="products_positive"),
        CheckConstraint("version > 0", name="version_positive"),
    )
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    price_monthly: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3), default="TJS", server_default="TJS")
    max_active_stores: Mapped[int | None]
    max_users: Mapped[int | None]
    max_products: Mapped[int | None]
    is_public: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class Subscription(IdMixin, TimestampMixin, Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        CheckConstraint(f"status IN ({STATUSES})", name="status"),
        CheckConstraint("version > 0", name="version_positive"),
        Index("ix_subscriptions_status_trial", "status", "trial_ends_at"),
        Index("ix_subscriptions_status_period", "status", "current_period_end"),
        Index("ix_subscriptions_status_grace", "status", "grace_ends_at"),
        Index("ix_subscriptions_status_soft", "status", "soft_block_ends_at"),
    )
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"), unique=True)
    plan_id: Mapped[UUID] = mapped_column(ForeignKey("subscription_plans.id", ondelete="RESTRICT"))
    status: Mapped[str] = mapped_column(String(16))
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    grace_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    soft_block_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    status_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class SubscriptionPayment(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "subscription_payments"
    __table_args__ = (
        CheckConstraint("months BETWEEN 1 AND 12", name="months"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("currency = 'TJS'", name="currency"),
        CheckConstraint("method IN ('CASH','BANK_TRANSFER')", name="method"),
        CheckConstraint("period_end > period_start", name="period"),
    )
    subscription_id: Mapped[UUID] = mapped_column(ForeignKey("subscriptions.id", ondelete="RESTRICT"), index=True)
    plan_id: Mapped[UUID] = mapped_column(ForeignKey("subscription_plans.id", ondelete="RESTRICT"))
    months: Mapped[int] = mapped_column(SmallInteger)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3))
    method: Mapped[str] = mapped_column(String(16))
    reference: Mapped[str | None] = mapped_column(String(100))
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    recorded_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class SubscriptionHistory(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "subscription_status_history"
    __table_args__ = (
        CheckConstraint(f"from_status IS NULL OR from_status IN ({STATUSES})", name="from_status"),
        CheckConstraint(f"to_status IN ({STATUSES})", name="to_status"),
    )
    subscription_id: Mapped[UUID] = mapped_column(ForeignKey("subscriptions.id", ondelete="RESTRICT"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(16))
    to_status: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str] = mapped_column(String(500))
    actor_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class SubscriptionReminder(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "subscription_reminders"
    __table_args__ = (Index("uq_subscription_reminders_anchor", "subscription_id", "kind", "anchor_at", unique=True),)
    subscription_id: Mapped[UUID] = mapped_column(ForeignKey("subscriptions.id", ondelete="RESTRICT"))
    kind: Mapped[str] = mapped_column(String(32))
    anchor_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PlanChangeRequest(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "plan_change_requests"
    __table_args__ = (CheckConstraint("status IN ('PENDING','DONE','DISMISSED')", name="status"),)
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"), index=True)
    requested_plan_id: Mapped[UUID] = mapped_column(ForeignKey("subscription_plans.id", ondelete="RESTRICT"))
    requested_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    status: Mapped[str] = mapped_column(String(16), default="PENDING", server_default="PENDING")
    handled_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
