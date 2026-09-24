from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, SmallInteger, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin

OTP_PURPOSES = ("REGISTER", "RESET_PASSWORD", "LINK_PHONE")


class OtpCode(IdMixin, CreatedAtMixin, Base):
    """P01 §2.2. LINK_PHONE confirms the phone during first Google sign-in (product decision)."""

    __tablename__ = "otp_codes"
    __table_args__ = (CheckConstraint("purpose IN ('REGISTER','RESET_PASSWORD','LINK_PHONE')", name="purpose"),)

    phone: Mapped[str] = mapped_column(String(16), index=True)
    purpose: Mapped[str] = mapped_column(String(16))
    code_hash: Mapped[str] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RefreshToken(CreatedAtMixin, Base):
    """P01 §2.3 — id is the token's jti; only the SHA-256 of the token is stored."""

    __tablename__ = "refresh_tokens"

    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    family_id: Mapped[UUID] = mapped_column(index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replaced_by_id: Mapped[UUID | None]
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(512))


class OAuthIdentity(IdMixin, CreatedAtMixin, Base):
    """Links an external identity (Google `sub`) to a user. Never linked by e-mail or unverified phone."""

    __tablename__ = "oauth_identities"
    __table_args__ = (
        CheckConstraint("provider IN ('google')", name="provider"),
        UniqueConstraint("provider", "subject"),
        UniqueConstraint("provider", "user_id"),
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    provider: Mapped[str] = mapped_column(String(16))
    subject: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(254))
