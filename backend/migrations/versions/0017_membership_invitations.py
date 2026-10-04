"""P01 invitation lifecycle and tenant/email uniqueness.

Revision ID: 0017
Revises: 0016
"""

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "membership_invitations",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("organization_id", sa.UUID(), sa.ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), server_default="PENDING", nullable=False),
        sa.Column("invited_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "role IN ('MANAGER','OPERATOR','WAREHOUSE','COURIER','SELLER')", name=op.f("ck_membership_invitations_role")
        ),
        sa.CheckConstraint(
            "status IN ('PENDING','ACCEPTED','DECLINED','REVOKED','EXPIRED')",
            name=op.f("ck_membership_invitations_status"),
        ),
    )
    op.create_index("ix_membership_invitations_organization_id", "membership_invitations", ["organization_id"])
    op.create_index("ix_invitations_email_status", "membership_invitations", [sa.text("lower(email)"), "status"])
    op.create_index(
        "uq_invitations_org_email_pending",
        "membership_invitations",
        ["organization_id", sa.text("lower(email)")],
        unique=True,
        postgresql_where=sa.text("status = 'PENDING'"),
    )
    op.execute("""
    CREATE FUNCTION check_invitation_role() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE org_type text;
    BEGIN
        SELECT type INTO org_type FROM organizations WHERE id = NEW.organization_id;
        IF (org_type = 'COMPANY' AND NEW.role NOT IN ('MANAGER','OPERATOR','WAREHOUSE','COURIER'))
           OR (org_type = 'STORE' AND NEW.role <> 'SELLER') THEN
            RAISE EXCEPTION 'invitation role does not match organization type' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END $$;
    """)
    op.execute("""CREATE TRIGGER invitation_role_matches_org BEFORE INSERT OR UPDATE ON membership_invitations
      FOR EACH ROW EXECUTE FUNCTION check_invitation_role()""")


def downgrade() -> None:
    op.drop_table("membership_invitations")
    op.execute("DROP FUNCTION check_invitation_role()")
