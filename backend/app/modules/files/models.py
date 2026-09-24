from __future__ import annotations

from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin

FILE_CATEGORIES = ("VERIFICATION", "IMPORT", "EXPORT", "PRODUCT_IMAGE")


class StoredFile(IdMixin, CreatedAtMixin, Base):
    """P02 §1.3. `display_name` is sanitised and for display only; the storage key never uses it."""

    __tablename__ = "stored_files"
    __table_args__ = (
        CheckConstraint("category IN ('VERIFICATION','IMPORT','EXPORT','PRODUCT_IMAGE')", name="category"),
        CheckConstraint("size_bytes > 0", name="size_positive"),
    )

    organization_id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id", ondelete="RESTRICT"), index=True)
    category: Mapped[str] = mapped_column(String(32))
    storage_key: Mapped[str] = mapped_column(String(512), unique=True)
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    display_name: Mapped[str] = mapped_column(String(255))
    uploaded_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
