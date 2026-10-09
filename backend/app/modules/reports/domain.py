"""P12 §1.1 report registry and period rules; no query and no I/O lives here.

Every report is described once: who may read it, which columns it has and whether a period applies. The API
(`GET /reports/{code}`) and the export writer both read this registry, so RPT-005 holds by construction.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal

from app.core.errors import AppError

MAX_RANGE_DAYS = 366  # RPT-003
GroupBy = Literal["day", "week", "month"]
# Column kinds drive both the API types and the EXP-006 file formatting.
ColumnKind = Literal["text", "bool", "int", "money", "quantity", "date", "percent", "hours"]


@dataclass(frozen=True)
class Column:
    key: str
    kind: ColumnKind


@dataclass(frozen=True)
class ReportSpec:
    """One report. `permission` is also what EXP-001 requires to export it."""

    code: str
    org_type: Literal["COMPANY", "STORE"]
    permission: str
    columns: tuple[Column, ...]
    #: RPT-003 applies to every report whose rows are bounded by a period; a snapshot has none.
    periodic: bool = True
    #: allowed `group_by` values, first one being the default; empty when the report has no grouping.
    group_by: tuple[GroupBy, ...] = ()


def _columns(*pairs: tuple[str, ColumnKind]) -> tuple[Column, ...]:
    return tuple(Column(key, kind) for key, kind in pairs)


REPORTS: tuple[ReportSpec, ...] = (
    ReportSpec(
        "sales_summary",
        "COMPANY",
        "reports.sales",
        _columns(
            ("period", "date"),
            ("orders", "int"),
            ("total", "money"),
            ("discount", "money"),
            ("delivery_fee", "money"),
        ),
        group_by=("day", "week", "month"),
    ),
    ReportSpec(
        "sales_by_store",
        "COMPANY",
        "reports.sales",
        _columns(
            ("store_name", "text"),
            ("orders", "int"),
            ("sales", "money"),
            ("return_credit", "money"),
            ("net_sales", "money"),
        ),
    ),
    ReportSpec(
        "sales_by_product",
        "COMPANY",
        "reports.sales",
        _columns(
            ("sku", "text"),
            ("product_name", "text"),
            ("base_unit", "text"),
            ("quantity", "quantity"),
            ("sales", "money"),
            ("return_quantity", "quantity"),
            ("return_credit", "money"),
        ),
    ),
    ReportSpec(
        "order_funnel",
        "COMPANY",
        "reports.funnel",
        _columns(("status", "text"), ("orders", "int"), ("share", "percent")),
    ),
    ReportSpec(
        "receivables_aging",
        "COMPANY",
        "reports.finance",
        _columns(
            ("store_name", "text"),
            ("current", "money"),
            ("1-30", "money"),
            ("31-60", "money"),
            ("61-90", "money"),
            ("90+", "money"),
            ("outstanding", "money"),
        ),
        periodic=False,
    ),
    ReportSpec(
        "payments",
        "COMPANY",
        "reports.finance",
        _columns(
            ("period", "date"),
            ("method", "text"),
            ("status", "text"),
            ("payments", "int"),
            ("amount", "money"),
        ),
    ),
    ReportSpec(
        "returns",
        "COMPANY",
        "reports.returns",
        _columns(
            ("store_name", "text"),
            ("reason_code", "text"),
            ("product_name", "text"),
            ("returns", "int"),
            ("quantity", "quantity"),
            ("credit", "money"),
        ),
    ),
    ReportSpec(
        "delivery_performance",
        "COMPANY",
        "reports.delivery",
        _columns(
            ("courier_name", "text"),
            ("delivered", "int"),
            ("failed", "int"),
            ("manual_override_share", "percent"),
            ("average_transit_hours", "hours"),
        ),
    ),
    ReportSpec(
        "inventory_snapshot",
        "COMPANY",
        "reports.inventory",
        _columns(
            ("sku", "text"),
            ("product_name", "text"),
            ("base_unit", "text"),
            ("quantity", "quantity"),
            ("reserved_quantity", "quantity"),
            ("available_quantity", "quantity"),
            ("low_stock_threshold", "quantity"),
            ("low_stock", "bool"),
        ),
        periodic=False,
    ),
    ReportSpec(
        "inventory_movements",
        "COMPANY",
        "reports.inventory",
        _columns(("type", "text"), ("movements", "int"), ("quantity", "quantity")),
    ),
    ReportSpec(
        "purchases",
        "STORE",
        "reports.purchases",
        _columns(("company_name", "text"), ("period", "date"), ("orders", "int"), ("total", "money")),
        group_by=("month", "day", "week"),
    ),
    ReportSpec(
        "store_debt",
        "STORE",
        "reports.debt",
        _columns(
            ("company_name", "text"),
            ("balance", "money"),
            ("outstanding", "money"),
            ("overdue", "money"),
            ("credit_limit", "money"),
        ),
        periodic=False,
    ),
)

BY_CODE = {spec.code: spec for spec in REPORTS}


def spec(code: str) -> ReportSpec:
    """SEC-007: an unknown report and one belonging to the other side both read as missing."""
    if code not in BY_CODE:
        raise AppError("not_found", 404)
    return BY_CODE[code]


def period(date_from: date | None, date_to: date | None, today: date) -> tuple[date, date]:
    """RPT-003: a closed range of local dates, at most 366 days; the default is the last 30 days."""
    end = date_to or today
    start = date_from or end - timedelta(days=29)
    if start > end:
        raise AppError("validation_error", 422, {"field": "date_from"})
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise AppError("report_range_too_large", 422, {"max_days": MAX_RANGE_DAYS})
    return start, end


def grouping(requested: str | None, report: ReportSpec) -> GroupBy | None:
    if not report.group_by:
        if requested:
            raise AppError("validation_error", 422, {"field": "group_by"})
        return None
    if requested is None:
        return report.group_by[0]
    if requested not in report.group_by:
        raise AppError("validation_error", 422, {"field": "group_by"})
    return requested


def share(part: int, whole: int) -> Decimal:
    """Percentages are rounded once, here, so the API and the export agree (RPT-005)."""
    if whole <= 0:
        return Decimal("0.00")
    return (Decimal(part) * 100 / Decimal(whole)).quantize(Decimal("0.01"))
