"""CR-003 profile-image lifecycle: retired stored files

Rows of `stored_files` are never deleted (VER-005, `stored_files_no_delete` trigger, unchanged here). A replaced or
removed profile image is retired instead: `deleted_at` is set, the row stays as history and its storage object is
removed after the commit. Only USER_AVATAR and ORG_LOGO can be retired, so verification, import, export and product
files keep their guarantee in the database itself.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stored_files", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        op.f("ck_stored_files_deleted_only_profile_images"),
        "stored_files",
        "deleted_at IS NULL OR category IN ('USER_AVATAR','ORG_LOGO')",
    )


def downgrade() -> None:
    # Dropping the column would silently turn retired images back into active-looking rows.
    retired = op.get_bind().scalar(sa.text("SELECT count(*) FROM stored_files WHERE deleted_at IS NOT NULL"))
    if retired:
        raise RuntimeError(f"cannot downgrade 0009: {retired} retired profile image row(s) exist in stored_files")
    op.drop_constraint(op.f("ck_stored_files_deleted_only_profile_images"), "stored_files", type_="check")
    op.drop_column("stored_files", "deleted_at")
