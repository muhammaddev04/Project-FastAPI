"""P11 durable notifications and Telegram linking. Immutable schema snapshot."""

from alembic import op

revision = "20261009_0026"
down_revision = "20261008_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TABLE notifications (\n\tuser_id UUID NOT NULL, \n\torganization_id UUID, \n\tevent_id UUID NOT NULL, \n\tevent_type VARCHAR(64) NOT NULL, \n\ttitle_key VARCHAR(128) NOT NULL, \n\tbody_key VARCHAR(128) NOT NULL, \n\tparams JSONB NOT NULL, \n\tlink VARCHAR(255), \n\tread_at TIMESTAMP WITH TIME ZONE, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tCONSTRAINT pk_notifications PRIMARY KEY (id), \n\tCONSTRAINT fk_notifications_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE RESTRICT, \n\tCONSTRAINT fk_notifications_organization_id_organizations FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE RESTRICT, \n\tCONSTRAINT fk_notifications_event_id_outbox_events FOREIGN KEY(event_id) REFERENCES outbox_events (id) ON DELETE RESTRICT\n)"
    )
    op.execute("CREATE INDEX ix_notifications_user_unread_created ON notifications (user_id, read_at, created_at)")
    op.execute("CREATE UNIQUE INDEX uq_notifications_event_user ON notifications (event_id, user_id)")
    op.execute(
        "CREATE TABLE notification_deliveries (\n\tnotification_id UUID NOT NULL, \n\tchannel VARCHAR(8) NOT NULL, \n\tstatus VARCHAR(12) DEFAULT 'PENDING' NOT NULL, \n\tattempts SMALLINT DEFAULT '0' NOT NULL, \n\tprovider_message_id VARCHAR(128), \n\tlast_error TEXT, \n\tsent_at TIMESTAMP WITH TIME ZONE, \n\tnext_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tCONSTRAINT pk_notification_deliveries PRIMARY KEY (id), \n\tCONSTRAINT ck_notification_deliveries_channel CHECK (channel IN ('TELEGRAM','SMS')), \n\tCONSTRAINT ck_notification_deliveries_status CHECK (status IN ('PENDING','SENT','FAILED','SKIPPED')), \n\tCONSTRAINT ck_notification_deliveries_attempts CHECK (attempts BETWEEN 0 AND 3), \n\tCONSTRAINT fk_notification_deliveries_notification_id_notifications FOREIGN KEY(notification_id) REFERENCES notifications (id) ON DELETE RESTRICT\n)"
    )
    op.execute("CREATE INDEX ix_notification_deliveries_pending ON notification_deliveries (status, next_attempt_at)")
    op.execute(
        "CREATE UNIQUE INDEX uq_notification_deliveries_notification_channel ON notification_deliveries (notification_id, channel)"
    )
    op.execute(
        "CREATE TABLE notification_preferences (\n\tuser_id UUID NOT NULL, \n\tevent_group VARCHAR(16) NOT NULL, \n\tchannel VARCHAR(8) NOT NULL, \n\tenabled BOOLEAN NOT NULL, \n\tCONSTRAINT pk_notification_preferences PRIMARY KEY (user_id, event_group, channel), \n\tCONSTRAINT ck_notification_preferences_channel CHECK (channel IN ('TELEGRAM','SMS')), \n\tCONSTRAINT ck_notification_preferences_event_group CHECK (event_group IN ('admin','account','billing','catalog','stock','partners','orders','delivery','finance','returns','disputes')), \n\tCONSTRAINT fk_notification_preferences_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE RESTRICT\n)"
    )
    op.execute(
        "CREATE TABLE telegram_accounts (\n\tuser_id UUID NOT NULL, \n\ttelegram_user_id BIGINT NOT NULL, \n\tchat_id BIGINT NOT NULL, \n\tusername VARCHAR(64), \n\tlanguage VARCHAR(2), \n\tlinked_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tis_blocked_by_user BOOLEAN DEFAULT 'false' NOT NULL, \n\tCONSTRAINT pk_telegram_accounts PRIMARY KEY (user_id), \n\tCONSTRAINT fk_telegram_accounts_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE RESTRICT, \n\tCONSTRAINT uq_telegram_accounts_telegram_user_id UNIQUE (telegram_user_id)\n)"
    )
    op.execute(
        "CREATE TABLE telegram_link_tokens (\n\ttoken_hash VARCHAR(64) NOT NULL, \n\tuser_id UUID NOT NULL, \n\texpires_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tused_at TIMESTAMP WITH TIME ZONE, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tCONSTRAINT pk_telegram_link_tokens PRIMARY KEY (token_hash), \n\tCONSTRAINT fk_telegram_link_tokens_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE RESTRICT\n)"
    )
    op.execute("CREATE INDEX ix_telegram_link_tokens_expires_at ON telegram_link_tokens (expires_at)")
    op.execute(
        "CREATE TABLE telegram_updates (\n\tupdate_id BIGSERIAL NOT NULL, \n\treceived_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tCONSTRAINT pk_telegram_updates PRIMARY KEY (update_id)\n)"
    )
    op.execute("CREATE INDEX ix_telegram_updates_received_at ON telegram_updates (received_at)")


def downgrade() -> None:
    op.drop_table("telegram_updates")
    op.drop_table("telegram_link_tokens")
    op.drop_table("telegram_accounts")
    op.drop_table("notification_preferences")
    op.drop_table("notification_deliveries")
    op.drop_table("notifications")
