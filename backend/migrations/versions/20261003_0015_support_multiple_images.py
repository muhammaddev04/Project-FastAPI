"""Multiple private screenshots per support report."""
import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("support_tickets", sa.Column(
        "additional_image_keys", sa.JSON(), nullable=False, server_default="[]",
    ))


def downgrade() -> None:
    op.drop_column("support_tickets", "additional_image_keys")
