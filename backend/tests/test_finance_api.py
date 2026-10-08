"""P09 HTTP contracts, tenant isolation, replay authorization and offline cash."""

import asyncio
from datetime import datetime, time, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.modules.delivery.models import CourierSyncOperation
from app.modules.finance import domain
from app.modules.finance.models import Allocation, Payment, ReconciliationIssue
from app.modules.finance.service import finance_service as finance
from tests.factories import add_member, auth, make_org, make_user
from tests.test_delivery import dispatched, operation, sync
from tests.test_finance_service import member, prepared


def headers(ctx, key=None):
    return {**auth(ctx.user, ctx.organization), "Idempotency-Key": str(key or uuid4())}


async def debt(client, ctx, pid, amount):
    response = await client.post(
        "/api/v1/adjustments",
        headers=headers(ctx),
        json={"partnership_id": str(pid), "type": "DEBIT", "amount": amount, "reason": "Correct invoice amount"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def body(pid, amount="1200", **kwargs):
    return {"partnership_id": str(pid), "amount": amount, "method": "CASH", **kwargs}


async def test_fifo_preview_payment_confirmation_and_statements(client: AsyncClient, session: AsyncSession):
    ctx, store, pid = await prepared(client, session)
    for amount in ["1000", "700", "500"]:
        await debt(client, ctx, pid, amount)
    h = auth(ctx.user, ctx.organization)
    path = f"/api/v1/finance/partnerships/{pid}"
    preview = await client.get(path + "/allocation-preview", headers=h, params={"amount": "1200"})
    assert preview.status_code == 200, preview.text
    assert [Decimal(r["amount"]) for r in preview.json()["lines"]] == [1000, 200]
    assert await session.scalar(select(func.count()).select_from(Allocation)) == 0
    await session.commit()
    recorded = await client.post("/api/v1/payments", headers=headers(ctx), json=body(pid))
    assert recorded.status_code == 201, recorded.text
    payment = recorded.json()
    assert payment["status"] == "PENDING" and payment["allocations"] == []
    confirm_headers = headers(ctx)
    url = f"/api/v1/payments/{payment['id']}/confirm"
    confirmed = await client.post(url, headers=confirm_headers, json={"version": payment["version"]})
    assert confirmed.status_code == 200, confirmed.text
    replay = await client.post(url, headers=confirm_headers, json={"version": payment["version"]})
    assert replay.json() == confirmed.json()
    assert [Decimal(r["amount"]) for r in confirmed.json()["allocations"]] == [1000, 200]
    detail = await client.get(f"/api/v1/payments/{payment['id']}", headers=h)
    assert detail.json() == confirmed.json()
    for org in [ctx.organization, store]:
        # The fixture owner owns both organizations.
        summary = await client.get("/api/v1/finance/summary", headers=auth(ctx.user, org))
        assert summary.status_code == 200, summary.text
        assert Decimal(summary.json()["balance"]) == 1000
        partners = await client.get("/api/v1/finance/partnerships", headers=auth(ctx.user, org))
        assert partners.status_code == 200, partners.text
        assert partners.json()["count"] == 1
        assert Decimal(partners.json()["results"][0]["outstanding"]) == 1000
    statement = await client.get(path + "/statement", headers=h)
    assert statement.status_code == 200, statement.text
    assert Decimal(statement.json()["opening_balance"]) == 0
    assert Decimal(statement.json()["closing_balance"]) == 1000
    assert len(statement.json()["entries"]) == 4
    charges = await client.get(path + "/charges", headers=h, params={"status": "PAID"})
    assert charges.json()["count"] == 1
    charge = await client.get("/api/v1/finance/charges/" + charges.json()["results"][0]["id"], headers=h)
    assert len(charge.json()["allocations"]) == 1


async def test_record_replay_payload_tenant_and_permission_binding(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    h = headers(ctx)
    payload = body(pid, confirm=True)
    first = await client.post("/api/v1/payments", headers=h, json=payload)
    assert first.status_code == 201, first.text
    replay = await client.post("/api/v1/payments", headers=h, json=payload)
    assert first.json() == replay.json()
    changed = await client.post("/api/v1/payments", headers=h, json=body(pid, "1300", confirm=True))
    assert changed.status_code == 409
    other = await make_org(session, ctx.user)
    await session.commit()
    switched = await client.post("/api/v1/payments", headers={**h, "X-Org-Id": str(other.id)}, json=payload)
    assert switched.status_code == 409
    ctx.membership.role = "OPERATOR"
    await session.commit()
    denied = await client.post("/api/v1/payments", headers=h, json=payload)
    assert denied.status_code == 403
    ctx.membership.status = "REVOKED"
    await session.commit()
    denied = await client.post("/api/v1/payments", headers=h, json=payload)
    assert denied.status_code == 403
    assert await session.scalar(select(func.count()).select_from(Payment)) == 1


@pytest.mark.parametrize(
    "role,can_view,can_record,can_confirm",
    [
        ("OWNER", True, True, True),
        ("MANAGER", True, True, True),
        ("OPERATOR", True, True, False),
        ("WAREHOUSE", False, False, False),
        ("COURIER", False, True, False),
    ],
)
async def test_company_http_permissions(
    client: AsyncClient, session: AsyncSession, role, can_view, can_record, can_confirm
):
    owner, _, pid = await prepared(client, session)
    ctx = owner if role == "OWNER" else await member(session, owner, role)
    response = await client.get("/api/v1/finance/summary", headers=auth(ctx.user, ctx.organization))
    assert response.status_code == (200 if can_view else 403)
    response = await client.post("/api/v1/payments", headers=headers(ctx), json=body(pid, confirm=True))
    assert response.status_code == (201 if can_confirm else 403), response.text
    response = await client.post("/api/v1/payments", headers=headers(ctx), json=body(pid))
    # Courier recording additionally requires an assigned delivery.
    assert response.status_code == (201 if can_record and role != "COURIER" else 403), response.text


async def test_tenant_scoped_reads_and_query_validation(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    await debt(client, ctx, pid, "100")
    payment = await client.post("/api/v1/payments", headers=headers(ctx), json=body(pid, "10"))
    assert payment.status_code == 201, payment.text
    user = await make_user(session)
    other = await make_org(session, user)
    await session.commit()
    h = auth(user, other)
    for suffix in ["", "/charges", "/statement", "/allocation-preview?amount=10"]:
        response = await client.get(f"/api/v1/finance/partnerships/{pid}{suffix}", headers=h)
        assert response.status_code == 404, response.text
    assert (await client.get(f"/api/v1/payments/{payment.json()['id']}", headers=h)).status_code == 404
    for path in ["payments", "adjustments", "finance/partnerships"]:
        response = await client.get("/api/v1/" + path, headers=h)
        assert response.status_code == 200, response.text
        assert response.json()["count"] == 0
    h = auth(ctx.user, ctx.organization)
    for query in ["bogus=1", "limit=0", "date_from=2026-10-09&date_to=2026-10-08", "status=BAD"]:
        assert (await client.get("/api/v1/payments?" + query, headers=h)).status_code == 422
    response = await client.get("/api/v1/payments?status=PENDING&method=CASH&limit=1&offset=1", headers=h)
    assert response.json()["count"] == 1 and response.json()["results"] == []
    response = await client.get("/api/v1/payments?date_to=9999-12-31", headers=h)
    assert response.status_code == 200


async def test_offline_cash_replay_validation_and_log_privacy(client: AsyncClient, session: AsyncSession):
    ctx, _, _, delivery, courier = await dispatched(client, session)
    good = operation("PAYMENT_RECORD", delivery.id, payload={"amount": "25.50", "note": "Collected cash"})
    bad = operation("PAYMENT_RECORD", delivery.id, payload={"amount": "10", "confirm": True})
    nested = operation(
        "PAYMENT_RECORD", delivery.id, payload={"amount": {"code": "SECRET"}, "note": {"code": "SECRET"}}
    )
    results = await sync(client, courier, ctx.organization, [good, bad, nested])
    assert results[good["operation_id"]]["result_status"] == "APPLIED"
    payment_id = results[good["operation_id"]]["payment_id"]
    assert payment_id is not None
    assert results[bad["operation_id"]]["result_status"] == "REJECTED"
    assert results[nested["operation_id"]]["result_status"] == "REJECTED"
    replay = await sync(client, courier, ctx.organization, [good])
    assert replay[good["operation_id"]]["payment_id"] == payment_id
    payment = await session.get(Payment, UUID(payment_id))
    assert payment is not None and payment.status == "PENDING" and payment.amount == Decimal("25.50")
    assert await session.scalar(select(func.count()).select_from(Payment)) == 1
    log = await session.get(CourierSyncOperation, UUID(nested["operation_id"]))
    assert log is not None and "SECRET" not in str(log.payload)


async def test_same_key_concurrency_posts_once(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    h = headers(ctx)
    payload = body(pid, "10", confirm=True)
    responses = await asyncio.gather(*[client.post("/api/v1/payments", headers=h, json=payload) for _ in range(2)])
    assert all(r.status_code in {201, 409} for r in responses)
    assert any(r.status_code == 201 for r in responses)
    retry = await client.post("/api/v1/payments", headers=h, json=payload)
    assert retry.status_code == 201
    assert all(r.json() == retry.json() for r in responses if r.status_code == 201)
    assert await session.scalar(select(func.count()).select_from(Payment)) == 1


@pytest.mark.parametrize("role", ["OWNER", "SELLER"])
async def test_store_permissions_and_company_confirmation(client: AsyncClient, session: AsyncSession, role):
    company, store, pid = await prepared(client, session)
    user = company.user if role == "OWNER" else await make_user(session)
    if role == "SELLER":
        await add_member(session, store, user, role)
    await session.commit()
    h = {**auth(user, store), "Idempotency-Key": str(uuid4())}
    summary = await client.get("/api/v1/finance/summary", headers=h)
    assert summary.status_code == (200 if role == "OWNER" else 403)
    assert (await client.get("/api/v1/adjustments", headers=h)).status_code == 403
    recorded = await client.post("/api/v1/payments", headers=h, json=body(pid, "20"))
    assert recorded.status_code == (201 if role == "OWNER" else 403), recorded.text
    if role == "OWNER":
        payment = recorded.json()
        url = f"/api/v1/payments/{payment['id']}/confirm"
        assert (await client.post(url, headers=h, json={"version": payment["version"]})).status_code == 403
        confirmed = await client.post(url, headers=headers(company), json={"version": payment["version"]})
        assert confirmed.status_code == 200, confirmed.text


async def test_statement_uses_dushanbe_midnight_and_inclusive_end(
    client: AsyncClient, session: AsyncSession, monkeypatch
):
    ctx, _, pid = await prepared(client, session)
    today = domain.local_date(utcnow())
    start = datetime.combine(today, time.min, tzinfo=domain.FINANCE_TIMEZONE)
    monkeypatch.setattr("app.modules.finance.service.utcnow", lambda: start - timedelta(seconds=1))
    await finance.create_adjustment(session, ctx, pid, "DEBIT", Decimal("100"), "Prior day opening debt")
    monkeypatch.setattr("app.modules.finance.service.utcnow", lambda: start)
    await finance.record_payment(session, ctx, pid, Decimal("20"), "CASH", confirm=True)
    monkeypatch.setattr("app.modules.finance.service.utcnow", lambda: start + timedelta(days=1))
    await finance.record_payment(session, ctx, pid, Decimal("30"), "CASH", confirm=True)
    await session.commit()
    response = await client.get(
        f"/api/v1/finance/partnerships/{pid}/statement",
        headers=auth(ctx.user, ctx.organization),
        params={"date_from": today.isoformat(), "date_to": today.isoformat()},
    )
    assert response.status_code == 200, response.text
    assert Decimal(response.json()["opening_balance"]) == 100
    assert Decimal(response.json()["closing_balance"]) == 80
    assert len(response.json()["entries"]) == 1


@pytest.mark.parametrize("action", ["reject", "cancel"])
async def test_pending_payment_terminal_commands(client: AsyncClient, session: AsyncSession, action):
    ctx, _, pid = await prepared(client, session)
    operator = await member(session, ctx, "OPERATOR")
    recorded = await client.post("/api/v1/payments", headers=headers(operator), json=body(pid, "10"))
    assert recorded.status_code == 201, recorded.text
    payment = recorded.json()
    payload = {"version": payment["version"]}
    if action == "reject":
        payload["reason"] = "Incorrect reported amount"
    actor = ctx if action == "reject" else operator
    h = headers(actor)
    url = f"/api/v1/payments/{payment['id']}/{action}"
    result = await client.post(url, headers=h, json=payload)
    assert result.status_code == 200, result.text
    assert result.json()["status"] == ("REJECTED" if action == "reject" else "CANCELLED")
    assert len(result.json()["history"]) == 2
    assert (await client.post(url, headers=h, json=payload)).json() == result.json()
    assert (await client.post(url, headers=headers(actor), json=payload)).status_code == 409
    summary = await client.get("/api/v1/finance/summary", headers=auth(ctx.user, ctx.organization))
    assert Decimal(summary.json()["balance"]) == 0


@pytest.mark.parametrize("action", ["approve", "reject"])
async def test_manager_adjustment_owner_decision(client: AsyncClient, session: AsyncSession, action):
    ctx, store, pid = await prepared(client, session)
    manager = await member(session, ctx, "MANAGER")
    adjustment = await debt(client, manager, pid, "50")
    assert adjustment["status"] == "PENDING_APPROVAL"
    assert (await client.get("/api/v1/adjustments", headers=auth(ctx.user, store))).status_code == 403
    url = f"/api/v1/adjustments/{adjustment['id']}/{action}"
    payload = {"version": adjustment["version"]}
    if action == "reject":
        payload["reason"] = "Invoice already correct"
    assert (await client.post(url, headers=headers(manager), json=payload)).status_code == 403
    h = headers(ctx)
    result = await client.post(url, headers=h, json=payload)
    assert result.status_code == 200, result.text
    assert result.json()["status"] == ("APPROVED" if action == "approve" else "REJECTED")
    assert (await client.post(url, headers=h, json=payload)).json() == result.json()
    summary = await client.get("/api/v1/finance/summary", headers=auth(ctx.user, ctx.organization))
    assert Decimal(summary.json()["balance"]) == (50 if action == "approve" else 0)


async def test_summary_aging_matches_details_and_overdue_filters(
    client: AsyncClient, session: AsyncSession, monkeypatch
):
    ctx, _, pid = await prepared(client, session)
    now = utcnow()
    for days, amount in [(0, "10"), (30, "20"), (31, "30"), (61, "40"), (91, "50")]:
        monkeypatch.setattr("app.modules.finance.service.utcnow", lambda days=days: now - timedelta(days=days))
        await finance.create_adjustment(session, ctx, pid, "DEBIT", Decimal(amount), "Historical aging fixture")
    monkeypatch.setattr("app.modules.finance.service.utcnow", lambda: now)
    await session.commit()
    h = auth(ctx.user, ctx.organization)
    detail = await client.get(f"/api/v1/finance/partnerships/{pid}", headers=h)
    summary = await client.get("/api/v1/finance/summary", headers=h)
    assert summary.status_code == detail.status_code == 200
    assert summary.json()["aging"] == detail.json()["aging"]
    assert {k: Decimal(v) for k, v in summary.json()["aging"].items()} == {
        "current": 10,
        "1-30": 20,
        "31-60": 30,
        "61-90": 40,
        "90+": 50,
    }
    assert Decimal(summary.json()["overdue"]) == 140
    rows = await client.get("/api/v1/finance/partnerships?overdue=true&ordering=-overdue", headers=h)
    assert rows.status_code == 200, rows.text
    assert rows.json()["count"] == 1
    assert (await client.get("/api/v1/finance/partnerships?overdue=false", headers=h)).json()["count"] == 0
    charges = await client.get(f"/api/v1/finance/partnerships/{pid}/charges?overdue=true", headers=h)
    assert charges.json()["count"] == 4


async def test_reconciliation_resolution_is_superadmin_only(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    issue = ReconciliationIssue(
        partnership_id=pid, check_code="BALANCE", expected="0", actual="1", detected_at=utcnow()
    )
    session.add(issue)
    admin = await make_user(session, is_superadmin=True)
    await session.commit()
    path = "/api/v1/admin/reconciliation-issues"
    assert (await client.get(path, headers=auth(ctx.user))).status_code == 403
    h = auth(admin)
    response = await client.get(path + "?resolved=false", headers=h)
    assert response.status_code == 200, response.text
    assert response.json()["count"] == 1
    response = await client.post(f"{path}/{issue.id}/resolve", headers=h, json={"note": "Reviewed discrepancy"})
    assert response.status_code == 200, response.text
    assert response.json()["resolved_by"] == str(admin.id)
    assert (await client.get(path + "?resolved=false", headers=h)).json()["count"] == 0
    assert (
        await client.post(f"{path}/{issue.id}/resolve", headers=h, json={"note": "Reviewed twice"})
    ).status_code == 409
