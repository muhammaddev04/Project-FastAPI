"""P12 export records. Immutable schema snapshot.

Two existing tables grow with this part: an admin export (§2.1 `organization_id` NULL) belongs to the superadmin
who asked for it, so `stored_files` has to accept a user-owned EXPORT, and `EXPORT_READY` (EXP-008) adds the
`exports` notification group.
"""

from alembic import op

revision = "20261009_0027"
down_revision = "20261009_p10_finalize"
branch_labels = None
depends_on = None

_USER_OWNER = "ck_stored_files_user_owner_only_for_avatar"
_EVENT_GROUP = "ck_notification_preferences_event_group"
_GROUPS = "'admin','account','billing','catalog','stock','partners','orders','delivery','finance','returns','disputes'"


def upgrade() -> None:
    op.execute(
        "CREATE TABLE exports (\n\torganization_id UUID, \n\trequested_by UUID NOT NULL, \n\tkind VARCHAR(32) NOT NULL, \n\tformat VARCHAR(4) NOT NULL, \n\tparams JSONB DEFAULT '{}' NOT NULL, \n\tstatus VARCHAR(12) DEFAULT 'PENDING' NOT NULL, \n\tfile_id UUID, \n\trow_count INTEGER, \n\terror TEXT, \n\texpires_at TIMESTAMP WITH TIME ZONE, \n\tstarted_at TIMESTAMP WITH TIME ZONE, \n\tready_at TIMESTAMP WITH TIME ZONE, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tCONSTRAINT pk_exports PRIMARY KEY (id), \n\tCONSTRAINT ck_exports_status CHECK (status IN ('PENDING','RUNNING','READY','FAILED','EXPIRED')), \n\tCONSTRAINT ck_exports_format CHECK (format IN ('CSV','XLSX')), \n\tCONSTRAINT ck_exports_row_count_nonnegative CHECK (row_count IS NULL OR row_count >= 0), \n\tCONSTRAINT ck_exports_ready_has_file CHECK ((status = 'READY') = (file_id IS NOT NULL AND ready_at IS NOT NULL)), \n\tCONSTRAINT ck_exports_ready_has_expiry CHECK (status <> 'READY' OR expires_at IS NOT NULL), \n\tCONSTRAINT fk_exports_organization_id_organizations FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE RESTRICT, \n\tCONSTRAINT fk_exports_requested_by_users FOREIGN KEY(requested_by) REFERENCES users (id) ON DELETE RESTRICT, \n\tCONSTRAINT fk_exports_file_id_stored_files FOREIGN KEY(file_id) REFERENCES stored_files (id) ON DELETE RESTRICT\n)"
    )
    op.execute("CREATE INDEX ix_exports_organization_created ON exports (organization_id, created_at)")
    op.execute("CREATE INDEX ix_exports_status_created ON exports (status, created_at)")
    op.drop_constraint(op.f(_USER_OWNER), "stored_files", type_="check")
    op.create_check_constraint(
        op.f(_USER_OWNER),
        "stored_files",
        "(category <> 'USER_AVATAR' OR owner_user_id IS NOT NULL)"
        " AND (owner_user_id IS NULL OR category IN ('USER_AVATAR','EXPORT'))",
    )
    op.drop_constraint(op.f(_EVENT_GROUP), "notification_preferences", type_="check")
    op.create_check_constraint(op.f(_EVENT_GROUP), "notification_preferences", f"event_group IN ({_GROUPS},'exports')")


def downgrade() -> None:
    op.execute("DELETE FROM notification_preferences WHERE event_group = 'exports'")
    op.drop_constraint(op.f(_EVENT_GROUP), "notification_preferences", type_="check")
    op.create_check_constraint(op.f(_EVENT_GROUP), "notification_preferences", f"event_group IN ({_GROUPS})")
    op.drop_table("exports")
    op.drop_constraint(op.f(_USER_OWNER), "stored_files", type_="check")
    op.create_check_constraint(
        op.f(_USER_OWNER), "stored_files", "(category = 'USER_AVATAR') = (owner_user_id IS NOT NULL)"
    )
