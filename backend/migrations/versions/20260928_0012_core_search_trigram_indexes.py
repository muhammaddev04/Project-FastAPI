"""search trigram indexes (GLOBAL §7.6, FND-011)

`?search=` uses ILIKE backed by pg_trgm: the extension and GIN trigram indexes on the columns `GET /members` searches
(P01 §6: `full_name`, `phone`).

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-28
"""

from __future__ import annotations

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_index(
        "ix_users_full_name_trgm",
        "users",
        ["full_name"],
        postgresql_using="gin",
        postgresql_ops={"full_name": "gin_trgm_ops"},
    )
    op.create_index(
        "ix_users_phone_trgm", "users", ["phone"], postgresql_using="gin", postgresql_ops={"phone": "gin_trgm_ops"}
    )


def downgrade() -> None:
    op.drop_index("ix_users_phone_trgm", table_name="users")
    op.drop_index("ix_users_full_name_trgm", table_name="users")
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
