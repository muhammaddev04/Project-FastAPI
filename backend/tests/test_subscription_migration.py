"""Upgrade an existing P02 company in a disposable PostgreSQL database."""

import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import asyncpg
from sqlalchemy.engine import make_url

from app.core.time import new_id


async def test_p03_migration_backfills_trial_history_audit_and_event() -> None:
    original = make_url(os.environ["DATABASE_URL"])
    database = "p03_migration_" + uuid4().hex
    admin_url = original.set(drivername="postgresql", database="postgres")
    admin = await asyncpg.connect(admin_url.render_as_string(hide_password=False))
    try:
        # This database is created here, has a fixed safe prefix and never replaces existing data.
        await admin.execute(f'CREATE DATABASE "{database}"')
        probe_url = original.set(database=database)
        environment = {**os.environ, "DATABASE_URL": probe_url.render_as_string(hide_password=False)}
        backend = Path(__file__).resolve().parent.parent

        def migrate(revision: str) -> None:
            result = subprocess.run(
                [sys.executable, "-m", "alembic", "upgrade", revision],
                cwd=backend,
                env=environment,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=60,
            )
            assert result.returncode == 0, result.stderr

        migrate("0017")
        connection = await asyncpg.connect(probe_url.set(drivername="postgresql").render_as_string(hide_password=False))
        try:
            user_id, company_id = new_id(), new_id()
            await connection.execute(
                "INSERT INTO users (id,email,full_name,password_hash) "
                "VALUES ($1,'migration@example.tj','Migration Owner','fixture')",
                user_id,
            )
            await connection.execute(
                "INSERT INTO organizations (id,type,name,created_by) VALUES ($1,'COMPANY','Before P03',$2)",
                company_id,
                user_id,
            )
            await connection.execute(
                """INSERT INTO companies (id,legal_name,phone,city,address,tax_identifier,public_code)
                VALUES ($1,'Existing LLC','+992901234567','Dushanbe','Existing address','900123456','ABCDEFGH')""",
                company_id,
            )
        finally:
            await connection.close()
        migrate("0018")
        connection = await asyncpg.connect(probe_url.set(drivername="postgresql").render_as_string(hide_password=False))
        try:
            row = await connection.fetchrow(
                """SELECT s.*, p.code FROM subscriptions s
                JOIN subscription_plans p ON p.id = s.plan_id WHERE s.company_id = $1""",
                company_id,
            )
            assert row is not None and row["status"] == "TRIAL" and row["code"] == "STANDARD"
            assert row["id"].version == 7
            assert await connection.fetchval("SELECT count(*) FROM subscription_status_history") == 1
            assert (
                await connection.fetchval(
                    "SELECT count(*) FROM audit_logs WHERE action = 'subscription.status_changed'"
                )
                == 1
            )
            assert (
                await connection.fetchval(
                    "SELECT count(*) FROM outbox_events WHERE event_type = 'SUBSCRIPTION_STATUS_CHANGED'"
                )
                == 1
            )
            plans = await connection.fetch("SELECT id FROM subscription_plans")
            assert len(plans) == 3 and all(plan["id"].version == 7 for plan in plans)
            assert await connection.fetchval("SELECT to_regprocedure('p03_uuid7()')") is None
        finally:
            await connection.close()
    finally:
        try:
            await admin.execute(f'DROP DATABASE "{database}"')
        finally:
            await admin.close()
