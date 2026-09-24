from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, CreatedAtMixin, IdMixin, TimestampMixin

REQUEST_STATUSES = ("SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED")
DOC_TYPES = ("REGISTRATION_CERTIFICATE", "TAX_CERTIFICATE", "OTHER")


class VerificationRequest(IdMixin, TimestampMixin, Base):
    """P02 §1.4. At most one open (SUBMITTED/UNDER_REVIEW) request per organization."""

    __tablename__ = "verification_requests"
    __table_args__ = (
        CheckConstraint("status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED')", name="status"),
        CheckConstraint("status <> 'REJECTED' OR rejection_reason IS NOT NULL", name="rejection_reason_required"),
        Index(
            "uq_verification_requests_open",
            "organization_id",
            unique=True,
            postgresql_where=text("status IN ('SUBMITTED','UNDER_REVIEW')"),
        ),
    )

    organization_id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id", ondelete="RESTRICT"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="SUBMITTED")
    submitted_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reviewer_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    review_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    legal_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    documents: Mapped[list[VerificationDocument]] = relationship(
        lazy="selectin", order_by="VerificationDocument.created_at"
    )


class VerificationDocument(IdMixin, CreatedAtMixin, Base):
    """P02 §1.5."""

    __tablename__ = "verification_documents"
    __table_args__ = (
        CheckConstraint("doc_type IN ('REGISTRATION_CERTIFICATE','TAX_CERTIFICATE','OTHER')", name="doc_type"),
    )

    request_id: Mapped[UUID] = mapped_column(ForeignKey("verification_requests.id", ondelete="RESTRICT"), index=True)
    doc_type: Mapped[str] = mapped_column(String(32))
    file_id: Mapped[UUID] = mapped_column(ForeignKey("stored_files.id", ondelete="RESTRICT"))
