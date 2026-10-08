"""P09 financial records. PostgreSQL migrations enforce immutable posting facts."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin, TimestampMixin


class _Party:
    partnership_id: Mapped[UUID] = mapped_column(ForeignKey("partnerships.id"))
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"))
    store_id: Mapped[UUID] = mapped_column(ForeignKey("stores.id"))


class Charge(_Party, IdMixin, CreatedAtMixin, Base):
    __tablename__ = "charges"
    __table_args__ = (
        CheckConstraint("kind IN ('ORDER','ADJUSTMENT','REFUND')", name="kind"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("allocated_amount >= 0 AND allocated_amount <= amount", name="allocated_range"),
        CheckConstraint(
            "(allocated_amount = 0 AND status = 'OPEN') OR "
            "(allocated_amount > 0 AND allocated_amount < amount AND status = 'PARTIALLY_PAID') OR "
            "(allocated_amount = amount AND status = 'PAID')",
            name="status_matches_allocation",
        ),
        CheckConstraint("(status = 'PAID') = (paid_at IS NOT NULL)", name="paid_at_matches_status"),
        UniqueConstraint("kind", "source_id"),
        Index("ix_charges_partnership_status_due_created", "partnership_id", "status", "due_date", "created_at"),
    )
    kind: Mapped[str] = mapped_column(String(16))
    source_id: Mapped[UUID]
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3))
    due_date: Mapped[date] = mapped_column(Date)
    allocated_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, server_default="0")
    status: Mapped[str] = mapped_column(String(16), default="OPEN", server_default="OPEN")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Credit(_Party, IdMixin, CreatedAtMixin, Base):
    __tablename__ = "credits"
    __table_args__ = (
        CheckConstraint("kind IN ('PAYMENT','CREDIT_NOTE','ADJUSTMENT')", name="kind"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("allocated_amount >= 0 AND allocated_amount <= amount", name="allocated_range"),
        UniqueConstraint("kind", "source_id"),
        Index("ix_credits_partnership_created", "partnership_id", "created_at", "id"),
    )
    kind: Mapped[str] = mapped_column(String(16))
    source_id: Mapped[UUID]
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    allocated_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, server_default="0")


class Allocation(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "allocations"
    __table_args__ = (CheckConstraint("amount > 0", name="amount_positive"),)
    partnership_id: Mapped[UUID] = mapped_column(ForeignKey("partnerships.id"), index=True)
    charge_id: Mapped[UUID] = mapped_column(ForeignKey("charges.id"), index=True)
    credit_id: Mapped[UUID] = mapped_column(ForeignKey("credits.id"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))


class LedgerEntry(_Party, IdMixin, CreatedAtMixin, Base):
    __tablename__ = "ledger_entries"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint(
            "(direction = 'DEBIT' AND entry_type IN ('CHARGE','ADJUSTMENT_DEBIT','REFUND')) OR "
            "(direction = 'CREDIT' AND entry_type IN ('PAYMENT','CREDIT_NOTE','ADJUSTMENT_CREDIT'))",
            name="entry_direction",
        ),
        CheckConstraint("source_type IN ('ORDER','PAYMENT','CREDIT_NOTE','ADJUSTMENT')", name="source_type"),
        UniqueConstraint("entry_type", "source_id"),
        Index("ix_ledger_entries_partnership_created_id", "partnership_id", "created_at", "id"),
    )
    entry_type: Mapped[str] = mapped_column(String(24))
    direction: Mapped[str] = mapped_column(String(6))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3))
    source_type: Mapped[str] = mapped_column(String(16))
    source_id: Mapped[UUID]
    balance_after: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    description: Mapped[str] = mapped_column(String(255))
    created_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))


class PartnershipBalance(TimestampMixin, Base):
    __tablename__ = "partnership_balances"
    partnership_id: Mapped[UUID] = mapped_column(ForeignKey("partnerships.id"), primary_key=True)
    balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, server_default="0")
    last_entry_id: Mapped[UUID | None] = mapped_column(ForeignKey("ledger_entries.id"))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class Payment(_Party, IdMixin, TimestampMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("amount > 0 AND amount <= 10000000.00", name="amount_range"),
        CheckConstraint("method IN ('CASH','BANK_TRANSFER')", name="method"),
        CheckConstraint(
            "method <> 'BANK_TRANSFER' OR (reference IS NOT NULL AND length(btrim(reference)) > 0)",
            name="bank_reference",
        ),
        CheckConstraint("status IN ('PENDING','CONFIRMED','REJECTED','CANCELLED')", name="status"),
        CheckConstraint("recorded_side IN ('COMPANY','STORE')", name="recorded_side"),
        Index("ix_payments_company_status_created", "company_id", "status", "created_at"),
        Index("ix_payments_partnership_created", "partnership_id", "created_at"),
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3))
    method: Mapped[str] = mapped_column(String(16))
    reference: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(16), default="PENDING", server_default="PENDING")
    recorded_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    recorded_side: Mapped[str] = mapped_column(String(8))
    delivery_id: Mapped[UUID | None] = mapped_column(ForeignKey("deliveries.id"))
    note: Mapped[str | None] = mapped_column(Text)
    confirmed_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rejected_reason: Mapped[str | None] = mapped_column(Text)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class PaymentStatusHistory(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "payment_status_history"
    __table_args__ = (
        CheckConstraint("from_status IS NULL OR from_status = 'PENDING'", name="from_status"),
        CheckConstraint("to_status IN ('PENDING','CONFIRMED','REJECTED','CANCELLED')", name="to_status"),
    )
    payment_id: Mapped[UUID] = mapped_column(ForeignKey("payments.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(16))
    to_status: Mapped[str] = mapped_column(String(16))
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str | None] = mapped_column(Text)


class Adjustment(IdMixin, TimestampMixin, Base):
    __tablename__ = "adjustments"
    __table_args__ = (
        CheckConstraint("type IN ('DEBIT','CREDIT','REFUND')", name="type"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("length(btrim(reason)) >= 10", name="reason"),
        CheckConstraint("source IN ('MANUAL','DISPUTE')", name="source"),
        CheckConstraint("status IN ('PENDING_APPROVAL','APPROVED','REJECTED')", name="status"),
        Index("ix_adjustments_partnership_status", "partnership_id", "status"),
    )
    partnership_id: Mapped[UUID] = mapped_column(ForeignKey("partnerships.id"))
    type: Mapped[str] = mapped_column(String(8))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    reason: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16), default="MANUAL", server_default="MANUAL")
    source_id: Mapped[UUID | None]
    status: Mapped[str] = mapped_column(String(20), default="PENDING_APPROVAL", server_default="PENDING_APPROVAL")
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    approved_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    self_approved: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    rejected_reason: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class CreditNote(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "credit_notes"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("source_type = 'RETURN'", name="source_type"),
    )
    partnership_id: Mapped[UUID] = mapped_column(ForeignKey("partnerships.id"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    source_type: Mapped[str] = mapped_column(String(16), default="RETURN", server_default="RETURN")
    source_id: Mapped[UUID] = mapped_column(unique=True)
    created_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))


class DebtReminder(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "debt_reminders"
    __table_args__ = (
        UniqueConstraint("charge_id", "kind", "anchor_date"),
        CheckConstraint("kind IN ('DEBT_DUE_SOON','DEBT_OVERDUE')", name="kind"),
    )
    charge_id: Mapped[UUID] = mapped_column(ForeignKey("charges.id"))
    kind: Mapped[str] = mapped_column(String(16))
    anchor_date: Mapped[date] = mapped_column(Date)


class ReconciliationIssue(IdMixin, Base):
    __tablename__ = "reconciliation_issues"
    __table_args__ = (Index("ix_reconciliation_issues_unresolved", "resolved_at", "detected_at"),)
    partnership_id: Mapped[UUID] = mapped_column(ForeignKey("partnerships.id"))
    check_code: Mapped[str] = mapped_column(String(64))
    expected: Mapped[str] = mapped_column(Text)
    actual: Mapped[str] = mapped_column(Text)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(Text)
