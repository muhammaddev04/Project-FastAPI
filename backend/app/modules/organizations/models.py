from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.time import utcnow

VERIFICATION_STATUSES = ("NOT_SUBMITTED", "PENDING", "APPROVED", "REJECTED")
_STATUS_CHECK = "verification_status IN ('NOT_SUBMITTED','PENDING','APPROVED','REJECTED')"
_PHONE_CHECK = r"phone ~ '^\+[1-9][0-9]{7,14}$'"


class _Profile:
    """Columns shared by Company and Store profiles (P02 §1.1-1.2)."""

    legal_name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str] = mapped_column(String(16))
    email: Mapped[str | None] = mapped_column(String(254))
    city: Mapped[str] = mapped_column(String(100))
    address: Mapped[str] = mapped_column(String(500))
    verification_status: Mapped[str] = mapped_column(
        String(16), default="NOT_SUBMITTED", server_default="NOT_SUBMITTED"
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=utcnow)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class Company(_Profile, Base):
    """P02 §1.1 - 1:1 with organizations (type COMPANY)."""

    __tablename__ = "companies"
    __table_args__ = (
        CheckConstraint(_STATUS_CHECK, name="verification_status"),
        CheckConstraint(_PHONE_CHECK, name="phone_e164"),
        CheckConstraint(r"tax_identifier ~ '^[0-9]{9,12}$'", name="tax_identifier_format"),
        CheckConstraint(r"public_code ~ '^[A-HJ-NP-Z2-9]{8}$'", name="public_code_format"),
    )

    id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id", ondelete="RESTRICT"), primary_key=True)
    tax_identifier: Mapped[str] = mapped_column(String(32), unique=True)
    public_code: Mapped[str] = mapped_column(String(8), unique=True)


class Store(_Profile, Base):
    """P02 §1.2 - 1:1 with organizations (type STORE); tax identifier optional, coordinates both-or-none."""

    __tablename__ = "stores"
    __table_args__ = (
        CheckConstraint(_STATUS_CHECK, name="verification_status"),
        CheckConstraint(_PHONE_CHECK, name="phone_e164"),
        CheckConstraint(r"tax_identifier IS NULL OR tax_identifier ~ '^[0-9]{9,12}$'", name="tax_identifier_format"),
        CheckConstraint("latitude IS NULL OR latitude BETWEEN -90 AND 90", name="latitude_range"),
        CheckConstraint("longitude IS NULL OR longitude BETWEEN -180 AND 180", name="longitude_range"),
        CheckConstraint("(latitude IS NULL) = (longitude IS NULL)", name="coordinates_both_or_none"),
        Index(
            "uq_stores_tax_identifier",
            "tax_identifier",
            unique=True,
            postgresql_where=text("tax_identifier IS NOT NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id", ondelete="RESTRICT"), primary_key=True)
    tax_identifier: Mapped[str | None] = mapped_column(String(32))
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
