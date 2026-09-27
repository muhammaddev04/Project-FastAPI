"""P01 §10 onboarding intent: the Company/Store choice and organization name given at registration

Registration creates only the user (IAM-001); the organization is created after the first sign-in via /welcome
(ORG-001). These nullable columns keep what the user chose so /welcome/company|store can open directly. They are an
intent only: ownership lives in memberships, and nothing is ever created from them automatically.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("onboarding_org_type", sa.String(length=8), nullable=True))
    op.add_column("users", sa.Column("onboarding_org_name", sa.String(length=200), nullable=True))
    op.create_check_constraint(
        "onboarding_org_type", "users", "onboarding_org_type IS NULL OR onboarding_org_type IN ('COMPANY','STORE')"
    )


def downgrade() -> None:
    op.drop_constraint("onboarding_org_type", "users", type_="check")
    op.drop_column("users", "onboarding_org_name")
    op.drop_column("users", "onboarding_org_type")
