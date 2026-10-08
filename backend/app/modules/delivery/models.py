from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    SmallInteger,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin, TimestampMixin

RUN_STATUSES = ("DRAFT", "STARTED", "FINISHED", "CANCELLED")
DELIVERY_STATUSES = ("PLANNED", "ASSIGNED", "IN_TRANSIT", "ARRIVED", "DELIVERED", "FAILED", "CANCELLED")
#  A delivery that is still going somewhere; DEL §1.2 allows only one of these per order at a time.
OPEN_STATUSES = ("PLANNED", "ASSIGNED", "IN_TRANSIT", "ARRIVED")
FAILURE_REASONS = ("STORE_CLOSED", "REFUSED", "ADDRESS_NOT_FOUND", "NO_CONTACT", "VEHICLE_ISSUE", "OTHER")
SYNC_OPERATIONS = ("DELIVERY_ARRIVE", "DELIVERY_CONFIRM", "DELIVERY_FAIL", "PAYMENT_RECORD")
SYNC_RESULTS = ("APPLIED", "DUPLICATE", "CONFLICT", "REJECTED")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ",".join(f"'{value}'" for value in values) + ")"


class DeliveryRun(TimestampMixin, IdMixin, Base):
    __tablename__ = "delivery_runs"
    __table_args__ = (
        CheckConstraint(_in("status", RUN_STATUSES), name="status"),
        Index("ix_delivery_runs_company_date", "company_id", "run_date"),
        Index("ix_delivery_runs_courier_date", "courier_id", "run_date"),
    )
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"))
    courier_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    run_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default="DRAFT", server_default="DRAFT")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class Delivery(TimestampMixin, IdMixin, Base):
    __tablename__ = "deliveries"
    __table_args__ = (
        CheckConstraint(_in("status", DELIVERY_STATUSES), name="status"),
        CheckConstraint("attempt_no >= 1", name="attempt_no_positive"),
        CheckConstraint("code_attempts >= 0", name="code_attempts_nonnegative"),
        CheckConstraint(
            "confirmation_method IS NULL OR confirmation_method IN ('CODE','MANUAL_OVERRIDE')",
            name="confirmation_method",
        ),
        CheckConstraint(
            "failure_reason_code IS NULL OR " + _in("failure_reason_code", FAILURE_REASONS),
            name="failure_reason_code",
        ),
        # DEL-013: an override has to say why, and OTHER has to say what happened.
        CheckConstraint(
            "confirmation_method <> 'MANUAL_OVERRIDE' OR (manual_reason IS NOT NULL"
            " AND length(btrim(manual_reason)) >= 10)",
            name="manual_reason",
        ),
        CheckConstraint(
            "failure_reason_code <> 'OTHER' OR (failure_note IS NOT NULL AND length(btrim(failure_note)) >= 1)",
            name="failure_note",
        ),
        CheckConstraint("latitude IS NULL OR latitude BETWEEN -90 AND 90", name="latitude_range"),
        CheckConstraint("longitude IS NULL OR longitude BETWEEN -180 AND 180", name="longitude_range"),
        CheckConstraint("(latitude IS NULL) = (longitude IS NULL)", name="coordinates_both_or_none"),
        Index("uq_deliveries_order_attempt", "order_id", "attempt_no", unique=True),
        # One delivery per order may be in flight; a reattempt only starts once the previous one ended.
        Index(
            "uq_deliveries_order_open",
            "order_id",
            unique=True,
            postgresql_where=text("status IN ('PLANNED','ASSIGNED','IN_TRANSIT','ARRIVED')"),
        ),
        Index(
            "uq_deliveries_run_stop",
            "run_id",
            "stop_sequence",
            unique=True,
            postgresql_where=text("run_id IS NOT NULL AND stop_sequence IS NOT NULL"),
        ),
        Index("ix_deliveries_company_status", "company_id", "status"),
        Index("ix_deliveries_courier_status", "courier_id", "status"),
    )
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"))
    store_id: Mapped[UUID] = mapped_column(ForeignKey("stores.id"))
    order_id: Mapped[UUID] = mapped_column(ForeignKey("orders.id"))
    attempt_no: Mapped[int] = mapped_column(SmallInteger)
    status: Mapped[str] = mapped_column(String(16), default="PLANNED", server_default="PLANNED")
    run_id: Mapped[UUID | None] = mapped_column(ForeignKey("delivery_runs.id"))
    stop_sequence: Mapped[int | None] = mapped_column(SmallInteger)
    courier_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    address: Mapped[str] = mapped_column(Text)
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    # DEL-010/012: the code itself is never stored in the clear. The hash answers "is this the code",
    # the ciphertext is what the store is allowed to be shown, and nothing else may read either.
    code_hash: Mapped[str | None] = mapped_column(String(64))
    code_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary)
    code_attempts: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    code_locked: Mapped[bool] = mapped_column(default=False, server_default="false")
    confirmation_method: Mapped[str | None] = mapped_column(String(16))
    manual_reason: Mapped[str | None] = mapped_column(Text)
    failure_reason_code: Mapped[str | None] = mapped_column(String(24))
    failure_note: Mapped[str | None] = mapped_column(Text)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class DeliveryStatusHistory(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "delivery_status_history"
    __table_args__ = (
        CheckConstraint("actor_type IN ('USER','SYSTEM')", name="actor_type"),
        CheckConstraint("source IN ('ONLINE','OFFLINE_SYNC')", name="source"),
        Index("ix_delivery_history_created", "delivery_id", "created_at"),
    )
    delivery_id: Mapped[UUID] = mapped_column(ForeignKey("deliveries.id"))
    from_status: Mapped[str | None] = mapped_column(String(16))
    to_status: Mapped[str] = mapped_column(String(16))
    actor_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    actor_type: Mapped[str] = mapped_column(String(8))
    reason: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16), default="ONLINE", server_default="ONLINE")
    details: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, default=dict, server_default="{}")


class CourierSyncOperation(Base):
    """DEL-023: the client's `operation_id` is the primary key, so a replayed queue cannot act twice."""

    __tablename__ = "courier_sync_operations"
    __table_args__ = (
        CheckConstraint(_in("operation_type", SYNC_OPERATIONS), name="operation_type"),
        CheckConstraint(_in("result_status", SYNC_RESULTS), name="result_status"),
        Index("ix_courier_sync_received", "received_at"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    courier_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    operation_type: Mapped[str] = mapped_column(String(24))
    entity_id: Mapped[UUID]
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    client_created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    result_status: Mapped[str] = mapped_column(String(16))
    result: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
