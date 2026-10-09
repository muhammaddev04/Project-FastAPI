"""P12 §3 SUPERADMIN operations.

Three rules hold for every function here: the caller is a platform administrator (never a member of the
organization it acts on), a change always carries a reason, and both are written to the audit log with
`actor_type = SUPERADMIN` (ADM §3). ADM-011 holds too: nothing here signs in as somebody else.
"""

from datetime import timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Select, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.audit import AuditLog
from app.core.errors import AppError
from app.core.outbox import OutboxEvent
from app.core.time import utcnow
from app.modules.auth.sessions import revoke_all_sessions
from app.modules.finance.models import ReconciliationIssue
from app.modules.identity.models import Membership, Organization, User
from app.modules.notifications.models import Notification, NotificationDelivery
from app.modules.orders.models import Order
from app.modules.organizations.service import load_profile
from app.modules.partnerships.models import Partnership
from app.modules.subscriptions.models import Plan, Subscription
from app.modules.verification.models import VerificationRequest

ORG_STATUSES = ("ACTIVE", "SUSPENDED", "BLOCKED")
#: P02 §2.2: the transitions a platform administrator may make, and only with a reason.
ALLOWED_ORG_TRANSITIONS = {
    ("ACTIVE", "SUSPENDED"),
    ("SUSPENDED", "ACTIVE"),
    ("ACTIVE", "BLOCKED"),
    ("SUSPENDED", "BLOCKED"),
    ("BLOCKED", "ACTIVE"),
}


def require_reason(reason: str | None) -> str:
    """§3 `override_reason_required`: an empty or token reason is refused before anything changes."""
    cleaned = (reason or "").strip()
    if len(cleaned) < 10:
        raise AppError("override_reason_required", 422, {"field": "reason"})
    return cleaned


async def _record(
    session: AsyncSession,
    admin: User,
    action: str,
    entity_type: str,
    entity_id: UUID,
    *,
    org_id: UUID | None = None,
    old: dict[str, Any] | None = None,
    new: dict[str, Any] | None = None,
    reason: str | None = None,
) -> None:
    await audit.record(
        session,
        action,
        entity_type,
        entity_id,
        actor_id=admin.id,
        org_id=org_id,
        old=old,
        new=new,
        reason=reason,
        actor_type="SUPERADMIN",
    )


async def _counts(session: AsyncSession, column: Any) -> dict[str, int]:
    rows = (await session.execute(select(column, func.count()).group_by(column))).all()
    return {str(row[0]): int(row[1]) for row in rows}


async def dashboard(session: AsyncSession) -> dict[str, Any]:
    """ADM-001: the numbers a platform administrator starts their day with."""
    # Grouped on the two columns and joined here: a concatenation in GROUP BY would travel as a bound parameter.
    rows = (
        await session.execute(
            select(Organization.type, Organization.status, func.count()).group_by(
                Organization.type, Organization.status
            )
        )
    ).all()
    organizations = {f"{row[0]}_{row[1]}": int(row[2]) for row in rows}
    subscriptions = await _counts(session, Subscription.status)
    mrr = await session.scalar(
        select(func.coalesce(func.sum(Plan.price_monthly), Decimal("0.00")))
        .select_from(Subscription)
        .join(Plan, Plan.id == Subscription.plan_id)
        .where(Subscription.status == "ACTIVE")
    )
    verifications = await session.scalar(
        select(func.count())
        .select_from(VerificationRequest)
        .where(VerificationRequest.status.in_(("SUBMITTED", "UNDER_REVIEW")))
    )
    outbox = await session.scalar(select(func.count()).select_from(OutboxEvent).where(OutboxEvent.status == "FAILED"))
    issues = await session.scalar(
        select(func.count()).select_from(ReconciliationIssue).where(ReconciliationIssue.resolved_at.is_(None))
    )
    failures = await session.scalar(
        select(func.count())
        .select_from(NotificationDelivery)
        .where(NotificationDelivery.status == "FAILED", NotificationDelivery.created_at >= utcnow() - timedelta(days=1))
    )
    return {
        "organizations": organizations,
        "subscriptions": subscriptions,
        "mrr": mrr or Decimal("0.00"),
        "verifications_pending": int(verifications or 0),
        "outbox_failed": int(outbox or 0),
        "reconciliation_issues": int(issues or 0),
        "notifications_failed_24h": int(failures or 0),
    }


# --- users (ADM-002) -------------------------------------------------------------------------------------------


async def memberships_of(session: AsyncSession, user_id: UUID) -> list[dict[str, Any]]:
    rows = await session.scalars(
        select(Membership).where(Membership.user_id == user_id).order_by(Membership.created_at)
    )
    return [
        {
            "user_id": row.user_id,
            "full_name": row.user.full_name,
            "organization_id": row.organization_id,
            "organization_name": row.organization.name,
            "organization_type": row.organization.type,
            "role": row.role,
            "status": row.status,
        }
        for row in rows
    ]


async def get_user(session: AsyncSession, user_id: UUID) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise AppError("not_found", 404)
    return user


async def set_user_status(session: AsyncSession, admin: User, user_id: UUID, status: str, reason: str | None) -> User:
    """IAM-009: blocking a user bumps `token_version`, so every live access token dies with the decision."""
    cleaned = require_reason(reason)
    user = await get_user(session, user_id)
    if user.is_superadmin:
        # A platform administrator is managed through the CLI, never through the API.
        raise AppError("permission_denied", 403)
    if user.status == status:
        raise AppError("invalid_transition", 409, {"from": user.status, "to": status})
    previous = user.status
    user.status = status
    if status == "BLOCKED":
        user.token_version += 1
        await revoke_all_sessions(session, user.id)
    await _record(
        session,
        admin,
        "user.blocked" if status == "BLOCKED" else "user.unblocked",
        "users",
        user.id,
        old={"status": previous},
        new={"status": status},
        reason=cleaned,
    )
    return user


async def logout_all(session: AsyncSession, admin: User, user_id: UUID, reason: str | None) -> User:
    """ADM-002: end every session of a user without blocking them."""
    cleaned = require_reason(reason)
    user = await get_user(session, user_id)
    user.token_version += 1
    await revoke_all_sessions(session, user.id)
    await _record(session, admin, "user.logout_all", "users", user.id, reason=cleaned)
    return user


# --- organizations (ADM-003) -----------------------------------------------------------------------------------


async def get_organization(session: AsyncSession, organization_id: UUID) -> Organization:
    organization = await session.get(Organization, organization_id)
    if organization is None:
        raise AppError("not_found", 404)
    return organization


async def organization_detail(session: AsyncSession, organization_id: UUID) -> dict[str, Any]:
    organization = await get_organization(session, organization_id)
    profile = await load_profile(session, organization)
    partnerships = await session.scalar(
        select(func.count())
        .select_from(Partnership)
        .where(
            Partnership.company_id == organization.id
            if organization.type == "COMPANY"
            else Partnership.store_id == organization.id
        )
    )
    subscription: dict[str, Any] | None = None
    if organization.type == "COMPANY":
        row = (
            await session.execute(
                select(Subscription, Plan.code)
                .join(Plan, Plan.id == Subscription.plan_id)
                .where(Subscription.company_id == organization.id)
            )
        ).first()
        if row is not None:
            subscription = {
                "status": row[0].status,
                "plan_code": row[1],
                "current_period_end": row[0].current_period_end,
            }
    return {
        "id": organization.id,
        "name": organization.name,
        "type": organization.type,
        "status": organization.status,
        "created_at": organization.created_at,
        "legal_name": profile.legal_name,
        "verification_status": profile.verification_status,
        "phone": profile.phone,
        "email": profile.email,
        "city": profile.city,
        "address": profile.address,
        "tax_identifier": profile.tax_identifier,
        "members": await memberships_of_organization(session, organization.id),
        "partnerships": int(partnerships or 0),
        "subscription": subscription,
        "version": organization.version,
    }


async def memberships_of_organization(session: AsyncSession, organization_id: UUID) -> list[dict[str, Any]]:
    rows = await session.scalars(
        select(Membership).where(Membership.organization_id == organization_id).order_by(Membership.joined_at)
    )
    return [
        {
            "user_id": row.user_id,
            "full_name": row.user.full_name,
            "organization_id": row.organization_id,
            "organization_name": row.organization.name,
            "organization_type": row.organization.type,
            "role": row.role,
            "status": row.status,
        }
        for row in rows
    ]


async def set_organization_status(
    session: AsyncSession, admin: User, organization_id: UUID, status: str, reason: str | None
) -> Organization:
    """P02 §2.2: ACTIVE <-> SUSPENDED, either into BLOCKED, and BLOCKED back to ACTIVE - SUPERADMIN only."""
    cleaned = require_reason(reason)
    organization = await _locked_organization(session, organization_id)
    if (organization.status, status) not in ALLOWED_ORG_TRANSITIONS:
        raise AppError("invalid_transition", 409, {"from": organization.status, "to": status})
    previous = organization.status
    organization.status = status
    organization.version += 1
    await _record(
        session,
        admin,
        f"organization.{status.lower()}",
        "organizations",
        organization.id,
        org_id=organization.id,
        old={"status": previous},
        new={"status": status},
        reason=cleaned,
    )
    return organization


async def _locked_organization(session: AsyncSession, organization_id: UUID) -> Organization:
    organization = await session.scalar(
        select(Organization)
        .where(Organization.id == organization_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if organization is None:
        raise AppError("not_found", 404)
    return organization


async def transfer_ownership(
    session: AsyncSession,
    admin: User,
    organization_id: UUID,
    user_id: UUID,
    previous_owner_role: str,
    reason: str | None,
) -> dict[str, Any]:
    """ADM-003: exactly one active OWNER at any time; the old one becomes a MANAGER or leaves."""
    cleaned = require_reason(reason)
    organization = await _locked_organization(session, organization_id)
    owner = await session.scalar(
        select(Membership)
        .where(
            Membership.organization_id == organization.id,
            Membership.role == "OWNER",
            Membership.status == "ACTIVE",
        )
        .with_for_update(of=Membership)
        .execution_options(populate_existing=True)
    )
    successor = await session.scalar(
        select(Membership)
        .where(
            Membership.organization_id == organization.id,
            Membership.user_id == user_id,
            Membership.status == "ACTIVE",
        )
        .with_for_update(of=Membership)
        .execution_options(populate_existing=True)
    )
    if successor is None:
        raise AppError("not_found", 404)
    if owner is not None and owner.id == successor.id:
        raise AppError("invalid_transition", 409, {"from": "OWNER", "to": "OWNER"})
    stays_as = "MANAGER" if organization.type == "COMPANY" else "SELLER"
    if owner is not None:
        # The old owner leaves the OWNER slot first: `uq_memberships_single_owner` tolerates no overlap.
        if previous_owner_role == "REVOKED":
            owner.role = stays_as
            owner.status = "REVOKED"
            owner.revoked_at = utcnow()
        else:
            owner.role = stays_as
        owner.version += 1
        await session.flush()
    successor.role = "OWNER"
    successor.version += 1
    try:
        await session.flush()
    except IntegrityError as exc:
        # uq_memberships_single_owner: a concurrent transfer won the race.
        raise AppError("version_conflict", 409) from exc
    await _record(
        session,
        admin,
        "organization.ownership_transferred",
        "organizations",
        organization.id,
        org_id=organization.id,
        old={"owner_user_id": str(owner.user_id) if owner else None},
        new={"owner_user_id": str(successor.user_id), "previous_owner_role": previous_owner_role},
        reason=cleaned,
    )
    return await organization_detail(session, organization.id)


async def update_legal(
    session: AsyncSession, admin: User, organization_id: UUID, payload: dict[str, Any], version: int, reason: str | None
) -> dict[str, Any]:
    """ADM-003 / ORG-005: the legal fields are locked for the tenant once verified; an admin may still fix them."""
    cleaned = require_reason(reason)
    organization = await _locked_organization(session, organization_id)
    if organization.version != version:
        raise AppError("version_conflict", 409, {"expected": organization.version})
    profile = await load_profile(session, organization, lock=True)
    changes = {key: value for key, value in payload.items() if value is not None}
    if not changes:
        raise AppError("validation_error", 422, {"field": "legal_name"})
    old = {key: getattr(profile, key) for key in changes}
    for key, value in changes.items():
        setattr(profile, key, value)
    profile.version += 1
    organization.version += 1
    try:
        await session.flush()
    except IntegrityError as exc:
        raise AppError("tax_identifier_taken", 409) from exc
    await _record(
        session,
        admin,
        "organization.legal_updated",
        "organizations",
        organization.id,
        org_id=organization.id,
        old=old,
        new=changes,
        reason=cleaned,
    )
    return await organization_detail(session, organization.id)


# --- operations (ADM-006 .. ADM-010) ---------------------------------------------------------------------------


async def retry_outbox(session: AsyncSession, admin: User, event_id: UUID, reason: str | None) -> OutboxEvent:
    """ADM-007: a failed event goes back to PENDING with a clean attempt counter."""
    cleaned = require_reason(reason)
    event = await session.scalar(
        select(OutboxEvent)
        .where(OutboxEvent.id == event_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if event is None:
        raise AppError("not_found", 404)
    if event.status != "FAILED":
        raise AppError("invalid_transition", 409, {"from": event.status, "to": "PENDING"})
    event.status = "PENDING"
    event.attempts = 0
    event.next_attempt_at = utcnow()
    event.last_error = None
    await _record(
        session,
        admin,
        "outbox.retried",
        "outbox_events",
        event.id,
        org_id=event.org_id,
        new={"event_type": event.event_type},
        reason=cleaned,
    )
    return event


def notification_failures_query() -> Select[Any]:
    """ADM-008 / NTF-004: the deliveries that gave up after three attempts."""
    return (
        select(
            NotificationDelivery.id,
            NotificationDelivery.notification_id,
            Notification.user_id,
            NotificationDelivery.channel,
            Notification.event_type,
            NotificationDelivery.attempts,
            NotificationDelivery.last_error,
            NotificationDelivery.created_at,
        )
        .join(Notification, Notification.id == NotificationDelivery.notification_id)
        .where(NotificationDelivery.status == "FAILED")
    )


def audit_query() -> Select[Any]:
    return select(AuditLog)


async def viewed(
    session: AsyncSession,
    admin: User,
    entity_type: str,
    entity_id: UUID,
    reason: str | None,
    org_id: UUID | None = None,
) -> None:
    """ADM-010: reading a tenant's business data is itself an audited act, and it needs a short reason."""
    await _record(session, admin, "admin.viewed", entity_type, entity_id, org_id=org_id, reason=require_reason(reason))


async def organization_orders_query(session: AsyncSession, organization_id: UUID) -> Select[Any]:
    """ADM-010: read-only. A platform administrator never creates or changes a tenant's order."""
    organization = await get_organization(session, organization_id)
    column = Order.company_id if organization.type == "COMPANY" else Order.store_id
    return select(Order).where(column == organization.id)


async def partnership_of(session: AsyncSession, partnership_id: UUID) -> Partnership:
    partnership = await session.get(Partnership, partnership_id)
    if partnership is None:
        raise AppError("not_found", 404)
    return partnership
