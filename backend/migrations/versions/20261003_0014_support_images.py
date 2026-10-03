"""Private screenshots for support reports."""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("support_tickets", sa.Column("image_key", sa.String(512), nullable=True))


def downgrade() -> None:
    op.drop_column("support_tickets", "image_key")
