"""core idempotency records (P00 §3.2, FND-014)

The claim and the stored result of one `Idempotency-Key` request (GLOBAL §7.7): unique per (`scope`, `key`), expiring
after 24 hours (7 days for offline sync).

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "idempotency_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.Uuid(), nullable=False),
        sa.Column("scope", sa.String(length=255), nullable=False),
        sa.Column("request_hash", sa.CHAR(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("response_status", sa.SmallInteger(), nullable=True),
        sa.Column("response_body", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('IN_PROGRESS','COMPLETED')", name=op.f("ck_idempotency_records_status")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_idempotency_records")),
        sa.UniqueConstraint("scope", "key", name=op.f("uq_idempotency_records_scope_key")),
    )
    op.create_index(op.f("ix_idempotency_records_expires_at"), "idempotency_records", ["expires_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_idempotency_records_expires_at"), table_name="idempotency_records")
    op.drop_table("idempotency_records")
