"""P09 durable reminder cadence and nonrepairing reconciliation on PostgreSQL."""

import asyncio
import os
import subprocess
import sys
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_sessionmaker
from app.core.outbox import OutboxEvent
from app.core.time import utcnow
from app.modules.finance.jobs import reconcile, send_reminders
from app.modules.finance.models import Charge, Credit, DebtReminder, PartnershipBalance, ReconciliationIssue
from app.modules.finance.service import finance_service as finance
from app.modules.organizations.models import Company
from tests.test_delivery import dispatched
from tests.test_finance_service import prepared


async def test_reminder_due_soon_weekly_cadence_and_paid_exclusion(
    client: AsyncClient, session: AsyncSession, monkeypatch
):
    ctx, store, pid = await prepared(client, session)
    now = utcnow()
    monkeypatch.setattr("app.modules.finance.service.utcnow", lambda: now + timedelta(days=1))
    await finance.create_adjustment(session, ctx, pid, "DEBIT", Decimal("100"), "Future due date fixture")
    await session.commit()
    assert await send_reminders(session, now) == 1
    assert await send_reminders(session, now) == 0
    assert await send_reminders(session, now + timedelta(days=1)) == 0
    assert await send_reminders(session, now + timedelta(days=2)) == 1
    assert await send_reminders(session, now + timedelta(days=3)) == 0
    assert await send_reminders(session, now + timedelta(days=9)) == 1
    assert await send_reminders(session, now + timedelta(days=9)) == 0
    rows = list(await session.scalars(select(DebtReminder).order_by(DebtReminder.anchor_date)))
    assert [r.kind for r in rows] == ["DEBT_DUE_SOON", "DEBT_OVERDUE", "DEBT_OVERDUE"]
    events = list(await session.scalars(select(OutboxEvent).where(OutboxEvent.event_type.like("DEBT_%"))))
    assert len(events) == 3 and all(e.org_id == store.id for e in events)
    assert all(e.payload["partnership_id"] == str(pid) and Decimal(e.payload["amount"]) == 100 for e in events)
    monkeypatch.setattr("app.modules.finance.service.utcnow", lambda: now)
    await finance.record_payment(session, ctx, pid, Decimal("100"), "CASH", confirm=True)
    await session.commit()
    assert await send_reminders(session, now + timedelta(days=16)) == 0


async def test_reminder_disabled_partial_amount_and_transaction_rollback(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    now = utcnow()
    await finance.create_adjustment(session, ctx, pid, "DEBIT", Decimal("100"), "Today due amount fixture")
    await finance.record_payment(session, ctx, pid, Decimal("25"), "CASH", confirm=True)
    company = await session.get(Company, ctx.organization.id)
    assert company is not None
    company.debt_reminders_enabled = False
    await session.commit()
    assert await send_reminders(session, now + timedelta(days=1)) == 0
    company.debt_reminders_enabled = True
    await session.commit()
    assert await send_reminders(session, now + timedelta(days=1)) == 1
    await session.rollback()
    assert await session.scalar(select(func.count()).select_from(DebtReminder)) == 0
    assert await send_reminders(session, now + timedelta(days=1)) == 1
    event = await session.scalar(select(OutboxEvent).where(OutboxEvent.event_type == "DEBT_OVERDUE"))
    assert event is not None and Decimal(event.payload["amount"]) == 75


async def test_parallel_reminders_emit_once(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    await finance.create_adjustment(session, ctx, pid, "DEBIT", Decimal("10"), "Reminder concurrency debt")
    await session.commit()
    when = utcnow() + timedelta(days=1)

    async def run():
        async with get_sessionmaker()() as independent, independent.begin():
            return await send_reminders(independent, when)

    assert sorted(await asyncio.gather(run(), run())) == [0, 1]
    assert await session.scalar(select(func.count()).select_from(DebtReminder)) == 1
    assert (
        await session.scalar(
            select(func.count()).select_from(OutboxEvent).where(OutboxEvent.event_type == "DEBT_OVERDUE")
        )
        == 1
    )


async def test_reconciliation_clean_and_missing_projection_not_repaired(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    assert await reconcile(session) == 0
    await finance.create_adjustment(session, ctx, pid, "DEBIT", Decimal("100"), "Reconcile invoice fixture")
    await finance.record_payment(session, ctx, pid, Decimal("20"), "CASH", confirm=True)
    assert await reconcile(session) == 0
    await session.execute(delete(PartnershipBalance).where(PartnershipBalance.partnership_id == pid))
    assert await reconcile(session) == 2
    assert await session.get(PartnershipBalance, pid) is None
    issues = list(await session.scalars(select(ReconciliationIssue)))
    assert {r.check_code for r in issues} == {"BALANCE_LEDGER", "BALANCE_OUTSTANDING"}
    assert all(r.expected == "80.00" and r.actual == "MISSING" for r in issues)


@pytest.mark.parametrize(
    "corruption,expected_code",
    [
        ("balance", "BALANCE_LEDGER"),
        ("charge_allocation", "CHARGE_ALLOCATION:"),
        ("credit_allocation", "CREDIT_ALLOCATION:"),
        ("payment_credit", "PAYMENT_CREDIT:"),
        ("payment_ledger", "PAYMENT_LEDGER:"),
    ],
)
async def test_reconciliation_detects_corruption_without_repair(
    client: AsyncClient, session: AsyncSession, corruption, expected_code
):
    ctx, _, pid = await prepared(client, session)
    await finance.create_adjustment(session, ctx, pid, "DEBIT", Decimal("100"), "Reconcile invoice fixture")
    payment = await finance.record_payment(session, ctx, pid, Decimal("20"), "CASH", confirm=True)
    charge = (await session.scalars(select(Charge))).one()
    credit = (await session.scalars(select(Credit))).one()
    await session.commit()
    # This disposable-database corruption fixture deliberately bypasses guards
    # that otherwise make missing immutable records impossible via the API.
    await session.execute(text("SET LOCAL session_replication_role = 'replica'"))
    statements = {
        "balance": ("UPDATE partnership_balances SET balance = 81 WHERE partnership_id = :id", pid),
        "charge_allocation": ("UPDATE charges SET allocated_amount = 21 WHERE id = :id", charge.id),
        "credit_allocation": ("UPDATE credits SET allocated_amount = 19 WHERE id = :id", credit.id),
        "payment_credit": ("DELETE FROM credits WHERE source_id = :id", payment.id),
        "payment_ledger": ("DELETE FROM ledger_entries WHERE source_id = :id", payment.id),
    }
    sql, key = statements[corruption]
    await session.execute(text(sql), {"id": key})
    await session.commit()  # restore triggers before running the production job
    snapshot_sql = text("""
        SELECT (SELECT jsonb_agg(to_jsonb(t)) FROM partnership_balances t),
               (SELECT jsonb_agg(to_jsonb(t)) FROM charges t),
               (SELECT jsonb_agg(to_jsonb(t)) FROM credits t),
               (SELECT jsonb_agg(to_jsonb(t)) FROM ledger_entries t),
               (SELECT jsonb_agg(to_jsonb(t)) FROM allocations t)
    """)
    before = (await session.execute(snapshot_sql)).one()
    count = await reconcile(session)
    assert count >= 1
    assert (await session.execute(snapshot_sql)).one() == before
    issues = list(await session.scalars(select(ReconciliationIssue)))
    assert any(r.check_code.startswith(expected_code) for r in issues)
    assert all(r.resolved_at is None for r in issues)
    events = list(
        await session.scalars(select(OutboxEvent).where(OutboxEvent.event_type == "FINANCE_RECONCILIATION_MISMATCH"))
    )
    assert len(issues) == len(events) == count
    assert all(e.org_id == ctx.organization.id for e in events)


async def test_reconciliation_missing_delivered_order_charge(client: AsyncClient, session: AsyncSession):
    _, _, order, _, _ = await dispatched(client, session)
    await session.execute(text("SET LOCAL session_replication_role = 'replica'"))
    await session.execute(text("UPDATE orders SET status = 'DELIVERED' WHERE id = :id"), {"id": order["id"]})
    await session.commit()
    assert await reconcile(session) == 1
    issue = (await session.scalars(select(ReconciliationIssue))).one()
    assert issue.check_code == f"ORDER_CHARGE:{order['id']}"
    assert await session.scalar(select(func.count()).select_from(Charge)) == 0


async def test_standalone_worker_wiring_schedule_and_sentry(client: AsyncClient, session: AsyncSession):
    _, _, pid = await prepared(client, session)
    await session.execute(delete(PartnershipBalance).where(PartnershipBalance.partnership_id == pid))
    await session.commit()
    script = """
from app.celery_app import _runner, celery_app, finance_reminders, finance_reconciliation
from app.core.db import get_engine
from app.core import monitoring
from app.modules.orders import ports
from app.modules.finance.ports import FinanceCredit
assert isinstance(ports.credit, FinanceCredit)
schedule = celery_app.conf.beat_schedule
assert schedule['finance-reminders']['schedule'].hour == {4}
assert schedule['finance-reminders']['schedule'].minute == {0}
assert schedule['finance-reconciliation']['schedule'].hour == {22}
assert schedule['finance-reconciliation']['schedule'].minute == {30}
reports = []
configured = []
monitoring.configure_monitoring = lambda: configured.append(True)
monitoring.report_bug = reports.append
assert finance_reminders() == 0
assert finance_reconciliation() == 2
assert configured == [True]
assert reports == ['FINANCE_RECONCILIATION_MISMATCH']
_runner().run(get_engine().dispose())
_runner().close()
print('standalone finance worker passed')
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parent.parent,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert "standalone finance worker passed" in result.stdout
