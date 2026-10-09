"""P12 §2.1 asynchronous export records."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin

STATUSES = ("PENDING", "RUNNING", "READY", "FAILED", "EXPIRED")
FORMATS = ("CSV", "XLSX")


class Export(IdMixin, CreatedAtMixin, Base):
    """One requested file. `organization_id` is NULL for an admin export (EXP §2.1)."""

    __tablename__ = "exports"
    __table_args__ = (
        CheckConstraint("status IN (" + ",".join(f"'{value}'" for value in STATUSES) + ")", name="status"),
        CheckConstraint("format IN ('CSV','XLSX')", name="format"),
        CheckConstraint("row_count IS NULL OR row_count >= 0", name="row_count_nonnegative"),
        # EXP-003/004: a READY file is the only one that has somewhere to download from and an expiry.
        CheckConstraint("(status = 'READY') = (file_id IS NOT NULL AND ready_at IS NOT NULL)", name="ready_has_file"),
        CheckConstraint("status <> 'READY' OR expires_at IS NOT NULL", name="ready_has_expiry"),
        Index("ix_exports_organization_created", "organization_id", "created_at"),
        Index("ix_exports_status_created", "status", "created_at"),
    )

    organization_id: Mapped[UUID | None] = mapped_column(ForeignKey("organizations.id", ondelete="RESTRICT"))
    requested_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    kind: Mapped[str] = mapped_column(String(32))
    format: Mapped[str] = mapped_column(String(4))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    status: Mapped[str] = mapped_column(String(12), default="PENDING", server_default="PENDING")
    file_id: Mapped[UUID | None] = mapped_column(ForeignKey("stored_files.id", ondelete="RESTRICT"))
    row_count: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
