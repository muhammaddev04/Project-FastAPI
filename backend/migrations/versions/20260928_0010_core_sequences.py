"""core sequences (P00 §3.1, FND-024)

Named counters for human-visible numbers such as `ORD-2026-000123`: one row per `(scope, key)`, incremented atomically
by `SequenceService.next`.

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sequences",
        sa.Column("scope", sa.String(length=64), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("last_value", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.PrimaryKeyConstraint("scope", "key", name=op.f("pk_sequences")),
    )


def downgrade() -> None:
    op.drop_table("sequences")
