from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin

# CR-003 adds USER_AVATAR (owned by a user) and ORG_LOGO (company logo / store image, owned by the organization).
FILE_CATEGORIES = ("VERIFICATION", "IMPORT", "EXPORT", "PRODUCT_IMAGE", "USER_AVATAR", "ORG_LOGO", "DISPUTE")
# CR-003: only these can be retired (`deleted_at`); every other file keeps the VER-005 guarantee.
RETIRABLE_CATEGORIES = ("USER_AVATAR", "ORG_LOGO")


class StoredFile(IdMixin, CreatedAtMixin, Base):
    """P02 §1.3 (+ CR-003). `display_name` is sanitised and for display only; the storage key never uses it.

    A file belongs to exactly one owner: an organization (documents, logos) or, for USER_AVATAR, a user.
    Rows are never deleted (`stored_files_no_delete` trigger); a replaced or removed profile image is retired by
    setting `deleted_at`, and only rows with `deleted_at IS NULL` are active.
    """

    __tablename__ = "stored_files"
    __table_args__ = (
        CheckConstraint(
            "category IN ('VERIFICATION','IMPORT','EXPORT','PRODUCT_IMAGE','USER_AVATAR','ORG_LOGO','DISPUTE')",
            name="category",
        ),
        CheckConstraint("(organization_id IS NULL) <> (owner_user_id IS NULL)", name="exactly_one_owner"),
        CheckConstraint("(category = 'USER_AVATAR') = (owner_user_id IS NOT NULL)", name="user_owner_only_for_avatar"),
        CheckConstraint("size_bytes > 0", name="size_positive"),
        CheckConstraint(
            "deleted_at IS NULL OR category IN ('USER_AVATAR','ORG_LOGO')", name="deleted_only_profile_images"
        ),
    )

    organization_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT"), index=True, nullable=True
    )
    owner_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=True
    )
    category: Mapped[str] = mapped_column(String(32))
    storage_key: Mapped[str] = mapped_column(String(512), unique=True)
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    display_name: Mapped[str] = mapped_column(String(255))
    uploaded_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
