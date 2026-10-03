"""FND-010/012/013: durable outbox with immutable event data."""

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE outbox_events (
            id UUID PRIMARY KEY,
            event_type VARCHAR(64) NOT NULL,
            org_id UUID,
            payload JSONB NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
            attempts SMALLINT NOT NULL DEFAULT 0,
            next_attempt_at TIMESTAMPTZ NOT NULL,
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            processed_at TIMESTAMPTZ,
            CONSTRAINT ck_outbox_events_status CHECK (status IN ('PENDING','PROCESSED','FAILED')),
            CONSTRAINT ck_outbox_events_attempts CHECK (attempts >= 0 AND attempts <= 8)
        )
    """)
    op.execute("CREATE INDEX ix_outbox_events_pending ON outbox_events(next_attempt_at) WHERE status = 'PENDING'")
    op.execute("""
        CREATE TRIGGER outbox_forbid_delete BEFORE DELETE ON outbox_events
            FOR EACH ROW EXECUTE FUNCTION forbid_mutation()
    """)
    op.execute("""
        CREATE FUNCTION guard_outbox_update() RETURNS trigger AS $$
        BEGIN
            IF ROW(NEW.id, NEW.event_type, NEW.org_id, NEW.payload, NEW.created_at)
                IS DISTINCT FROM ROW(OLD.id, OLD.event_type, OLD.org_id, OLD.payload, OLD.created_at) THEN
                RAISE EXCEPTION 'append-only table: outbox_events' USING ERRCODE = 'P0001';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER outbox_guard_update BEFORE UPDATE ON outbox_events
            FOR EACH ROW EXECUTE FUNCTION guard_outbox_update();
    """)


def downgrade() -> None:
    op.drop_table("outbox_events")
    op.execute("DROP FUNCTION guard_outbox_update()")
