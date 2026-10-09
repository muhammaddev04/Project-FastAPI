"""P10 private dispute attachments and durable SLA warning claims."""

import sqlalchemy as sa
from alembic import op

revision = "20261009_p10_finalize"
down_revision = "20261009_0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_stored_files_category"), "stored_files", type_="check")
    op.create_check_constraint(
        op.f("ck_stored_files_category"),
        "stored_files",
        "category IN ('VERIFICATION','IMPORT','EXPORT','PRODUCT_IMAGE','USER_AVATAR','ORG_LOGO','DISPUTE')",
    )
    op.create_table(
        "dispute_sla_warnings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("dispute_id", sa.UUID(), nullable=False),
        sa.Column("anchor_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_dispute_sla_warnings"),
        sa.ForeignKeyConstraint(["dispute_id"], ["disputes.id"], name="fk_dispute_sla_warnings_dispute_id_disputes"),
        sa.UniqueConstraint("dispute_id", "anchor_at", name="uq_dispute_sla_warnings_dispute_id_anchor_at"),
    )
    op.execute(
        "CREATE TRIGGER dispute_sla_warnings_immutable BEFORE UPDATE OR DELETE ON dispute_sla_warnings "
        "FOR EACH ROW EXECUTE FUNCTION forbid_mutation()"
    )


def downgrade() -> None:
    op.drop_table("dispute_sla_warnings")
    op.drop_constraint(op.f("ck_stored_files_category"), "stored_files", type_="check")
    op.create_check_constraint(
        op.f("ck_stored_files_category"),
        "stored_files",
        "category IN ('VERIFICATION','IMPORT','EXPORT','PRODUCT_IMAGE','USER_AVATAR','ORG_LOGO')",
    )
