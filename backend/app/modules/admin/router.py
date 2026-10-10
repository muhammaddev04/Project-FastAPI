"""P12 §3.1 SUPERADMIN endpoints.

Everything here depends on `require_superadmin` (no `X-Org-Id`), every change carries a reason, and reading a
tenant's business data is audited (ADM-010). There is no impersonation endpoint: ADM-011 rules it out.
"""

from datetime import date, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Query, status
from sqlalchemy import Select, select

from app.core.audit import AuditLog
from app.core.filtering import ListQuery
from app.core.idempotency import IdempotentRoute, idempotent
from app.core.outbox import OutboxEvent
from app.core.pagination import Page, PageParamsDep, fetch_page
from app.modules.admin import service
from app.modules.admin.schemas import (
    AdminDashboardOut,
    AdminOrderOut,
    AdminOrganizationDetail,
    AdminOrganizationOut,
    AdminUserDetail,
    AdminUserOut,
    AuditLogOut,
    LegalPatch,
    NotificationFailureOut,
    OutboxEventOut,
    ReasonIn,
    TransferOwnershipIn,
)
from app.modules.finance.schemas import StatementOut
from app.modules.finance.service import finance_service
from app.modules.identity.deps import SessionDep, SuperadminDep
from app.modules.identity.models import Organization, User
from app.modules.notifications.models import NotificationDelivery
from app.modules.orders.models import Order
from app.modules.organizations.models import Company, Store
from app.modules.reports import exports
from app.modules.reports.schemas import ExportFormat, ExportOut

router = APIRouter(prefix="/api/v1/admin", tags=["admin"], route_class=IdempotentRoute)

_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"description": "`not_authenticated` / `token_invalid` / `token_expired`."},
    403: {"description": "`permission_denied`: SUPERADMIN only (no `X-Org-Id` needed)."},
    404: {"description": "`not_found`."},
    422: {"description": "`override_reason_required` on every change (§3)."},
}


class UserQuery(ListQuery):
    status: Literal["ACTIVE", "BLOCKED"] | None = None
    search: Annotated[str | None, Query(max_length=100)] = None
    filter_columns = {"status": User.status}
    search_columns = (User.full_name, User.phone, User.email)
    fixed_ordering = (User.created_at.desc(),)


class OrganizationQuery(ListQuery):
    type: Literal["COMPANY", "STORE"] | None = None
    status: Literal["ACTIVE", "SUSPENDED", "BLOCKED"] | None = None
    search: Annotated[str | None, Query(max_length=100)] = None
    filter_columns = {"type": Organization.type, "status": Organization.status}
    search_columns = (Organization.name,)
    fixed_ordering = (Organization.created_at.desc(),)


class AuditQuery(ListQuery):
    """ADM-006: search by organization, actor, action, entity and period."""

    org_id: UUID | None = None
    actor_id: UUID | None = None
    action: Annotated[str | None, Query(max_length=64)] = None
    entity_type: Annotated[str | None, Query(max_length=64)] = None
    entity_id: UUID | None = None
    date_from: date | None = None
    date_to: date | None = None
    filter_columns = {
        "org_id": AuditLog.org_id,
        "actor_id": AuditLog.actor_id,
        "action": AuditLog.action,
        "entity_type": AuditLog.entity_type,
        "entity_id": AuditLog.entity_id,
    }
    fixed_ordering = (AuditLog.created_at.desc(),)

    def apply(self, query: Select[Any]) -> Select[Any]:
        query = super().apply(query)
        if self.date_from:
            query = query.where(AuditLog.created_at >= datetime.combine(self.date_from, datetime.min.time()))
        if self.date_to:
            query = query.where(AuditLog.created_at < datetime.combine(self.date_to, datetime.max.time()))
        return query


class OutboxQuery(ListQuery):
    status: Literal["PENDING", "PROCESSED", "FAILED"] | None = None
    event_type: Annotated[str | None, Query(max_length=64)] = None
    filter_columns = {"status": OutboxEvent.status, "event_type": OutboxEvent.event_type}
    fixed_ordering = (OutboxEvent.created_at.desc(),)


@router.get("/dashboard", response_model=AdminDashboardOut, summary="Platform figures (ADM-001)", responses=_ERRORS)
async def dashboard(session: SessionDep, _admin: SuperadminDep) -> AdminDashboardOut:
    return AdminDashboardOut.model_validate(await service.dashboard(session))


@router.get("/users", response_model=Page[AdminUserOut], summary="Search users (ADM-002)", responses=_ERRORS)
async def list_users(
    session: SessionDep, _admin: SuperadminDep, query: Annotated[UserQuery, Query()]
) -> Page[AdminUserOut]:
    count, rows = await query.fetch(session, select(User), tie_breaker=User.id)
    return Page.of(query.page, count, [AdminUserOut.model_validate(row) for row in rows.scalars()])


@router.get("/users/{user_id}", response_model=AdminUserDetail, summary="One user (ADM-002)", responses=_ERRORS)
async def read_user(session: SessionDep, _admin: SuperadminDep, user_id: UUID) -> AdminUserDetail:
    user = await service.get_user(session, user_id)
    return AdminUserDetail(
        **AdminUserOut.model_validate(user).model_dump(),
        memberships=await service.memberships_of(session, user_id),  # type: ignore[arg-type]
    )


@router.post(
    "/users/{user_id}/block",
    response_model=AdminUserDetail,
    summary="Block a user: status BLOCKED, every token invalidated (IAM-009)",
    responses={**_ERRORS, 409: {"description": "`invalid_transition`: already blocked."}},
)
async def block_user(session: SessionDep, admin: SuperadminDep, user_id: UUID, payload: ReasonIn) -> AdminUserDetail:
    user = await service.set_user_status(session, admin, user_id, "BLOCKED", payload.reason)
    return await _user_detail(session, user)


@router.post("/users/{user_id}/unblock", response_model=AdminUserDetail, responses=_ERRORS)
async def unblock_user(session: SessionDep, admin: SuperadminDep, user_id: UUID, payload: ReasonIn) -> AdminUserDetail:
    user = await service.set_user_status(session, admin, user_id, "ACTIVE", payload.reason)
    return await _user_detail(session, user)


@router.post("/users/{user_id}/logout-all", response_model=AdminUserDetail, responses=_ERRORS)
async def logout_all(session: SessionDep, admin: SuperadminDep, user_id: UUID, payload: ReasonIn) -> AdminUserDetail:
    user = await service.logout_all(session, admin, user_id, payload.reason)
    return await _user_detail(session, user)


async def _user_detail(session: SessionDep, user: User) -> AdminUserDetail:
    return AdminUserDetail(
        **AdminUserOut.model_validate(user).model_dump(),
        memberships=await service.memberships_of(session, user.id),  # type: ignore[arg-type]
    )


@router.get(
    "/organizations",
    response_model=Page[AdminOrganizationOut],
    summary="Search organizations (ADM-003)",
    responses=_ERRORS,
)
async def list_organizations(
    session: SessionDep, _admin: SuperadminDep, query: Annotated[OrganizationQuery, Query()]
) -> Page[AdminOrganizationOut]:
    legal = (
        select(Company.id, Company.legal_name, Company.verification_status)
        .union_all(select(Store.id, Store.legal_name, Store.verification_status))
        .subquery()
    )
    base = select(
        Organization.id,
        Organization.name,
        Organization.type,
        Organization.status,
        legal.c.legal_name,
        legal.c.verification_status,
        Organization.created_at,
    ).outerjoin(legal, legal.c.id == Organization.id)
    count, rows = await query.fetch(session, base, tie_breaker=Organization.id)
    return Page.of(query.page, count, [AdminOrganizationOut.model_validate(dict(row)) for row in rows.mappings()])


@router.get("/organizations/{organization_id}", response_model=AdminOrganizationDetail, responses=_ERRORS)
async def read_organization(
    session: SessionDep, _admin: SuperadminDep, organization_id: UUID
) -> AdminOrganizationDetail:
    return AdminOrganizationDetail.model_validate(await service.organization_detail(session, organization_id))


@router.post(
    "/organizations/{organization_id}/suspend",
    response_model=AdminOrganizationDetail,
    summary="ACTIVE -> SUSPENDED: reading stays allowed, changing does not (P02 §2.2)",
    responses={**_ERRORS, 409: {"description": "`invalid_transition`."}},
)
async def suspend_organization(
    session: SessionDep, admin: SuperadminDep, organization_id: UUID, payload: ReasonIn
) -> AdminOrganizationDetail:
    await service.set_organization_status(session, admin, organization_id, "SUSPENDED", payload.reason)
    return AdminOrganizationDetail.model_validate(await service.organization_detail(session, organization_id))


@router.post(
    "/organizations/{organization_id}/block",
    response_model=AdminOrganizationDetail,
    summary="-> BLOCKED: everything but `/me` is refused (P02 §2.2)",
    responses={**_ERRORS, 409: {"description": "`invalid_transition`."}},
)
async def block_organization(
    session: SessionDep, admin: SuperadminDep, organization_id: UUID, payload: ReasonIn
) -> AdminOrganizationDetail:
    await service.set_organization_status(session, admin, organization_id, "BLOCKED", payload.reason)
    return AdminOrganizationDetail.model_validate(await service.organization_detail(session, organization_id))


@router.post(
    "/organizations/{organization_id}/activate",
    response_model=AdminOrganizationDetail,
    responses={**_ERRORS, 409: {"description": "`invalid_transition`."}},
)
async def activate_organization(
    session: SessionDep, admin: SuperadminDep, organization_id: UUID, payload: ReasonIn
) -> AdminOrganizationDetail:
    await service.set_organization_status(session, admin, organization_id, "ACTIVE", payload.reason)
    return AdminOrganizationDetail.model_validate(await service.organization_detail(session, organization_id))


@router.post(
    "/organizations/{organization_id}/transfer-ownership",
    response_model=AdminOrganizationDetail,
    summary="Hand the OWNER role to another active member (ADM-003)",
    responses={**_ERRORS, 409: {"description": "`invalid_transition` or `version_conflict`."}},
)
async def transfer_ownership(
    session: SessionDep, admin: SuperadminDep, organization_id: UUID, payload: TransferOwnershipIn
) -> AdminOrganizationDetail:
    detail = await service.transfer_ownership(
        session, admin, organization_id, payload.user_id, payload.previous_owner_role, payload.reason
    )
    return AdminOrganizationDetail.model_validate(detail)


@router.patch(
    "/organizations/{organization_id}/legal",
    response_model=AdminOrganizationDetail,
    summary="Correct the legal fields a verified tenant may not change (ORG-005)",
    responses={**_ERRORS, 409: {"description": "`version_conflict` or `tax_identifier_taken`."}},
)
async def update_legal(
    session: SessionDep, admin: SuperadminDep, organization_id: UUID, payload: LegalPatch
) -> AdminOrganizationDetail:
    fields = payload.model_dump(exclude={"reason", "version"}, exclude_none=True)
    detail = await service.update_legal(session, admin, organization_id, fields, payload.version, payload.reason)
    return AdminOrganizationDetail.model_validate(detail)


@router.get("/audit-logs", response_model=Page[AuditLogOut], summary="Audit viewer (ADM-006)", responses=_ERRORS)
async def list_audit_logs(
    session: SessionDep, _admin: SuperadminDep, query: Annotated[AuditQuery, Query()]
) -> Page[AuditLogOut]:
    count, rows = await query.fetch(session, select(AuditLog), tie_breaker=AuditLog.id)
    return Page.of(query.page, count, [AuditLogOut.model_validate(row) for row in rows.scalars()])


@router.post(
    "/audit-logs/export",
    response_model=ExportOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[idempotent()],
    summary="Export the audit log through the export queue (ADM-006, §2)",
    responses=_ERRORS,
)
async def export_audit_logs(
    session: SessionDep,
    admin: SuperadminDep,
    file_format: Annotated[ExportFormat, Query(alias="format")] = "CSV",
    date_from: Annotated[date | None, Query()] = None,
    date_to: Annotated[date | None, Query()] = None,
    org_id: UUID | None = None,
    actor_id: UUID | None = None,
    entity_id: UUID | None = None,
    action: Annotated[str | None, Query(max_length=64)] = None,
    entity_type: Annotated[str | None, Query(max_length=64)] = None,
) -> ExportOut:
    params = {
        "date_from": date_from,
        "date_to": date_to,
        "org_id": org_id,
        "actor_id": actor_id,
        "entity_id": entity_id,
        "action": action,
        "entity_type": entity_type,
    }
    export = await exports.create_admin(
        session, admin, "audit_logs", file_format, {k: v for k, v in params.items() if v is not None}
    )
    return ExportOut.model_validate(export)


@router.get("/exports/{export_id}", response_model=ExportOut, responses=_ERRORS)
async def get_admin_export(session: SessionDep, admin: SuperadminDep, export_id: UUID) -> ExportOut:
    return ExportOut.model_validate(await exports.owned_admin(session, admin, export_id))


@router.get(
    "/exports/{export_id}/download",
    summary="Signed URL of an admin export (EXP-003)",
    responses={**_ERRORS, 409: {"description": "`export_not_ready`."}, 410: {"description": "`export_expired`."}},
)
async def download_admin_export(session: SessionDep, admin: SuperadminDep, export_id: UUID) -> dict[str, Any]:
    signed = await exports.download_admin(session, admin, export_id)
    return {"url": signed.url, "expires_at": signed.expires_at}


@router.get(
    "/outbox", response_model=Page[OutboxEventOut], summary="Durable events, FAILED first (ADM-007)", responses=_ERRORS
)
async def list_outbox(
    session: SessionDep, _admin: SuperadminDep, query: Annotated[OutboxQuery, Query()]
) -> Page[OutboxEventOut]:
    count, rows = await query.fetch(session, select(OutboxEvent), tie_breaker=OutboxEvent.id)
    return Page.of(query.page, count, [OutboxEventOut.model_validate(row) for row in rows.scalars()])


@router.post(
    "/outbox/{event_id}/retry",
    response_model=OutboxEventOut,
    summary="Put a FAILED event back in the queue (ADM-007)",
    responses={**_ERRORS, 409: {"description": "`invalid_transition`: the event is not FAILED."}},
)
async def retry_outbox(session: SessionDep, admin: SuperadminDep, event_id: UUID, payload: ReasonIn) -> OutboxEventOut:
    return OutboxEventOut.model_validate(await service.retry_outbox(session, admin, event_id, payload.reason))


@router.get(
    "/notification-failures",
    response_model=Page[NotificationFailureOut],
    summary="Deliveries that failed three times (ADM-008, NTF-004)",
    responses=_ERRORS,
)
async def notification_failures(
    session: SessionDep, _admin: SuperadminDep, page: PageParamsDep
) -> Page[NotificationFailureOut]:
    count, rows = await fetch_page(
        session,
        service.notification_failures_query(),
        page,
        order_by=[NotificationDelivery.created_at.desc()],
        tie_breaker=NotificationDelivery.id,
    )
    return Page.of(page, count, [NotificationFailureOut.model_validate(dict(row)) for row in rows.mappings()])


@router.get(
    "/organizations/{organization_id}/orders",
    response_model=Page[AdminOrderOut],
    summary="Read a tenant's orders for support; the read itself is audited (ADM-010)",
    responses=_ERRORS,
)
async def organization_orders(
    session: SessionDep,
    admin: SuperadminDep,
    organization_id: UUID,
    page: PageParamsDep,
    reason: Annotated[str | None, Query(max_length=500)] = None,
) -> Page[AdminOrderOut]:
    query = await service.organization_orders_query(session, organization_id)
    await service.viewed(session, admin, "orders", organization_id, reason, org_id=organization_id)
    count, rows = await fetch_page(session, query, page, order_by=[Order.created_at.desc()], tie_breaker=Order.id)
    return Page.of(page, count, [AdminOrderOut.model_validate(row) for row in rows.scalars()])


@router.get(
    "/partnerships/{partnership_id}/statement",
    response_model=StatementOut,
    summary="Read a partnership statement for support; the read itself is audited (ADM-010)",
    responses=_ERRORS,
)
async def partnership_statement(
    session: SessionDep,
    admin: SuperadminDep,
    partnership_id: UUID,
    reason: Annotated[str | None, Query(max_length=500)] = None,
    date_from: Annotated[date | None, Query()] = None,
    date_to: Annotated[date | None, Query()] = None,
) -> StatementOut:
    partnership = await service.partnership_of(session, partnership_id)
    await service.viewed(session, admin, "partnerships", partnership_id, reason, org_id=partnership.company_id)
    result = await finance_service.statement(session, partnership_id, date_from, date_to)
    return StatementOut.model_validate(result)
