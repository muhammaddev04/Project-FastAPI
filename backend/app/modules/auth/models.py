from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CHAR, CheckConstraint, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin

TOKEN_PURPOSES = ("VERIFY_EMAIL", "RESET_PASSWORD")


class EmailToken(IdMixin, CreatedAtMixin, Base):
    """P01 §2.2 (CR-001): one-time secret delivered in an email link. Only its HMAC is stored, never the token."""

    __tablename__ = "email_tokens"
    __table_args__ = (CheckConstraint("purpose IN ('VERIFY_EMAIL','RESET_PASSWORD')", name="purpose"),)

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    purpose: Mapped[str] = mapped_column(String(16))
    token_hash: Mapped[str] = mapped_column(CHAR(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
