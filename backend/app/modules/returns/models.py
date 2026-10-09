"""P10 returns and disputes. PostgreSQL enforces the one-open-per-order rule and history.

A return moves goods and can earn a credit note; a dispute is a disagreement and never
touches the ledger itself (DSP-020), so it only ever points at the adjustment or return
its resolution created. Status history and dispute messages are append-only facts.
"""

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
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin, TimestampMixin

RETURN_STATUSES = ("REQUESTED", "APPROVED", "REJECTED", "CANCELLED", "RECEIVED", "COMPLETED")
RETURN_REASONS = ("DAMAGED", "EXPIRED", "WRONG_ITEM", "NOT_ORDERED", "QUALITY", "OTHER")
DISPUTE_STATUSES = ("OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED", "WITHDRAWN")
DISPUTE_TYPES = ("QUANTITY", "PRICE", "DAMAGED", "DELIVERY", "PAYMENT", "OTHER")
RESOLUTION_TYPES = ("NO_ACTION", "ADJUSTMENT_CREDIT", "CONVERTED_TO_RETURN")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ",".join(repr(value) for value in values) + ")"


class Return(IdMixin, TimestampMixin, Base):
    __tablename__ = "returns"
    __table_args__ = (
        UniqueConstraint("company_id", "return_number"),
        CheckConstraint(_in("status", RETURN_STATUSES), name="status"),
        CheckConstraint(_in("reason_code", RETURN_REASONS), name="reason_code"),
        CheckConstraint("source IN ('STORE_REQUEST','DISPUTE')", name="source"),
        # RET-001 note: OTHER must say what happened, so the reason is never unexplained.
        CheckConstraint("reason_code <> 'OTHER' OR length(trim(coalesce(note, ''))) > 0", name="other_needs_note"),
        CheckConstraint("(source = 'DISPUTE') = (dispute_id IS NOT NULL)", name="dispute_source"),
        CheckConstraint("total_credit IS NULL OR total_credit >= 0", name="total_credit"),
        # RET-010/011: the credit note exists exactly when a completed return earned credit.
        CheckConstraint(
            "credit_note_id IS NULL OR (status = 'COMPLETED' AND total_credit > 0)", name="credit_note_completed"
        ),
        CheckConstraint("(status = 'COMPLETED') = (completed_at IS NOT NULL)", name="completed_at"),
        CheckConstraint("(status = 'REJECTED') = (rejection_reason IS NOT NULL)", name="rejection_reason"),
        Index("ix_returns_company_status_created", "company_id", "status", "created_at"),
        Index("ix_returns_store_created", "store_id", "created_at"),
        Index("ix_returns_partnership_created", "partnership_id", "created_at"),
        # RET-004: one return at a time for an order, enforced by the database rather than a read.
        Index(
            "uq_returns_open_order",
            "order_id",
            unique=True,
            postgresql_where=text("status IN ('REQUESTED','APPROVED','RECEIVED')"),
        ),
    )
    return_number: Mapped[str] = mapped_column(String(20))
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"))
    store_id: Mapped[UUID] = mapped_column(ForeignKey("stores.id"))
    partnership_id: Mapped[UUID] = mapped_column(ForeignKey("partnerships.id"))
    order_id: Mapped[UUID] = mapped_column(ForeignKey("orders.id"))
    status: Mapped[str] = mapped_column(String(16), default="REQUESTED", server_default="REQUESTED")
    reason_code: Mapped[str] = mapped_column(String(16))
    note: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16), default="STORE_REQUEST", server_default="STORE_REQUEST")
    dispute_id: Mapped[UUID | None] = mapped_column(ForeignKey("disputes.id"))
    requested_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    approved_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    received_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    completed_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    cancel_reason: Mapped[str | None] = mapped_column(Text)
    total_credit: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    credit_note_id: Mapped[UUID | None] = mapped_column(ForeignKey("credit_notes.id"))
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class ReturnItem(IdMixin, Base):
    __tablename__ = "return_items"
    __table_args__ = (
        UniqueConstraint("return_id", "order_item_id"),
        CheckConstraint("requested_quantity > 0", name="requested_positive"),
        # The quantity ladder of the state machine, so no later step can exceed its source.
        CheckConstraint(
            "approved_quantity IS NULL OR (approved_quantity >= 0 AND approved_quantity <= requested_quantity)",
            name="approved_range",
        ),
        CheckConstraint(
            "received_quantity IS NULL OR "
            "(approved_quantity IS NOT NULL AND received_quantity >= 0 AND received_quantity <= approved_quantity)",
            name="received_range",
        ),
        CheckConstraint(
            "accepted_quantity IS NULL OR "
            "(received_quantity IS NOT NULL AND accepted_quantity >= 0 AND accepted_quantity <= received_quantity)",
            name="accepted_range",
        ),
        CheckConstraint(
            "restock_quantity IS NULL OR "
            "(accepted_quantity IS NOT NULL AND restock_quantity >= 0 AND restock_quantity <= accepted_quantity)",
            name="restock_range",
        ),
        CheckConstraint("line_credit IS NULL OR line_credit >= 0", name="line_credit"),
        Index("ix_return_items_return", "return_id"),
    )
    return_id: Mapped[UUID] = mapped_column(ForeignKey("returns.id"))
    order_item_id: Mapped[UUID] = mapped_column(ForeignKey("order_items.id"))
    requested_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    approved_quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 3))
    received_quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 3))
    accepted_quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 3))
    restock_quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 3))
    line_credit: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))


class ReturnStatusHistory(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "return_status_history"
    __table_args__ = (
        CheckConstraint("actor_type IN ('USER','SYSTEM')", name="actor_type"),
        CheckConstraint(_in("to_status", RETURN_STATUSES), name="to_status"),
        Index("ix_return_history_created", "return_id", "created_at"),
    )
    return_id: Mapped[UUID] = mapped_column(ForeignKey("returns.id"))
    from_status: Mapped[str | None] = mapped_column(String(16))
    to_status: Mapped[str] = mapped_column(String(16))
    actor_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    actor_type: Mapped[str] = mapped_column(String(8))
    reason: Mapped[str | None] = mapped_column(Text)


class Dispute(IdMixin, TimestampMixin, Base):
    __tablename__ = "disputes"
    __table_args__ = (
        UniqueConstraint("company_id", "dispute_number"),
        CheckConstraint(_in("status", DISPUTE_STATUSES), name="status"),
        CheckConstraint(_in("type", DISPUTE_TYPES), name="type"),
        CheckConstraint("target_type IN ('ORDER','PAYMENT')", name="target_type"),
        # The target decides which reference is set, so a dispute always has exactly one subject.
        CheckConstraint(
            "(target_type = 'ORDER' AND order_id IS NOT NULL AND payment_id IS NULL) OR "
            "(target_type = 'PAYMENT' AND payment_id IS NOT NULL AND order_id IS NULL)",
            name="target_reference",
        ),
        CheckConstraint("length(trim(description)) >= 10", name="description_length"),
        CheckConstraint("resolution_type IS NULL OR " + _in("resolution_type", RESOLUTION_TYPES), name="resolution"),
        CheckConstraint(
            "(status IN ('RESOLVED','REJECTED','WITHDRAWN')) = (resolved_at IS NOT NULL)", name="resolved_at"
        ),
        # DSP-020: a resolution may point at an adjustment or a return, never at a ledger row.
        CheckConstraint(
            "adjustment_id IS NULL OR resolution_type = 'ADJUSTMENT_CREDIT'", name="adjustment_needs_resolution"
        ),
        CheckConstraint("return_id IS NULL OR resolution_type = 'CONVERTED_TO_RETURN'", name="return_needs_resolution"),
        Index("ix_disputes_company_status_created", "company_id", "status", "created_at"),
        Index("ix_disputes_store_created", "store_id", "created_at"),
        Index("ix_disputes_partnership_created", "partnership_id", "created_at"),
        # DSP-003: one open dispute per order (`dispute_already_open`).
        Index(
            "uq_disputes_open_order",
            "order_id",
            unique=True,
            postgresql_where=text("status IN ('OPEN','UNDER_REVIEW')"),
        ),
    )
    dispute_number: Mapped[str] = mapped_column(String(20))
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"))
    store_id: Mapped[UUID] = mapped_column(ForeignKey("stores.id"))
    partnership_id: Mapped[UUID] = mapped_column(ForeignKey("partnerships.id"))
    target_type: Mapped[str] = mapped_column(String(8))
    order_id: Mapped[UUID | None] = mapped_column(ForeignKey("orders.id"))
    payment_id: Mapped[UUID | None] = mapped_column(ForeignKey("payments.id"))
    type: Mapped[str] = mapped_column(String(16))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="OPEN", server_default="OPEN")
    opened_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    resolution_type: Mapped[str | None] = mapped_column(String(24))
    resolution_note: Mapped[str | None] = mapped_column(Text)
    pending_adjustment_id: Mapped[UUID | None] = mapped_column(ForeignKey("adjustments.id"))
    adjustment_id: Mapped[UUID | None] = mapped_column(ForeignKey("adjustments.id"))
    return_id: Mapped[UUID | None] = mapped_column(ForeignKey("returns.id", use_alter=True))
    resolved_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class DisputeSlaWarning(IdMixin, CreatedAtMixin, Base):
    """DSP-024: one durable claim per dispute and 24-hour warning anchor."""

    __tablename__ = "dispute_sla_warnings"
    __table_args__ = (UniqueConstraint("dispute_id", "anchor_at"),)
    dispute_id: Mapped[UUID] = mapped_column(ForeignKey("disputes.id"))
    anchor_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class DisputeMessage(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "dispute_messages"
    __table_args__ = (
        CheckConstraint("author_side IN ('COMPANY','STORE','SYSTEM')", name="author_side"),
        CheckConstraint("length(trim(body)) > 0 AND length(body) <= 2000", name="body_length"),
        # DSP-021: the system itself reports a rejected adjustment, and has no user author.
        CheckConstraint("(author_side = 'SYSTEM') = (author_id IS NULL)", name="system_has_no_author"),
        Index("ix_dispute_messages_created", "dispute_id", "created_at"),
    )
    dispute_id: Mapped[UUID] = mapped_column(ForeignKey("disputes.id"))
    author_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    author_side: Mapped[str] = mapped_column(String(8))
    body: Mapped[str] = mapped_column(Text)
    file_id: Mapped[UUID | None] = mapped_column(ForeignKey("stored_files.id"))
