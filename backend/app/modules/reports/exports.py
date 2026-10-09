"""P12 §2 asynchronous exports: one request row, one worker run, one private file.

EXP-001 creates the row and leaves the work to the `heavy` queue; EXP-005 streams at most 200 000 rows into the
file within ten minutes; EXP-006 fixes the two formats (CSV with a BOM and `;`, XLSX with real numbers); EXP-002
re-checks the permission when the download URL is asked for, and EXP-004 lets a file live for seven days.
"""

from __future__ import annotations

import asyncio
import csv
import hashlib
import tempfile
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit, rate_limit
from app.core.db import get_sessionmaker
from app.core.errors import AppError
from app.core.events import DomainEvent, event_bus
from app.core.i18n import translate
from app.core.storage import SignedUrl, get_storage, object_key, user_object_key
from app.core.time import utcnow
from app.modules.catalog.models import Category, Price, PriceList, Product, ProductUnit
from app.modules.files.models import StoredFile
from app.modules.finance.domain import FINANCE_TIMEZONE
from app.modules.finance.models import LedgerEntry
from app.modules.identity.deps import OrgContext
from app.modules.identity.models import Membership, Organization, User
from app.modules.inventory.models import Stock
from app.modules.orders.models import Order
from app.modules.organizations.models import Company, Store
from app.modules.partnerships.models import Partnership
from app.modules.reports import domain, queries
from app.modules.reports.domain import Column, ReportSpec
from app.modules.reports.models import Export

MAX_ROWS = 200_000  # EXP-005
MAX_RUNTIME = timedelta(minutes=10)  # EXP-005
FILE_TTL = timedelta(days=7)  # EXP-004
DOWNLOAD_TTL = timedelta(minutes=15)  # EXP-003
CSV_SEPARATOR = ";"  # EXP-006
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
CSV_MIME = "text/csv"
MONEY_FORMAT = "#,##0.00"  # EXP-006
QUANTITY_FORMAT = "#,##0.000"
Format = Literal["CSV", "XLSX"]
#: EXP-008: 20 export requests per organization per hour (P00 §4.1).
EXPORT_CREATE = rate_limit.RateLimit("export_create", 20, 60 * 60)


def _columns(*pairs: tuple[str, domain.ColumnKind]) -> tuple[Column, ...]:
    return tuple(Column(key, kind) for key, kind in pairs)


@dataclass(frozen=True)
class DataSpec:
    """A raw-data export (§2.1 `kind`): the permission is the one that reads the same data in the API."""

    kind: str
    permission: str
    columns: tuple[Column, ...]
    org_types: tuple[str, ...] = ("COMPANY", "STORE")
    #: `statement` is about one partnership, so it needs it named.
    requires_partnership: bool = False
    #: SUPERADMIN-only data; such an export has no organization (§2.1).
    admin: bool = False


DATA_KINDS: tuple[DataSpec, ...] = (
    DataSpec(
        "orders",
        "orders.view",
        _columns(
            ("order_number", "text"),
            ("created_at", "date"),
            ("partner_name", "text"),
            ("status", "text"),
            ("total", "money"),
            ("discount", "money"),
            ("delivery_fee", "money"),
        ),
    ),
    DataSpec(
        "products",
        "catalog.view",
        _columns(
            ("sku", "text"),
            ("name", "text"),
            ("category", "text"),
            ("barcode", "text"),
            ("base_unit", "text"),
            ("is_active", "bool"),
        ),
        org_types=("COMPANY",),
    ),
    DataSpec(
        "prices",
        "pricing.view",
        _columns(
            ("price_list_code", "text"),
            ("sku", "text"),
            ("unit_code", "text"),
            ("price", "money"),
            ("valid_from", "date"),
            ("valid_to", "date"),
        ),
        org_types=("COMPANY",),
    ),
    DataSpec(
        "stock",
        "stock.view",
        _columns(
            ("sku", "text"),
            ("product_name", "text"),
            ("base_unit", "text"),
            ("quantity", "quantity"),
            ("reserved_quantity", "quantity"),
            ("available_quantity", "quantity"),
            ("low_stock_threshold", "quantity"),
        ),
        org_types=("COMPANY",),
    ),
    DataSpec(
        "statement",
        "finance.view",
        _columns(
            ("created_at", "date"),
            ("entry_type", "text"),
            ("direction", "text"),
            ("amount", "money"),
            ("balance_after", "money"),
            ("description", "text"),
        ),
        requires_partnership=True,
    ),
    DataSpec(
        "audit_logs",
        "admin.audit",
        _columns(
            ("created_at", "date"),
            ("actor_id", "text"),
            ("org_id", "text"),
            ("action", "text"),
            ("entity_type", "text"),
            ("entity_id", "text"),
            ("reason", "text"),
        ),
        admin=True,
    ),
)
DATA_BY_KIND = {spec.kind: spec for spec in DATA_KINDS}


@dataclass(frozen=True)
class Target:
    """What an export `kind` resolves to: a report, or raw data."""

    kind: str
    permission: str
    columns: tuple[Column, ...]
    org_types: tuple[str, ...]
    report: ReportSpec | None = None
    data: DataSpec | None = None


def target(kind: str) -> Target:
    if kind in domain.BY_CODE:
        report = domain.BY_CODE[kind]
        return Target(kind, report.permission, report.columns, (report.org_type,), report=report)
    if kind in DATA_BY_KIND:
        data = DATA_BY_KIND[kind]
        return Target(kind, data.permission, data.columns, data.org_types, data=data)
    raise AppError("not_found", 404)


def authorize(selected: Target, ctx: OrgContext) -> None:
    """EXP-001/EXP-002: the permission of the data itself, checked on create and again on download."""
    if selected.data is not None and selected.data.admin:
        # An admin export never belongs to an organization, so a tenant cannot ask for one.
        raise AppError("permission_denied", 403)
    if ctx.organization.type not in selected.org_types:
        raise AppError("not_found", 404)
    if selected.permission not in ctx.permissions:
        raise AppError("permission_denied", 403)


def parameters(selected: Target, params: dict[str, Any], today: date) -> dict[str, Any]:
    """Validate and normalise the stored filters, so the worker never re-interprets client input."""
    unknown = set(params) - {"date_from", "date_to", "group_by", "partnership_id"}
    if unknown:
        raise AppError("validation_error", 422, {"field": sorted(unknown)[0]})
    stored: dict[str, Any] = {}
    report = selected.report
    periodic = report.periodic if report else True
    if periodic:
        start, end = domain.period(_as_date(params, "date_from"), _as_date(params, "date_to"), today)
        stored["date_from"], stored["date_to"] = start.isoformat(), end.isoformat()
    if report and report.group_by:
        group_by = params.get("group_by")
        stored["group_by"] = domain.grouping(None if group_by is None else str(group_by), report)
    elif params.get("group_by"):
        raise AppError("validation_error", 422, {"field": "group_by"})
    if selected.data is not None and selected.data.requires_partnership:
        value = params.get("partnership_id")
        if not value:
            raise AppError("validation_error", 422, {"field": "partnership_id"})
        stored["partnership_id"] = str(_as_uuid(value))
    return stored


def _as_date(params: dict[str, Any], key: str) -> date | None:
    value = params.get(key)
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise AppError("validation_error", 422, {"field": key}) from exc


def _as_uuid(value: Any) -> UUID:
    try:
        return UUID(str(value))
    except ValueError as exc:
        raise AppError("validation_error", 422, {"field": "partnership_id"}) from exc


async def create(
    session: AsyncSession, ctx: OrgContext, kind: str, file_format: Format, params: dict[str, Any]
) -> Export:
    """EXP-001: accept the request, leave the work to the worker (`POST /exports` answers 202)."""
    selected = target(kind)
    authorize(selected, ctx)
    await rate_limit.hit(EXPORT_CREATE, str(ctx.organization.id))
    stored = parameters(selected, params, _today())
    export = Export(
        organization_id=ctx.organization.id,
        requested_by=ctx.user.id,
        kind=kind,
        format=file_format,
        params=stored,
    )
    session.add(export)
    await session.flush()
    await audit.record(
        session,
        "export.requested",
        "export",
        export.id,
        actor_id=ctx.user.id,
        org_id=ctx.organization.id,
        new={"kind": kind, "format": file_format},
    )
    return export


async def create_admin(
    session: AsyncSession, admin: User, kind: str, file_format: Format, params: dict[str, Any]
) -> Export:
    """ADM-006: the audit viewer exports as the platform, not as a tenant (§2.1 `organization_id` NULL)."""
    selected = target(kind)
    if selected.data is None or not selected.data.admin:
        raise AppError("permission_denied", 403)
    await rate_limit.hit(EXPORT_CREATE, str(admin.id))
    export = Export(
        organization_id=None,
        requested_by=admin.id,
        kind=kind,
        format=file_format,
        params=parameters(selected, params, _today()),
    )
    session.add(export)
    await session.flush()
    await audit.record(session, "export.requested", "export", export.id, actor_id=admin.id, new={"kind": kind})
    return export


def _today() -> date:
    return utcnow().astimezone(FINANCE_TIMEZONE).date()


async def owned(session: AsyncSession, ctx: OrgContext, export_id: UUID) -> Export:
    """SEC-007: another organization's export is indistinguishable from a missing one."""
    export = await session.scalar(
        select(Export).where(Export.id == export_id, Export.organization_id == ctx.organization.id)
    )
    if export is None:
        raise AppError("not_found", 404)
    return export


async def download(session: AsyncSession, ctx: OrgContext, export_id: UUID) -> SignedUrl:
    """EXP-002/003/004: re-check the permission, refuse an unfinished or expired file, then sign for 15 minutes."""
    export = await owned(session, ctx, export_id)
    selected = target(export.kind)
    # EXP-002: a membership revoked after the request turns the export back into a missing row.
    authorize(selected, ctx)
    return await _signed(session, export, actor_id=ctx.user.id, org_id=ctx.organization.id)


async def download_admin(session: AsyncSession, admin: User, export_id: UUID) -> SignedUrl:
    """ADM-006: an admin export belongs to the platform, so only its requester may download it."""
    export = await session.scalar(select(Export).where(Export.id == export_id, Export.organization_id.is_(None)))
    if export is None or export.requested_by != admin.id:
        raise AppError("not_found", 404)
    return await _signed(session, export, actor_id=admin.id, org_id=None)


async def _signed(session: AsyncSession, export: Export, *, actor_id: UUID, org_id: UUID | None) -> SignedUrl:
    if export.status == "EXPIRED" or (export.expires_at is not None and export.expires_at <= utcnow()):
        raise AppError("export_expired", 410)
    if export.status != "READY" or export.file_id is None:
        raise AppError("export_not_ready", 409, {"status": export.status})
    stored = await session.get(StoredFile, export.file_id)
    if stored is None:
        raise AppError("not_found", 404)
    await audit.record(
        session, "export.downloaded", "export", export.id, actor_id=actor_id, org_id=org_id, new={"kind": export.kind}
    )
    return await get_storage().signed_url(stored.storage_key, DOWNLOAD_TTL)


# --- writers ---------------------------------------------------------------------------------------------------


def _csv_value(value: Any, kind: domain.ColumnKind, language: str) -> str:
    """EXP-006: money and quantities use a dot, so a `;`-separated file stays unambiguous."""
    if value is None:
        return ""
    if kind == "bool":
        return translate(f"reports.values.{'yes' if value else 'no'}", language)
    if kind in {"money", "percent"}:
        return f"{Decimal(str(value)):.2f}"
    if kind == "quantity":
        return f"{Decimal(str(value)):.3f}"
    if kind == "hours":
        return f"{Decimal(str(value)):.2f}"
    if isinstance(value, datetime):
        return value.astimezone(FINANCE_TIMEZONE).strftime("%Y-%m-%d %H:%M")
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


async def write_csv(path: Path, columns: tuple[Column, ...], rows: AsyncIterator[dict[str, Any]], language: str) -> int:
    count = 0
    # EXP-006: UTF-8 with a BOM, so Excel opens Cyrillic and Tajik headers correctly.
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=CSV_SEPARATOR, lineterminator="\r\n")
        writer.writerow([_header(column.key, language) for column in columns])
        async for row in rows:
            writer.writerow([_csv_value(row.get(column.key), column.kind, language) for column in columns])
            count += 1
    return count


async def write_xlsx(
    path: Path, columns: tuple[Column, ...], rows: AsyncIterator[dict[str, Any]], language: str
) -> int:
    count = 0
    book = Workbook(write_only=True)  # EXP-005: rows are streamed, never held as a sheet in memory
    sheet = book.create_sheet()
    sheet.append([_header(column.key, language) for column in columns])
    async for row in rows:
        sheet.append([_xlsx_cell(sheet, row.get(column.key), column.kind, language) for column in columns])
        count += 1
    book.save(str(path))
    return count


def _xlsx_cell(sheet: Any, value: Any, kind: domain.ColumnKind, language: str) -> Any:
    """EXP-006: money is a number with the `#,##0.00` format, not text."""
    if value is None:
        return None
    if kind in {"money", "percent", "quantity", "hours"}:
        cell = WriteOnlyCell(sheet, value=float(Decimal(str(value))))
        cell.number_format = QUANTITY_FORMAT if kind == "quantity" else MONEY_FORMAT
        return cell
    if kind == "bool":
        return translate(f"reports.values.{'yes' if value else 'no'}", language)
    if isinstance(value, datetime):
        return value.astimezone(FINANCE_TIMEZONE).replace(tzinfo=None)
    if isinstance(value, date):
        return value
    return str(value)


def _header(key: str, language: str) -> str:
    """EXP-007: the heading is in the requester's language."""
    return translate(f"reports.columns.{key}", language)


# --- row sources -----------------------------------------------------------------------------------------------


async def _iterate(rows: Iterable[dict[str, Any]]) -> AsyncIterator[dict[str, Any]]:
    count = 0
    for row in rows:
        count += 1
        if count > MAX_ROWS:
            raise AppError("export_row_limit", 422, {"max_rows": MAX_ROWS})
        yield row


async def _stream(session: AsyncSession, query: Select[Any]) -> AsyncIterator[dict[str, Any]]:
    """EXP-005: raw-data exports never materialise the whole result set."""
    count = 0
    result = await session.stream(query)
    async for row in result.mappings():
        count += 1
        if count > MAX_ROWS:
            raise AppError("export_row_limit", 422, {"max_rows": MAX_ROWS})
        yield dict(row)


def _orders_query(ctx: OrgContext, params: dict[str, Any]) -> Select[Any]:
    company_side = ctx.organization.type == "COMPANY"
    partner = Store.legal_name if company_side else Company.legal_name
    scoped = Order.company_id if company_side else Order.store_id
    query = (
        select(
            Order.order_number.label("order_number"),
            Order.created_at.label("created_at"),
            partner.label("partner_name"),
            Order.status.label("status"),
            Order.total.label("total"),
            Order.discount.label("discount"),
            Order.delivery_fee.label("delivery_fee"),
        )
        .select_from(Order)
        .join(Store, Store.id == Order.store_id)
        .join(Company, Company.id == Order.company_id)
        .where(scoped == ctx.organization.id)
        .order_by(Order.created_at, Order.id)
    )
    return _in_period(query, Order.created_at, params)


def _in_period(query: Select[Any], column: Any, params: dict[str, Any]) -> Select[Any]:
    start, end = params.get("date_from"), params.get("date_to")
    if start and end:
        query = query.where(queries.local_date(column).between(date.fromisoformat(start), date.fromisoformat(end)))
    return query


def _products_query(ctx: OrgContext, params: dict[str, Any]) -> Select[Any]:
    return (
        select(
            Product.sku.label("sku"),
            Product.name.label("name"),
            Category.name.label("category"),
            Product.barcode.label("barcode"),
            Product.base_unit.label("base_unit"),
            Product.is_active.label("is_active"),
        )
        .select_from(Product)
        .outerjoin(Category, Category.id == Product.category_id)
        .where(Product.company_id == ctx.organization.id)
        .order_by(Product.sku)
    )


def _prices_query(ctx: OrgContext, params: dict[str, Any]) -> Select[Any]:
    return (
        select(
            PriceList.code.label("price_list_code"),
            Product.sku.label("sku"),
            ProductUnit.code.label("unit_code"),
            Price.price.label("price"),
            Price.valid_from.label("valid_from"),
            Price.valid_to.label("valid_to"),
        )
        .select_from(Price)
        .join(PriceList, PriceList.id == Price.price_list_id)
        .join(ProductUnit, ProductUnit.id == Price.product_unit_id)
        .join(Product, Product.id == ProductUnit.product_id)
        .where(PriceList.company_id == ctx.organization.id)
        .order_by(PriceList.code, Product.sku, ProductUnit.code, Price.valid_from)
    )


def _stock_query(ctx: OrgContext, params: dict[str, Any]) -> Select[Any]:
    available = Stock.quantity - Stock.reserved_quantity
    return (
        select(
            Product.sku.label("sku"),
            Product.name.label("product_name"),
            Product.base_unit.label("base_unit"),
            Stock.quantity.label("quantity"),
            Stock.reserved_quantity.label("reserved_quantity"),
            available.label("available_quantity"),
            Stock.low_stock_threshold.label("low_stock_threshold"),
        )
        .select_from(Stock)
        .join(Product, Product.id == Stock.product_id)
        .where(Stock.company_id == ctx.organization.id)
        .order_by(Product.sku)
    )


async def _statement_query(session: AsyncSession, ctx: OrgContext, params: dict[str, Any]) -> Select[Any]:
    """FIN §7: only a partnership of this organization has a statement, and only its ledger rows are read."""
    partnership_id = _as_uuid(params["partnership_id"])
    side = Partnership.company_id if ctx.organization.type == "COMPANY" else Partnership.store_id
    partnership = await session.scalar(
        select(Partnership).where(Partnership.id == partnership_id, side == ctx.organization.id)
    )
    if partnership is None:
        raise AppError("not_found", 404)
    query = (
        select(
            LedgerEntry.created_at.label("created_at"),
            LedgerEntry.entry_type.label("entry_type"),
            LedgerEntry.direction.label("direction"),
            LedgerEntry.amount.label("amount"),
            LedgerEntry.balance_after.label("balance_after"),
            LedgerEntry.description.label("description"),
        )
        .where(LedgerEntry.partnership_id == partnership_id)
        .order_by(LedgerEntry.created_at, LedgerEntry.id)
    )
    return _in_period(query, LedgerEntry.created_at, params)


def _audit_query(params: dict[str, Any]) -> Select[Any]:
    from app.core.audit import AuditLog

    query = select(
        AuditLog.created_at.label("created_at"),
        AuditLog.actor_id.label("actor_id"),
        AuditLog.org_id.label("org_id"),
        AuditLog.action.label("action"),
        AuditLog.entity_type.label("entity_type"),
        AuditLog.entity_id.label("entity_id"),
        AuditLog.reason.label("reason"),
    ).order_by(AuditLog.created_at, AuditLog.id)
    return _in_period(query, AuditLog.created_at, params)


async def rows_of(
    session: AsyncSession, ctx: OrgContext | None, selected: Target, params: dict[str, Any]
) -> AsyncIterator[dict[str, Any]]:
    """RPT-005: a report export reads the very same builder the API reads."""
    if selected.report is not None:
        assert ctx is not None
        request = queries.ReportRequest(
            date.fromisoformat(params["date_from"]) if params.get("date_from") else _today(),
            date.fromisoformat(params["date_to"]) if params.get("date_to") else _today(),
            params.get("group_by"),
        )
        data = await queries.run(session, ctx, selected.report, request)
        return _iterate(data.rows)
    assert selected.data is not None
    if selected.data.admin:
        return _stream(session, _audit_query(params))
    assert ctx is not None
    if selected.kind == "statement":
        return _stream(session, await _statement_query(session, ctx, params))
    builders = {"orders": _orders_query, "products": _products_query, "prices": _prices_query, "stock": _stock_query}
    return _stream(session, builders[selected.kind](ctx, params))


# --- worker ----------------------------------------------------------------------------------------------------


async def worker_context(session: AsyncSession, export: Export) -> OrgContext | None:
    """EXP-002: the worker runs with the requester's current access, not the access they had at request time."""
    user = await session.get(User, export.requested_by)
    if user is None or user.status != "ACTIVE":
        raise AppError("permission_denied", 403)
    if export.organization_id is None:
        if not user.is_superadmin:
            raise AppError("permission_denied", 403)
        return None
    organization = await session.get(Organization, export.organization_id)
    membership = await session.scalar(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.organization_id == export.organization_id,
            Membership.status == "ACTIVE",
        )
    )
    if organization is None or membership is None or organization.status == "BLOCKED":
        raise AppError("permission_denied", 403)
    ctx = OrgContext(user, membership, organization)
    selected = target(export.kind)
    authorize(selected, ctx)
    return ctx


async def run_export(session: AsyncSession, export: Export) -> None:
    """One export: build the rows, write the file, store it privately and publish EXPORT_READY (EXP-008)."""
    selected = target(export.kind)
    ctx = await worker_context(session, export)
    user = await session.get(User, export.requested_by)
    assert user is not None
    extension = "csv" if export.format == "CSV" else "xlsx"
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / f"export.{extension}"
        rows = await rows_of(session, ctx, selected, export.params)
        async with asyncio.timeout(MAX_RUNTIME.total_seconds()):
            if export.format == "CSV":
                count = await write_csv(path, selected.columns, rows, user.language)
            else:
                count = await write_xlsx(path, selected.columns, rows, user.language)
        data = path.read_bytes()
    key = (
        object_key(export.organization_id, "EXPORT", extension)
        if export.organization_id
        else user_object_key(user.id, "EXPORT", extension)
    )
    await get_storage().put_private(key, data, CSV_MIME if export.format == "CSV" else XLSX_MIME)
    stored = StoredFile(
        organization_id=export.organization_id,
        owner_user_id=None if export.organization_id else user.id,
        category="EXPORT",
        storage_key=key,
        content_type=CSV_MIME if export.format == "CSV" else XLSX_MIME,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        display_name=f"{export.kind}.{extension}",
        uploaded_by=user.id,
    )
    session.add(stored)
    await session.flush()
    ready = utcnow()
    export.status = "READY"
    export.file_id = stored.id
    export.row_count = count
    export.ready_at = ready
    export.expires_at = ready + FILE_TTL
    await audit.record(
        session,
        "export.ready",
        "export",
        export.id,
        actor_id=user.id,
        org_id=export.organization_id,
        new={"kind": export.kind, "row_count": count},
    )
    await event_bus.publish(
        session,
        DomainEvent(
            "EXPORT_READY",
            {
                "export_id": str(export.id),
                "kind": export.kind,
                "requested_by": str(export.requested_by),
                "row_count": count,
            },
            org_id=export.organization_id,
        ),
    )


async def fail_stale(session: AsyncSession) -> int:
    """EXP-005: a run that outlived its ten minutes (a lost worker, say) is failed, not left RUNNING forever."""
    stale = list(
        await session.scalars(
            select(Export).where(
                Export.status == "RUNNING",
                Export.started_at.is_not(None),
                Export.started_at < utcnow() - MAX_RUNTIME,
            )
        )
    )
    for export in stale:
        export.status = "FAILED"
        export.error = "export_timeout"
    return len(stale)


async def process_pending(limit: int = 5) -> int:
    """EXP-001: the `heavy` queue picks requests up one at a time; a failure never blocks the next one."""
    processed = 0
    async with get_sessionmaker()() as session, session.begin():
        await fail_stale(session)
    for _ in range(limit):
        async with get_sessionmaker()() as session, session.begin():
            export = await session.scalar(
                select(Export)
                .where(Export.status == "PENDING")
                .order_by(Export.created_at, Export.id)
                .with_for_update(skip_locked=True)
                .limit(1)
                .execution_options(populate_existing=True)
            )
            if export is None:
                break
            export.status = "RUNNING"
            export.started_at = utcnow()
            try:
                # The row lock is outside the savepoint: a failure rolls back the work, not the FAILED status.
                async with session.begin_nested():
                    await run_export(session, export)
                    await session.flush()
            except (AppError, TimeoutError, OSError) as exc:
                export.status = "FAILED"
                export.error = exc.code if isinstance(exc, AppError) else type(exc).__name__
            processed += 1
    return processed


async def expire_files(session: AsyncSession) -> int:
    """EXP-004: seven days after it was ready, the file is deleted and the row says EXPIRED."""
    expired = list(
        await session.scalars(
            select(Export).where(
                Export.status == "READY", Export.expires_at.is_not(None), Export.expires_at <= utcnow()
            )
        )
    )
    for export in expired:
        stored = await session.get(StoredFile, export.file_id) if export.file_id else None
        if stored is not None:
            await get_storage().delete(stored.storage_key)
        export.status = "EXPIRED"
        export.file_id = None
        export.ready_at = None
        await audit.record(
            session, "export.expired", "export", export.id, org_id=export.organization_id, new={"kind": export.kind}
        )
    return len(expired)
