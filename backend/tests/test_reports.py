"""P12 §1 reports and dashboards: scope, period rules, and the numbers themselves."""

from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.modules.finance.service import finance_service
from app.modules.identity.deps import OrgContext
from app.modules.identity.models import Membership
from app.modules.orders.models import Order
from app.modules.reports import queries, service
from app.modules.reports.domain import BY_CODE, MAX_RANGE_DAYS
from app.modules.reports.queries import ReportRequest
from tests.factories import auth, make_org, make_user
from tests.test_returns_service import delivered, member


def plain(ctx: OrgContext) -> dict[str, str]:
    return auth(ctx.user, ctx.organization)


def window() -> dict[str, str]:
    today = service.today()
    return {"date_from": (today - timedelta(days=7)).isoformat(), "date_to": today.isoformat()}


async def test_sales_summary_matches_the_delivered_order(client: AsyncClient, session: AsyncSession):
    ctx, _store_ctx, order, _item = await delivered(client, session)
    await session.commit()

    answer = await client.get("/api/v1/reports/sales_summary", headers=plain(ctx), params=window())
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert [column["key"] for column in body["columns"]] == [
        "period",
        "orders",
        "total",
        "discount",
        "delivery_fee",
    ]
    assert len(body["rows"]) == 1
    row = body["rows"][0]
    assert row["period"] == service.today().isoformat()
    assert row["orders"] == 1 and Decimal(row["total"]) == order.total
    assert Decimal(body["totals"]["total"]) == order.total


async def test_sales_summary_excludes_cancelled_and_undelivered(client: AsyncClient, session: AsyncSession):
    """RPT §1.2: only an order that was handed over is a sale."""
    ctx, _store_ctx, order, _item = await delivered(client, session)
    order.status = "CANCELLED"
    order.delivered_at = None
    await session.commit()

    answer = await client.get("/api/v1/reports/sales_summary", headers=plain(ctx), params=window())
    assert answer.status_code == 200, answer.text
    assert answer.json()["rows"] == []
    funnel = await client.get("/api/v1/reports/order_funnel", headers=plain(ctx), params=window())
    assert funnel.status_code == 200, funnel.text
    assert funnel.json()["rows"] == [{"status": "CANCELLED", "orders": 1, "share": "100.00"}]
    assert funnel.json()["totals"]["cancelled_share"] == "100.00"


async def test_rpt_001_scope_isolation(client: AsyncClient, session: AsyncSession):
    """Every report is scoped to the active organization, and the other side's reports do not exist."""
    ctx, store_ctx, _order, _item = await delivered(client, session)
    stranger = await make_user(session)
    other = await make_org(session, stranger, "COMPANY", name="Other")
    membership = (await session.scalars(select(Membership).where(Membership.organization_id == other.id))).one()
    await session.commit()

    for code in ("sales_summary", "sales_by_store", "sales_by_product", "receivables_aging"):
        answer = await client.get(f"/api/v1/reports/{code}", headers=auth(stranger, other), params=window())
        assert answer.status_code == 200, answer.text
        assert answer.json()["rows"] == [], code
    # A company asking for a store report, and a store asking for a company report, both get 404 (SEC-007).
    assert (await client.get("/api/v1/reports/purchases", headers=plain(ctx), params=window())).status_code == 404
    assert (
        await client.get("/api/v1/reports/sales_summary", headers=plain(store_ctx), params=window())
    ).status_code == 404
    assert (await client.get("/api/v1/reports/nothing", headers=plain(ctx))).status_code == 404
    assert OrgContext(stranger, membership, other).organization.id == other.id


async def test_rpt_002_financial_numbers_match_finance_service(client: AsyncClient, session: AsyncSession):
    """The aging report and the debt report read FinanceService, so they cannot drift from the ledger."""
    ctx, store_ctx, _order, _item = await delivered(client, session)
    await session.commit()

    summary = await finance_service.summary(session, ctx)
    aging = await client.get("/api/v1/reports/receivables_aging", headers=plain(ctx))
    assert aging.status_code == 200, aging.text
    totals = aging.json()["totals"]
    assert Decimal(totals["outstanding"]) == summary["outstanding"]
    assert Decimal(totals["current"]) == summary["aging"]["current"]

    store_summary = await finance_service.summary(session, store_ctx)
    debt = await client.get("/api/v1/reports/store_debt", headers=plain(store_ctx))
    assert debt.status_code == 200, debt.text
    assert Decimal(debt.json()["totals"]["balance"]) == store_summary["balance"]
    assert Decimal(debt.json()["rows"][0]["outstanding"]) == store_summary["outstanding"]


async def test_receivables_aging_buckets(client: AsyncClient, session: AsyncSession):
    """A charge that fell due 45 days ago belongs to 31-60 and to nothing else."""
    ctx, _store_ctx, order, _item = await delivered(client, session)
    from app.modules.finance.models import Charge

    existing = (await session.scalars(select(Charge).where(Charge.company_id == ctx.organization.id))).one()
    # FIN-005: a posted charge is immutable, so the overdue case is a second charge, posted as overdue.
    overdue = Charge(
        partnership_id=order.partnership_id,
        company_id=order.company_id,
        store_id=order.store_id,
        kind="ADJUSTMENT",
        source_id=uuid4(),
        amount=Decimal("40.00"),
        currency="TJS",
        due_date=service.today() - timedelta(days=45),
    )
    session.add(overdue)
    await session.commit()

    answer = await client.get("/api/v1/reports/receivables_aging", headers=plain(ctx))
    assert answer.status_code == 200, answer.text
    row = answer.json()["rows"][0]
    assert Decimal(row["31-60"]) == overdue.amount
    assert Decimal(row["current"]) == existing.amount - existing.allocated_amount
    assert all(Decimal(row[bucket]) == 0 for bucket in ("1-30", "61-90", "90+"))
    assert Decimal(row["outstanding"]) == Decimal(row["current"]) + overdue.amount


async def test_rpt_003_range_limit(client: AsyncClient, session: AsyncSession):
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    await session.commit()
    today = service.today()

    too_wide = await client.get(
        "/api/v1/reports/sales_summary",
        headers=plain(ctx),
        params={"date_from": (today - timedelta(days=MAX_RANGE_DAYS)).isoformat(), "date_to": today.isoformat()},
    )
    assert too_wide.status_code == 422, too_wide.text
    assert too_wide.json()["error"]["code"] == "report_range_too_large"

    widest = await client.get(
        "/api/v1/reports/sales_summary",
        headers=plain(ctx),
        params={"date_from": (today - timedelta(days=MAX_RANGE_DAYS - 1)).isoformat(), "date_to": today.isoformat()},
    )
    assert widest.status_code == 200, widest.text
    inverted = await client.get(
        "/api/v1/reports/sales_summary",
        headers=plain(ctx),
        params={"date_from": today.isoformat(), "date_to": (today - timedelta(days=1)).isoformat()},
    )
    assert inverted.status_code == 422 and inverted.json()["error"]["code"] == "validation_error"


async def test_rpt_003_snapshot_reports_need_no_period(client: AsyncClient, session: AsyncSession):
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    await session.commit()
    answer = await client.get("/api/v1/reports/inventory_snapshot", headers=plain(ctx))
    assert answer.status_code == 200, answer.text
    assert answer.json()["date_from"] is None and answer.json()["group_by"] is None


async def test_rpt_005_api_equals_export(client: AsyncClient, session: AsyncSession):
    """One query builder: the rows the API answers are the rows the export writes."""
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    await session.commit()
    today = service.today()

    api = await client.get("/api/v1/reports/sales_by_product", headers=plain(ctx), params=window())
    assert api.status_code == 200, api.text
    data = await queries.run(
        session,
        ctx,
        BY_CODE["sales_by_product"],
        ReportRequest(today - timedelta(days=7), today),
    )
    assert [{key: str(value) for key, value in row.items()} for row in data.rows] == [
        {key: str(value) for key, value in row.items()} for row in api.json()["rows"]
    ]


async def test_group_by_is_a_closed_list(client: AsyncClient, session: AsyncSession):
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    await session.commit()
    monthly = await client.get(
        "/api/v1/reports/sales_summary", headers=plain(ctx), params={**window(), "group_by": "month"}
    )
    assert monthly.status_code == 200, monthly.text
    assert monthly.json()["rows"][0]["period"] == service.today().replace(day=1).isoformat()
    bad = await client.get("/api/v1/reports/sales_summary", headers=plain(ctx), params={**window(), "group_by": "year"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "validation_error"
    ungrouped = await client.get("/api/v1/reports/receivables_aging", headers=plain(ctx), params={"group_by": "day"})
    assert ungrouped.status_code == 422


async def test_reports_require_their_own_permission(client: AsyncClient, session: AsyncSession):
    """§1.2: an operator works the funnel; the money and stock reports are not theirs."""
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    operator = await member(session, ctx, "OPERATOR")
    warehouse = await member(session, ctx, "WAREHOUSE")

    assert (
        await client.get("/api/v1/reports/order_funnel", headers=plain(operator), params=window())
    ).status_code == 200
    for code in ("sales_summary", "receivables_aging", "inventory_snapshot"):
        answer = await client.get(f"/api/v1/reports/{code}", headers=plain(operator), params=window())
        assert answer.status_code == 403, code
        assert answer.json()["error"]["code"] == "permission_denied"
    assert (await client.get("/api/v1/reports/inventory_snapshot", headers=plain(warehouse))).status_code == 200
    assert (
        await client.get("/api/v1/reports/sales_summary", headers=plain(warehouse), params=window())
    ).status_code == 403

    listed = await client.get("/api/v1/reports", headers=plain(operator))
    assert listed.status_code == 200
    assert [entry["code"] for entry in listed.json()] == ["order_funnel"]


async def test_dashboard_only_carries_figures_the_member_may_read(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, _item = await delivered(client, session)
    operator = await member(session, ctx, "OPERATOR")

    company = await client.get("/api/v1/dashboard", headers=plain(ctx))
    assert company.status_code == 200, company.text
    body = company.json()
    assert body["type"] == "COMPANY"
    assert body["new_orders"] == 0 and body["open_disputes"] == 0
    assert Decimal(body["sales_this_month"]) == order.total
    assert body["receivables"] is not None and body["low_stock_products"] is not None

    limited = await client.get("/api/v1/dashboard", headers=plain(operator))
    assert limited.status_code == 200, limited.text
    assert limited.json()["sales_this_month"] is None
    assert limited.json()["payments_to_confirm"] is None
    assert limited.json()["new_orders"] == 0

    store = await client.get("/api/v1/dashboard", headers=plain(store_ctx))
    assert store.status_code == 200, store.text
    assert store.json()["type"] == "STORE"
    assert Decimal(store.json()["debt"]) == order.total
    assert store.json()["active_orders"] == 0


async def test_delivery_and_returns_reports_read_their_own_facts(client: AsyncClient, session: AsyncSession):
    ctx, _store_ctx, order, _item = await delivered(client, session)
    await session.commit()

    delivery = await client.get("/api/v1/reports/delivery_performance", headers=plain(ctx), params=window())
    assert delivery.status_code == 200, delivery.text
    rows = delivery.json()["rows"]
    assert len(rows) == 1 and rows[0]["delivered"] == 1 and rows[0]["failed"] == 0
    # The fixture hands over with a manual override, so every delivered stop of this courier was overridden.
    assert rows[0]["manual_override_share"] == "100.00"

    movements = await client.get("/api/v1/reports/inventory_movements", headers=plain(ctx), params=window())
    assert movements.status_code == 200, movements.text
    assert {row["type"] for row in movements.json()["rows"]} >= {"RECEIPT", "SHIP"}

    purchases_params = {**window(), "group_by": "month"}
    stored = await session.get(Order, order.id)
    assert stored is not None
    store_membership = (
        await session.scalars(select(Membership).where(Membership.organization_id == order.store_id))
    ).one()
    purchases = await client.get(
        "/api/v1/reports/purchases",
        headers=auth(store_membership.user, store_membership.organization),
        params=purchases_params,
    )
    assert purchases.status_code == 200, purchases.text
    assert Decimal(purchases.json()["rows"][0]["total"]) == order.total


async def test_period_default_is_the_last_thirty_days(client: AsyncClient, session: AsyncSession):
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    await session.commit()
    answer = await client.get("/api/v1/reports/sales_summary", headers=plain(ctx))
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["date_to"] == service.today().isoformat()
    assert body["date_from"] == (service.today() - timedelta(days=29)).isoformat()


async def test_unknown_report_code_is_not_found(session: AsyncSession):
    with pytest.raises(AppError) as error:
        from app.modules.reports.domain import spec

        spec("sales_of_everything")
    assert error.value.code == "not_found" and error.value.http_status == 404


async def test_rpt_004_reports_are_served_by_indexes(session: AsyncSession):
    """RPT-004: a report answers inside the request, which it can only do on indexed columns."""
    from sqlalchemy import text

    rows = await session.scalars(text("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"))
    present = set(rows)
    assert {
        "ix_orders_company_status_created",
        "ix_orders_store_created",
        "ix_payments_company_status_created",
        "ix_deliveries_company_status",
        "ix_charges_partnership_status_due_created",
        "ix_stock_movements_company_created",
        "ix_exports_organization_created",
    } <= present
