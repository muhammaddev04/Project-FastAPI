from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, IdMixin, TimestampMixin

ORG_TYPES = ("COMPANY", "STORE")
COMPANY_ROLES = ("OWNER", "MANAGER", "OPERATOR", "WAREHOUSE", "COURIER")
STORE_ROLES = ("OWNER", "SELLER")
ROLES_BY_ORG_TYPE: dict[str, tuple[str, ...]] = {"COMPANY": COMPANY_ROLES, "STORE": STORE_ROLES}


class User(IdMixin, TimestampMixin, Base):
    """P01 §2.1 as changed by CR-001: email is the required login identifier; phone is an optional contact."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(r"phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$'", name="phone_e164"),
        CheckConstraint("language IN ('tg','ru','en')", name="language"),
        CheckConstraint("status IN ('ACTIVE','BLOCKED')", name="status"),
        # CR-001: email is the login identifier, unique regardless of letter case.
        Index("uq_users_email_lower", func.lower(text("email")), unique=True),
    )

    phone: Mapped[str | None] = mapped_column(String(16), unique=True)
    full_name: Mapped[str] = mapped_column(String(150))
    password_hash: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(254))
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    language: Mapped[str] = mapped_column(String(2), default="tg", server_default="tg")
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", server_default="ACTIVE")
    is_superadmin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    token_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    phone_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Organization(IdMixin, TimestampMixin, Base):
    """P01 §2.4 shared organization row; Company/Store profiles are added 1:1 in P02."""

    __tablename__ = "organizations"
    __table_args__ = (
        CheckConstraint("type IN ('COMPANY','STORE')", name="type"),
        CheckConstraint("status IN ('ACTIVE','SUSPENDED','BLOCKED')", name="status"),
    )

    type: Mapped[str] = mapped_column(String(8))
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", server_default="ACTIVE")
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class Membership(IdMixin, TimestampMixin, Base):
    """P01 §2.5."""

    __tablename__ = "memberships"
    __table_args__ = (
        CheckConstraint("role IN ('OWNER','MANAGER','OPERATOR','WAREHOUSE','COURIER','SELLER')", name="role"),
        CheckConstraint("status IN ('ACTIVE','SUSPENDED','REVOKED')", name="status"),
        Index(
            "uq_memberships_user_org_open",
            "user_id",
            "organization_id",
            unique=True,
            postgresql_where=text("status <> 'REVOKED'"),
        ),
        Index(
            "uq_memberships_single_owner",
            "organization_id",
            unique=True,
            postgresql_where=text("role = 'OWNER' AND status = 'ACTIVE'"),
        ),
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    organization_id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id", ondelete="RESTRICT"), index=True)
    role: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", server_default="ACTIVE")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invited_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    organization: Mapped[Organization] = relationship(lazy="joined")
    user: Mapped[User] = relationship(foreign_keys=[user_id], lazy="joined")


class OAuthIdentity(IdMixin, TimestampMixin, Base):
    """External identity link (Google `sub`). Linked only by provider subject, never by e-mail alone."""

    __tablename__ = "oauth_identities"
    __table_args__ = (
        CheckConstraint("provider IN ('google')", name="provider"),
        Index("uq_oauth_identities_provider_subject", "provider", "subject", unique=True),
        Index("uq_oauth_identities_provider_user", "provider", "user_id", unique=True),
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    provider: Mapped[str] = mapped_column(String(16))
    subject: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(254))
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
