"""CR-003 profile images: user avatars, company logos and store images

`stored_files` gains a second kind of owner: a USER_AVATAR belongs to a user (`owner_user_id`), every other file keeps
belonging to an organization. Exactly one owner is always set. Existing rows are all organization-owned documents,
so they satisfy the new checks unchanged.

Users, companies and stores point at their current image; deleting the file clears the pointer (ON DELETE SET NULL).

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

_OLD_CATEGORIES = "category IN ('VERIFICATION','IMPORT','EXPORT','PRODUCT_IMAGE')"
_NEW_CATEGORIES = "category IN ('VERIFICATION','IMPORT','EXPORT','PRODUCT_IMAGE','USER_AVATAR','ORG_LOGO')"

# (table, column) pointing at the owner's current image.
_IMAGE_POINTERS = (("users", "avatar_file_id"), ("companies", "logo_file_id"), ("stores", "logo_file_id"))


def upgrade() -> None:
    op.alter_column("stored_files", "organization_id", existing_type=sa.Uuid(), nullable=True)
    op.add_column("stored_files", sa.Column("owner_user_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_stored_files_owner_user_id_users"),
        "stored_files",
        "users",
        ["owner_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(op.f("ix_stored_files_owner_user_id"), "stored_files", ["owner_user_id"], unique=False)

    op.drop_constraint(op.f("ck_stored_files_category"), "stored_files", type_="check")
    op.create_check_constraint(op.f("ck_stored_files_category"), "stored_files", _NEW_CATEGORIES)
    op.create_check_constraint(
        op.f("ck_stored_files_exactly_one_owner"),
        "stored_files",
        "(organization_id IS NULL) <> (owner_user_id IS NULL)",
    )
    op.create_check_constraint(
        op.f("ck_stored_files_user_owner_only_for_avatar"),
        "stored_files",
        "(category = 'USER_AVATAR') = (owner_user_id IS NOT NULL)",
    )

    for table, column in _IMAGE_POINTERS:
        op.add_column(table, sa.Column(column, sa.Uuid(), nullable=True))
        op.create_foreign_key(
            op.f(f"fk_{table}_{column}_stored_files"), table, "stored_files", [column], ["id"], ondelete="SET NULL"
        )
        op.create_index(op.f(f"ix_{table}_{column}"), table, [column], unique=False)


def downgrade() -> None:
    # Files are never deleted (VER-005 trigger), so user-owned or new-category files cannot be dropped here.
    leftover = op.get_bind().scalar(
        sa.text(
            "SELECT count(*) FROM stored_files WHERE owner_user_id IS NOT NULL OR category IN ('USER_AVATAR','ORG_LOGO')"
        )
    )
    if leftover:
        raise RuntimeError(f"cannot downgrade 0008: {leftover} avatar/logo file(s) exist in stored_files")

    for table, column in reversed(_IMAGE_POINTERS):
        op.drop_index(op.f(f"ix_{table}_{column}"), table_name=table)
        op.drop_constraint(op.f(f"fk_{table}_{column}_stored_files"), table, type_="foreignkey")
        op.drop_column(table, column)

    op.drop_constraint(op.f("ck_stored_files_user_owner_only_for_avatar"), "stored_files", type_="check")
    op.drop_constraint(op.f("ck_stored_files_exactly_one_owner"), "stored_files", type_="check")
    op.drop_constraint(op.f("ck_stored_files_category"), "stored_files", type_="check")
    op.create_check_constraint(op.f("ck_stored_files_category"), "stored_files", _OLD_CATEGORIES)

    op.drop_index(op.f("ix_stored_files_owner_user_id"), table_name="stored_files")
    op.drop_constraint(op.f("fk_stored_files_owner_user_id_users"), "stored_files", type_="foreignkey")
    op.drop_column("stored_files", "owner_user_id")
    op.alter_column("stored_files", "organization_id", existing_type=sa.Uuid(), nullable=False)
