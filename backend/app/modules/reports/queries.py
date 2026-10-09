"""P12 §1.2 report query builders: one builder per report, used by the API and by the export writer (RPT-005).

Every builder is scoped to the active organization (RPT-001) and reads local `Asia/Dushanbe` dates (RPT-003).
The receivables and debt reports take their numbers from `FinanceService` only (RPT-002).
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import Date, Numeric, Select, case, cast, func, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.modules.catalog.models import Product
from app.modules.delivery.models import Delivery
from app.modules.finance.domain import FINANCE_TIMEZONE, ZERO
from app.modules.finance.models import CreditNote, Payment
from app.modules.finance.service import finance_service
from app.modules.identity.deps import OrgContext
from app.modules.identity.models import User
from app.modules.inventory.models import Stock, StockMovement
from app.modules.orders.models import Order, OrderItem
from app.modules.organizations.models import Company, Store
from app.modules.partnerships.models import Partnership
from app.modules.reports.domain import REPORTS, GroupBy, ReportSpec, share
from app.modules.returns.models import Return, ReturnItem

#: An order counts as sold once it has been handed over; the later states keep that fact (P07 §3).
SOLD_STATUSES = ("DELIVERED", "DISPUTED", "COMPLETED")
MONEY = Numeric(12, 2)
QUANTITY = Numeric(14, 3)
ZERO_QUANTITY = Decimal("0.000")


@dataclass(frozen=True)
class ReportRequest:
    date_from: date
    date_to: date
    group_by: GroupBy | None = None


@dataclass
class ReportData:
    rows: list[dict[str, Any]]
    totals: dict[str, Any] = field(default_factory=dict)


def local_date(column: Any) -> Any:
    """RPT-003: the local calendar day of a UTC timestamp."""
    return cast(func.timezone(str(FINANCE_TIMEZONE), column), Date)


def _bucket(column: Any, group_by: GroupBy | None) -> Any:
    return cast(func.date_trunc(group_by or "day", func.timezone(str(FINANCE_TIMEZONE), column)), Date)


def _money(expression: Any) -> Any:
    return cast(func.coalesce(func.sum(expression), ZERO), MONEY)


def _quantity(expression: Any) -> Any:
    return cast(func.coalesce(func.sum(expression), ZERO_QUANTITY), QUANTITY)


def _sold(request: ReportRequest) -> tuple[Any, ...]:
    return (
        Order.status.in_(SOLD_STATUSES),
        Order.delivered_at.is_not(None),
        local_date(Order.delivered_at).between(request.date_from, request.date_to),
    )


async def _rows(session: AsyncSession, query: Select[Any]) -> list[dict[str, Any]]:
    return [dict(row) for row in (await session.execute(query)).mappings()]


#: The registry already says what each column is, so a total keeps its column's type even on an empty report.
COLUMN_KINDS = {column.key: column.kind for report in REPORTS for column in report.columns}


def _sum_totals(rows: list[dict[str, Any]], keys: tuple[str, ...]) -> dict[str, Any]:
    totals: dict[str, Any] = {}
    for key in keys:
        values = [row[key] for row in rows if row.get(key) is not None]
        kind = COLUMN_KINDS.get(key, "money")
        if kind == "int":
            totals[key] = sum(int(value) for value in values)
        else:
            zero = ZERO_QUANTITY if kind == "quantity" else ZERO
            totals[key] = sum((Decimal(str(value)) for value in values), zero)
    return totals


def _item_quantity() -> Any:
    """Order lines carry the ordered unit; every report speaks in base units (INV §1)."""
    return func.coalesce(OrderItem.confirmed_quantity, OrderItem.requested_quantity) * (
        OrderItem.unit_coefficient_snapshot
    )


async def sales_summary(session: AsyncSession, ctx: OrgContext, request: ReportRequest) -> ReportData:
    period = _bucket(Order.delivered_at, request.group_by).label("period")
    query = (
        select(
            period,
            func.count().label("orders"),
            _money(Order.total).label("total"),
            _money(Order.discount).label("discount"),
            _money(Order.delivery_fee).label("delivery_fee"),
        )
        .where(Order.company_id == ctx.organization.id, *_sold(request))
        .group_by(period)
        .order_by(period)
    )
    rows = await _rows(session, query)
    return ReportData(rows, _sum_totals(rows, ("orders", "total", "discount", "delivery_fee")))


async def sales_by_store(session: AsyncSession, ctx: OrgContext, request: ReportRequest) -> ReportData:
    sales = (
        select(Order.store_id.label("store_id"), func.count().label("orders"), _money(Order.total).label("sales"))
        .where(Order.company_id == ctx.organization.id, *_sold(request))
        .group_by(Order.store_id)
        .subquery()
    )
    credits = (
        select(Partnership.store_id.label("store_id"), _money(CreditNote.amount).label("return_credit"))
        .join(Partnership, Partnership.id == CreditNote.partnership_id)
        .where(
            Partnership.company_id == ctx.organization.id,
            local_date(CreditNote.created_at).between(request.date_from, request.date_to),
        )
        .group_by(Partnership.store_id)
        .subquery()
    )
    stores = union(select(sales.c.store_id), select(credits.c.store_id)).subquery()
    sold = func.coalesce(sales.c.sales, ZERO).label("sales")
    query = (
        select(
            Store.legal_name.label("store_name"),
            func.coalesce(sales.c.orders, 0).label("orders"),
            sold,
            func.coalesce(credits.c.return_credit, ZERO).label("return_credit"),
            (func.coalesce(sales.c.sales, ZERO) - func.coalesce(credits.c.return_credit, ZERO)).label("net_sales"),
        )
        .select_from(stores)
        .join(Store, Store.id == stores.c.store_id)
        .outerjoin(sales, sales.c.store_id == stores.c.store_id)
        .outerjoin(credits, credits.c.store_id == stores.c.store_id)
        .order_by(sold.desc(), Store.legal_name)
    )
    rows = await _rows(session, query)
    return ReportData(rows, _sum_totals(rows, ("orders", "sales", "return_credit", "net_sales")))


async def sales_by_product(session: AsyncSession, ctx: OrgContext, request: ReportRequest) -> ReportData:
    sales = (
        select(
            OrderItem.product_id.label("product_id"),
            _quantity(_item_quantity()).label("quantity"),
            _money(OrderItem.line_total).label("sales"),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.company_id == ctx.organization.id, *_sold(request))
        .group_by(OrderItem.product_id)
        .subquery()
    )
    returned = (
        select(
            OrderItem.product_id.label("product_id"),
            _quantity(ReturnItem.accepted_quantity * OrderItem.unit_coefficient_snapshot).label("return_quantity"),
            _money(ReturnItem.line_credit).label("return_credit"),
        )
        .select_from(ReturnItem)
        .join(OrderItem, OrderItem.id == ReturnItem.order_item_id)
        .join(Return, Return.id == ReturnItem.return_id)
        .where(
            Return.company_id == ctx.organization.id,
            Return.status == "COMPLETED",
            Return.completed_at.is_not(None),
            local_date(Return.completed_at).between(request.date_from, request.date_to),
        )
        .group_by(OrderItem.product_id)
        .subquery()
    )
    products = union(select(sales.c.product_id), select(returned.c.product_id)).subquery()
    sold = func.coalesce(sales.c.sales, ZERO).label("sales")
    query = (
        select(
            Product.sku.label("sku"),
            Product.name.label("product_name"),
            Product.base_unit.label("base_unit"),
            func.coalesce(sales.c.quantity, ZERO_QUANTITY).label("quantity"),
            sold,
            func.coalesce(returned.c.return_quantity, ZERO_QUANTITY).label("return_quantity"),
            func.coalesce(returned.c.return_credit, ZERO).label("return_credit"),
        )
        .select_from(products)
        .join(Product, Product.id == products.c.product_id)
        .outerjoin(sales, sales.c.product_id == products.c.product_id)
        .outerjoin(returned, returned.c.product_id == products.c.product_id)
        .order_by(sold.desc(), Product.sku)
    )
    rows = await _rows(session, query)
    return ReportData(rows, _sum_totals(rows, ("quantity", "sales", "return_quantity", "return_credit")))


async def order_funnel(session: AsyncSession, ctx: OrgContext, request: ReportRequest) -> ReportData:
    created = local_date(Order.created_at).between(request.date_from, request.date_to)
    query = (
        select(Order.status.label("status"), func.count().label("orders"))
        .where(Order.company_id == ctx.organization.id, created)
        .group_by(Order.status)
        .order_by(func.count().desc(), Order.status)
    )
    rows = await _rows(session, query)
    total = sum(int(row["orders"]) for row in rows)
    for row in rows:
        row["share"] = share(int(row["orders"]), total)
    counts = {str(row["status"]): int(row["orders"]) for row in rows}
    # ORD §3 keeps the confirmation time on the order itself; the history rows carry the same instant.
    minutes = await session.scalar(
        select(func.avg(func.extract("epoch", Order.confirmed_at - Order.created_at)) / 60).where(
            Order.company_id == ctx.organization.id, created, Order.confirmed_at.is_not(None)
        )
    )
    return ReportData(
        rows,
        {
            "orders": total,
            "partial_share": share(counts.get("PARTIALLY_CONFIRMED", 0), total),
            "rejected_share": share(counts.get("REJECTED", 0), total),
            "cancelled_share": share(counts.get("CANCELLED", 0), total),
            "average_confirm_minutes": None if minutes is None else Decimal(minutes).quantize(Decimal("0.01")),
        },
    )


_BUCKETS = ("current", "1-30", "31-60", "61-90", "90+")


async def _balances(session: AsyncSession, ctx: OrgContext) -> list[dict[str, Any]]:
    """RPT-002: a balance, an aging bucket and an overdue amount only ever come from FinanceService."""
    return [dict(row) for row in (await session.execute(finance_service.balances_query(ctx))).mappings()]


async def receivables_aging(session: AsyncSession, ctx: OrgContext, request: ReportRequest) -> ReportData:
    rows = [
        {"store_name": row["partner_name"], **{key: row[key] for key in _BUCKETS}, "outstanding": row["outstanding"]}
        for row in await _balances(session, ctx)
    ]
    rows.sort(key=lambda row: (-row["outstanding"], str(row["store_name"])))
    return ReportData(rows, _sum_totals(rows, (*_BUCKETS, "outstanding")))


async def store_debt(session: AsyncSession, ctx: OrgContext, request: ReportRequest) -> ReportData:
    rows = [
        {
            "company_name": row["partner_name"],
            "balance": row["balance"],
            "outstanding": row["outstanding"],
            "overdue": row["overdue"],
            "credit_limit": row["credit_limit"],
        }
        for row in await _balances(session, ctx)
    ]
    rows.sort(key=lambda row: (-row["overdue"], -row["balance"], str(row["company_name"])))
    return ReportData(rows, _sum_totals(rows, ("balance", "outstanding", "overdue", "credit_limit")))


async def payments(session: AsyncSession, ctx: OrgContext, request: ReportRequest) -> ReportData:
    period = _bucket(Payment.created_at, request.group_by).label("period")
    query = (
        select(
            period,
            Payment.method.label("method"),
            Payment.status.label("status"),
            func.count().label("payments"),
            _money(Payment.amount).label("amount"),
        )
        .where(
            Payment.company_id == ctx.organization.id,
            local_date(Payment.created_at).between(request.date_from, request.date_to),
        )
        .group_by(period, Payment.method, Payment.status)
        .order_by(period, Payment.method, Payment.status)
    )
    rows = await _rows(session, query)
    totals = _sum_totals(rows, ("payments", "amount"))
    totals["confirmed_amount"] = sum((row["amount"] for row in rows if row["status"] == "CONFIRMED"), ZERO)
    return ReportData(rows, totals)


async def returns(session: AsyncSession, ctx: OrgContext, request: ReportRequest) -> ReportData:
    quantity = func.coalesce(ReturnItem.accepted_quantity, ReturnItem.approved_quantity, ReturnItem.requested_quantity)
    query = (
        select(
            Store.legal_name.label("store_name"),
            Return.reason_code.label("reason_code"),
            OrderItem.product_name_snapshot.label("product_name"),
            func.count(func.distinct(Return.id)).label("returns"),
            _quantity(quantity * OrderItem.unit_coefficient_snapshot).label("quantity"),
            _money(ReturnItem.line_credit).label("credit"),
        )
        .select_from(Return)
        .join(ReturnItem, ReturnItem.return_id == Return.id)
        .join(OrderItem, OrderItem.id == ReturnItem.order_item_id)
        .join(Store, Store.id == Return.store_id)
        .where(
            Return.company_id == ctx.organization.id,
            local_date(Return.created_at).between(request.date_from, request.date_to),
        )
        .group_by(Store.legal_name, Return.reason_code, OrderItem.product_name_snapshot)
        .order_by(Store.legal_name, Return.reason_code, OrderItem.product_name_snapshot)
    )
    rows = await _rows(session, query)
    totals = _sum_totals(rows, ("returns", "quantity", "credit"))
    by_reason: dict[str, int] = {}
    for row in rows:
        by_reason[str(row["reason_code"])] = by_reason.get(str(row["reason_code"]), 0) + int(row["returns"])
    totals["by_reason"] = by_reason
    return ReportData(rows, totals)


async def delivery_performance(session: AsyncSession, ctx: OrgContext, request: ReportRequest) -> ReportData:
    finished = func.coalesce(Delivery.delivered_at, Delivery.failed_at)
    delivered = func.count(case((Delivery.status == "DELIVERED", 1)))
    transit = func.avg(
        case(
            (
                Delivery.status == "DELIVERED",
                func.extract("epoch", Delivery.delivered_at - Delivery.dispatched_at) / 3600,
            )
        )
    )
    # DEL §1: an unassigned stop still belongs in the report, under an empty courier name.
    name = func.coalesce(User.full_name, "")
    query = (
        select(
            name.label("courier_name"),
            delivered.label("delivered"),
            func.count(case((Delivery.status == "FAILED", 1))).label("failed"),
            func.count(case((Delivery.confirmation_method == "MANUAL_OVERRIDE", 1))).label("overrides"),
            transit.label("average_transit_hours"),
        )
        .select_from(Delivery)
        .outerjoin(User, User.id == Delivery.courier_id)
        .where(
            Delivery.company_id == ctx.organization.id,
            Delivery.status.in_(("DELIVERED", "FAILED")),
            local_date(finished).between(request.date_from, request.date_to),
        )
        .group_by(name)
        .order_by(delivered.desc(), name)
    )
    rows = await _rows(session, query)
    for row in rows:
        row["manual_override_share"] = share(int(row.pop("overrides")), int(row["delivered"]))
        hours = row["average_transit_hours"]
        row["average_transit_hours"] = None if hours is None else Decimal(hours).quantize(Decimal("0.01"))
    reasons = await _rows(
        session,
        select(Delivery.failure_reason_code.label("reason"), func.count().label("failed"))
        .where(
            Delivery.company_id == ctx.organization.id,
            Delivery.status == "FAILED",
            Delivery.failed_at.is_not(None),
            local_date(Delivery.failed_at).between(request.date_from, request.date_to),
        )
        .group_by(Delivery.failure_reason_code),
    )
    totals = _sum_totals(rows, ("delivered", "failed"))
    totals["failures_by_reason"] = {str(row["reason"]): int(row["failed"]) for row in reasons}
    return ReportData(rows, totals)


async def inventory_snapshot(session: AsyncSession, ctx: OrgContext, request: ReportRequest) -> ReportData:
    available = Stock.quantity - Stock.reserved_quantity
    query = (
        select(
            Product.sku.label("sku"),
            Product.name.label("product_name"),
            Product.base_unit.label("base_unit"),
            Stock.quantity.label("quantity"),
            Stock.reserved_quantity.label("reserved_quantity"),
            available.label("available_quantity"),
            Stock.low_stock_threshold.label("low_stock_threshold"),
            (Stock.low_stock_threshold.is_not(None) & (available <= Stock.low_stock_threshold)).label("low_stock"),
        )
        .select_from(Stock)
        .join(Product, Product.id == Stock.product_id)
        .where(Stock.company_id == ctx.organization.id)
        .order_by(Product.sku)
    )
    rows = await _rows(session, query)
    totals = _sum_totals(rows, ("quantity", "reserved_quantity", "available_quantity"))
    totals["low_stock_products"] = sum(1 for row in rows if row["low_stock"])
    return ReportData(rows, totals)


async def inventory_movements(session: AsyncSession, ctx: OrgContext, request: ReportRequest) -> ReportData:
    query = (
        select(
            StockMovement.type.label("type"),
            func.count().label("movements"),
            _quantity(StockMovement.quantity_delta).label("quantity"),
        )
        .where(
            StockMovement.company_id == ctx.organization.id,
            local_date(StockMovement.created_at).between(request.date_from, request.date_to),
        )
        .group_by(StockMovement.type)
        .order_by(StockMovement.type)
    )
    rows = await _rows(session, query)
    return ReportData(rows, _sum_totals(rows, ("movements", "quantity")))


async def purchases(session: AsyncSession, ctx: OrgContext, request: ReportRequest) -> ReportData:
    period = _bucket(Order.delivered_at, request.group_by).label("period")
    query = (
        select(
            Company.legal_name.label("company_name"),
            period,
            func.count().label("orders"),
            _money(Order.total).label("total"),
        )
        .select_from(Order)
        .join(Company, Company.id == Order.company_id)
        .where(Order.store_id == ctx.organization.id, *_sold(request))
        .group_by(Company.legal_name, period)
        .order_by(Company.legal_name, period)
    )
    rows = await _rows(session, query)
    return ReportData(rows, _sum_totals(rows, ("orders", "total")))


Builder = Callable[[AsyncSession, OrgContext, ReportRequest], Awaitable[ReportData]]
BUILDERS: dict[str, Builder] = {
    "sales_summary": sales_summary,
    "sales_by_store": sales_by_store,
    "sales_by_product": sales_by_product,
    "order_funnel": order_funnel,
    "receivables_aging": receivables_aging,
    "payments": payments,
    "returns": returns,
    "delivery_performance": delivery_performance,
    "inventory_snapshot": inventory_snapshot,
    "inventory_movements": inventory_movements,
    "purchases": purchases,
    "store_debt": store_debt,
}


def authorize(report: ReportSpec, ctx: OrgContext) -> None:
    """RPT-001 / EXP-001: the report's own permission, and never the other organization type's report."""
    if report.org_type != ctx.organization.type:
        # SEC-007: a store's report does not exist for a company, and the other way round.
        raise AppError("not_found", 404)
    if report.permission not in ctx.permissions:
        raise AppError("permission_denied", 403)


async def run(session: AsyncSession, ctx: OrgContext, report: ReportSpec, request: ReportRequest) -> ReportData:
    """The single entry point for every report: the API and the export writer both come through here."""
    authorize(report, ctx)
    return await BUILDERS[report.code](session, ctx, request)
