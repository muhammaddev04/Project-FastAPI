"""P12 §4 tenant-scoped dashboard, report and export endpoints."""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import select

from app.core.filtering import ListQuery
from app.core.idempotency import IdempotentRoute, idempotent
from app.core.pagination import Page
from app.modules.identity.deps import OrgContextDep, SessionDep
from app.modules.reports import exports, service
from app.modules.reports.models import Export
from app.modules.reports.schemas import (
    CompanyDashboardOut,
    DownloadOut,
    ExportIn,
    ExportOut,
    ExportStatus,
    ReportInfoOut,
    ReportOut,
    StoreDashboardOut,
)

router = APIRouter(prefix="/api/v1", tags=["reports"], route_class=IdempotentRoute)


class ExportQuery(ListQuery):
    status: ExportStatus | None = None
    kind: Annotated[str | None, Query(max_length=32)] = None
    filter_columns = {"status": Export.status, "kind": Export.kind}
    fixed_ordering = (Export.created_at.desc(),)


@router.get(
    "/dashboard",
    response_model=CompanyDashboardOut | StoreDashboardOut,
    summary="Dashboard figures of the active organization (§1.3)",
)
async def dashboard(session: SessionDep, ctx: OrgContextDep) -> CompanyDashboardOut | StoreDashboardOut:
    return await service.dashboard(session, ctx)


@router.get("/reports", response_model=list[ReportInfoOut], summary="Reports this member may open (§1.2)")
async def list_reports(ctx: OrgContextDep) -> list[ReportInfoOut]:
    return service.available(ctx)


@router.get(
    "/reports/{code}",
    response_model=ReportOut,
    summary="One report for a period of at most 366 local days (RPT-003/005)",
    responses={
        403: {"description": "`permission_denied`: the report's own permission is required (§1.2)."},
        404: {"description": "`not_found`: unknown report, or one belonging to the other organization type."},
        422: {"description": "`report_range_too_large` or `validation_error`."},
    },
)
async def read_report(
    session: SessionDep,
    ctx: OrgContextDep,
    code: str,
    date_from: Annotated[date | None, Query()] = None,
    date_to: Annotated[date | None, Query()] = None,
    group_by: Annotated[str | None, Query(max_length=8)] = None,
) -> ReportOut:
    return await service.report(session, ctx, code, date_from, date_to, group_by)


@router.post(
    "/exports",
    response_model=ExportOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[idempotent()],
    summary="Request an export; the `heavy` queue builds it (EXP-001)",
    responses={
        403: {"description": "`permission_denied`: the permission of the exported data is required."},
        404: {"description": "`not_found`: unknown `kind`."},
        429: {"description": "`rate_limited`: `export_create` is 20 per organization per hour (EXP-008)."},
    },
)
async def create_export(session: SessionDep, ctx: OrgContextDep, payload: ExportIn) -> ExportOut:
    export = await exports.create(session, ctx, payload.kind, payload.format, payload.params)
    return ExportOut.model_validate(export)


@router.get("/exports", response_model=Page[ExportOut], summary="Exports of the active organization")
async def list_exports(
    session: SessionDep, ctx: OrgContextDep, query: Annotated[ExportQuery, Query()]
) -> Page[ExportOut]:
    base = select(Export).where(Export.organization_id == ctx.organization.id)
    count, rows = await query.fetch(session, base, tie_breaker=Export.id)
    return Page.of(query.page, count, [ExportOut.model_validate(row) for row in rows.scalars()])


@router.get("/exports/{export_id}", response_model=ExportOut, summary="State of one export")
async def read_export(session: SessionDep, ctx: OrgContextDep, export_id: UUID) -> ExportOut:
    return ExportOut.model_validate(await exports.owned(session, ctx, export_id))


@router.get(
    "/exports/{export_id}/download",
    response_model=DownloadOut,
    summary="15-minute signed URL for a ready export; each download is audited (EXP-002/003)",
    responses={
        403: {"description": "`permission_denied`: the data permission is re-checked here (EXP-002)."},
        409: {"description": "`export_not_ready`."},
        410: {"description": "`export_expired`: the file lived for seven days (EXP-004)."},
    },
)
async def download_export(session: SessionDep, ctx: OrgContextDep, export_id: UUID, response: Response) -> DownloadOut:
    signed = await exports.download(session, ctx, export_id)
    response.headers["Cache-Control"] = "no-store"
    return DownloadOut(url=signed.url, expires_at=signed.expires_at)
