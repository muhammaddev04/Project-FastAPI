"""CR-001: email is the login identifier; phone becomes an optional contact

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-25
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # No addresses are invented for existing accounts: the migration stops if any user has no email.
    op.execute(
        """
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM users WHERE email IS NULL) THEN
            RAISE EXCEPTION 'CR-001: every user needs an email before it becomes the login identifier';
          END IF;
        END $$;
        """
    )
    op.drop_constraint("email_verified_requires_email", "users", type_="check")
    op.alter_column("users", "email", existing_type=sa.String(length=254), nullable=False)
    op.drop_index("uq_users_email_lower", table_name="users")
    op.create_index("uq_users_email_lower", "users", [sa.literal_column("lower(email)")], unique=True)

    op.alter_column("users", "phone", existing_type=sa.String(length=16), nullable=True)
    op.alter_column("users", "phone_verified_at", existing_type=sa.DateTime(timezone=True), nullable=True)
    op.drop_constraint("phone_e164", "users", type_="check")
    op.create_check_constraint("phone_e164", "users", r"phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$'")


def downgrade() -> None:
    op.drop_constraint("phone_e164", "users", type_="check")
    op.create_check_constraint("phone_e164", "users", r"phone ~ '^\+[1-9][0-9]{7,14}$'")
    op.alter_column("users", "phone_verified_at", existing_type=sa.DateTime(timezone=True), nullable=False)
    op.alter_column("users", "phone", existing_type=sa.String(length=16), nullable=False)

    op.drop_index("uq_users_email_lower", table_name="users")
    op.create_index(
        "uq_users_email_lower",
        "users",
        [sa.literal_column("lower(email)")],
        unique=True,
        postgresql_where=sa.text("email IS NOT NULL"),
    )
    op.alter_column("users", "email", existing_type=sa.String(length=254), nullable=True)
    op.create_check_constraint(
        "email_verified_requires_email", "users", "email_verified_at IS NULL OR email IS NOT NULL"
    )
