"""P12 §1.3 dashboards and the report entry point used by the API.

A dashboard is a set of independent figures, each gated by the permission that opens the screen it links to: a
member who may not read money receives no money figure at all, rather than a zero (RPT-001, SEC-007).
"""

from datetime import date
from typing import Any

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.modules.delivery.models import OPEN_STATUSES as OPEN_DELIVERY
from app.modules.delivery.models import Delivery, DeliveryRun
from app.modules.finance.domain import FINANCE_TIMEZONE, ZERO
from app.modules.finance.models import Payment
from app.modules.finance.service import finance_service
from app.modules.identity.deps import OrgContext
from app.modules.orders.models import Order
from app.modules.reports import queries
from app.modules.reports.domain import REPORTS, grouping, period, spec
from app.modules.reports.queries import SOLD_STATUSES, ReportRequest
from app.modules.reports.schemas import (
    ColumnOut,
    CompanyDashboardOut,
    DeliveryTodayOut,
    ReportInfoOut,
    ReportOut,
    StoreDashboardOut,
)
from app.modules.returns.models import Dispute

#: An order the store is still waiting for: everything but the three terminal states (P07 §3).
ACTIVE_ORDER_STATUSES = (
    "NEW",
    "VIEWED",
    "CONFIRMED",
    "PARTIALLY_CONFIRMED",
    "ASSEMBLING",
    "READY_FOR_DELIVERY",
    "IN_TRANSIT",
    "DELIVERY_FAILED",
    "DISPUTED",
)
OPEN_DISPUTE_STATUSES = ("OPEN", "UNDER_REVIEW")


def today() -> date:
    """RPT-003: every dashboard figure and report period is a local Dushanbe day."""
    return utcnow().astimezone(FINANCE_TIMEZONE).date()


def available(ctx: OrgContext) -> list[ReportInfoOut]:
    """§5: the reports this member may open, so the screen never offers one that answers 403."""
    return [
        ReportInfoOut(
            code=report.code,
            periodic=report.periodic,
            group_by=list(report.group_by),
            columns=[ColumnOut(key=column.key, kind=column.kind) for column in report.columns],
        )
        for report in REPORTS
        if report.org_type == ctx.organization.type and report.permission in ctx.permissions
    ]


async def report(
    session: AsyncSession,
    ctx: OrgContext,
    code: str,
    date_from: date | None,
    date_to: date | None,
    group_by: str | None,
) -> ReportOut:
    """`GET /reports/{code}`: validate the period (RPT-003), then run the one builder (RPT-005)."""
    report_spec = spec(code)
    queries.authorize(report_spec, ctx)
    grouped = grouping(group_by, report_spec)
    start: date | None = None
    end: date | None = None
    if report_spec.periodic:
        start, end = period(date_from, date_to, today())
    data = await queries.run(session, ctx, report_spec, ReportRequest(start or today(), end or today(), grouped))
    return ReportOut(
        code=code,
        date_from=start,
        date_to=end,
        group_by=grouped,
        columns=[ColumnOut(key=column.key, kind=column.kind) for column in report_spec.columns],
        rows=data.rows,
        totals=data.totals,
    )


async def _count(session: AsyncSession, query: Select[Any]) -> int:
    return int((await session.execute(select(func.count()).select_from(query.subquery()))).scalar_one())


def _deliveries_today(company_id: Any) -> Select[Any]:
    """DEL §2: today's board is the stops of today's runs plus the ones still waiting to be planned."""
    runs = select(DeliveryRun.id).where(
        DeliveryRun.company_id == company_id,
        DeliveryRun.run_date == today(),
        DeliveryRun.status.in_(("DRAFT", "STARTED", "FINISHED")),
    )
    return select(Delivery.id).where(
        Delivery.company_id == company_id,
        or_(Delivery.run_id.in_(runs), Delivery.run_id.is_(None) & Delivery.status.in_(OPEN_DELIVERY)),
    )


async def company_dashboard(session: AsyncSession, ctx: OrgContext) -> CompanyDashboardOut:
    out = CompanyDashboardOut()
    company_id = ctx.organization.id
    if "orders.view" in ctx.permissions:
        out.new_orders = await _count(
            session, select(Order.id).where(Order.company_id == company_id, Order.status.in_(("NEW", "VIEWED")))
        )
    if "delivery.view_all" in ctx.permissions:
        out.deliveries_today = await _count(session, _deliveries_today(company_id))
    if "reports.sales" in ctx.permissions:
        out.sales_this_month = await session.scalar(
            select(func.coalesce(func.sum(Order.total), ZERO)).where(
                Order.company_id == company_id,
                Order.status.in_(SOLD_STATUSES),
                Order.delivered_at.is_not(None),
                queries.local_date(Order.delivered_at).between(today().replace(day=1), today()),
            )
        )
    if "finance.view" in ctx.permissions:
        # RPT-002: receivables come from FinanceService, never from a parallel sum over orders.
        totals = await finance_service.summary(session, ctx)
        out.receivables, out.overdue = totals["outstanding"], totals["overdue"]
    if "stock.view" in ctx.permissions:
        snapshot = await queries.inventory_snapshot(session, ctx, ReportRequest(today(), today()))
        out.low_stock_products = int(snapshot.totals["low_stock_products"])
    if "payments.confirm" in ctx.permissions:
        out.payments_to_confirm = await _count(
            session, select(Payment.id).where(Payment.company_id == company_id, Payment.status == "PENDING")
        )
    if "disputes.view" in ctx.permissions:
        out.open_disputes = await _count(
            session,
            select(Dispute.id).where(Dispute.company_id == company_id, Dispute.status.in_(OPEN_DISPUTE_STATUSES)),
        )
    return out


async def store_dashboard(session: AsyncSession, ctx: OrgContext) -> StoreDashboardOut:
    out = StoreDashboardOut()
    store_id = ctx.organization.id
    if "orders.view" in ctx.permissions:
        out.active_orders = await _count(
            session, select(Order.id).where(Order.store_id == store_id, Order.status.in_(ACTIVE_ORDER_STATUSES))
        )
    if "delivery.view_store" in ctx.permissions:
        rows = (
            await session.execute(
                select(Delivery.id, Delivery.order_id, Order.order_number, Delivery.status)
                .join(Order, Order.id == Delivery.order_id)
                .where(Delivery.store_id == store_id, Delivery.status.in_(OPEN_DELIVERY))
                .order_by(Delivery.created_at)
                .limit(20)
            )
        ).all()
        out.deliveries_today = [
            DeliveryTodayOut(delivery_id=row[0], order_id=row[1], order_number=row[2], status=row[3]) for row in rows
        ]
    if "finance.view" in ctx.permissions:
        totals = await finance_service.summary(session, ctx)
        out.debt, out.overdue = totals["balance"], totals["overdue"]
    return out


async def dashboard(session: AsyncSession, ctx: OrgContext) -> CompanyDashboardOut | StoreDashboardOut:
    """`GET /dashboard`: the figures of the active organization, by its type (§1.3)."""
    if ctx.organization.type == "COMPANY":
        return await company_dashboard(session, ctx)
    return await store_dashboard(session, ctx)
