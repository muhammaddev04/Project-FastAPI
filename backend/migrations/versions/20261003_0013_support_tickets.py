"""User feedback and bug reports.

Revision ID: 0013
Revises: 0012
"""
import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "support_tickets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("subject", sa.String(160), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("page_url", sa.String(500)),
        sa.Column("status", sa.String(16), nullable=False, server_default="OPEN"),
        sa.Column("reply", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("kind IN ('BUG','FEEDBACK')", name=op.f("ck_support_tickets_kind")),
        sa.CheckConstraint("status IN ('OPEN','IN_PROGRESS','RESOLVED')", name=op.f("ck_support_tickets_status")),
    )
    op.create_index("ix_support_tickets_user_id", "support_tickets", ["user_id"])


def downgrade() -> None:
    op.drop_table("support_tickets")
