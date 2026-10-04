"""P01 team and invitation transitions. Organization locks serialize membership limits and uniqueness."""

from datetime import timedelta
from html import escape
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.config import get_settings
from app.core.email import EmailDeliveryError, OutgoingEmail, send_email
from app.core.errors import AppError
from app.core.events import DomainEvent, event_bus
from app.core.i18n import translate
from app.core.pagination import PageParams, fetch_page
from app.core.time import utcnow
from app.modules.identity import ports
from app.modules.identity.deps import OrgContext
from app.modules.identity.models import ROLES_BY_ORG_TYPE, Membership, MembershipInvitation, Organization, User
from app.modules.identity.schemas import (
    InvitationCreate,
    InvitationOut,
    InvitationPage,
    MemberOut,
    MembershipOut,
    RoleChange,
)
from app.modules.identity.service import membership_out


def invitation_out(invitation: MembershipInvitation) -> InvitationOut:
    return InvitationOut(
        id=invitation.id,
        organization_id=invitation.organization_id,
        org_name=invitation.organization.name,
        org_type=invitation.organization.type,
        email=invitation.email,
        role=invitation.role,
        status=invitation.status,
        invited_by=invitation.invited_by,
        created_at=invitation.created_at,
        expires_at=invitation.expires_at,
        responded_at=invitation.responded_at,
    )


def member_out(member: Membership) -> MemberOut:
    return MemberOut(
        id=member.id,
        user_id=member.user_id,
        full_name=member.user.full_name,
        email=member.user.email,
        phone=member.user.phone,
        role=member.role,
        status=member.status,
        joined_at=member.joined_at,
        version=member.version,
    )


def validate_role(org: Organization, role: str) -> None:
    if role == "OWNER" or role not in ROLES_BY_ORG_TYPE[org.type]:
        raise AppError("permission_denied", 403)


def require_owner(context: OrgContext) -> None:
    if context.membership.role != "OWNER":
        raise AppError("permission_denied", 403)


async def lock_org(session: AsyncSession, org_id: UUID) -> Organization:
    org = (
        await session.scalars(
            select(Organization)
            .where(Organization.id == org_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).one_or_none()
    if org is None:
        raise AppError("not_found", 404)
    if org.status == "BLOCKED":
        raise AppError("organization_blocked", 403)
    return org


async def expire_invitations(session: AsyncSession, org_id: UUID | None = None) -> int:
    query = update(MembershipInvitation).where(
        MembershipInvitation.status == "PENDING", MembershipInvitation.expires_at <= utcnow()
    )
    if org_id:
        query = query.where(MembershipInvitation.organization_id == org_id)
    result = await session.execute(
        query.values(status="EXPIRED", responded_at=utcnow()).returning(
            MembershipInvitation.id, MembershipInvitation.organization_id
        )
    )
    expired = result.all()
    for invitation_id, organization_id in expired:
        await audit.record(session, "invitation.expired", "invitation", invitation_id, org_id=organization_id)
    return len(expired)


async def list_invitations(
    session: AsyncSession, page: PageParams, *, org_id: UUID | None = None, email: str | None = None
) -> InvitationPage:
    query = select(MembershipInvitation)
    if org_id:
        query = query.where(MembershipInvitation.organization_id == org_id)
    if email:
        query = query.where(
            func.lower(MembershipInvitation.email) == email.lower(),
            MembershipInvitation.status == "PENDING",
            MembershipInvitation.expires_at > utcnow(),
        )
    count, rows = await fetch_page(
        session, query, page, order_by=[MembershipInvitation.created_at.desc()], tie_breaker=MembershipInvitation.id
    )
    return InvitationPage.of(page, count, [invitation_out(row) for row in rows.scalars().unique()])


async def invite(session: AsyncSession, context: OrgContext, payload: InvitationCreate) -> InvitationOut:
    require_owner(context)
    org = await lock_org(session, context.organization.id)
    validate_role(org, payload.role)
    await expire_invitations(session, org.id)
    existing = (
        await session.scalars(
            select(MembershipInvitation).where(
                MembershipInvitation.organization_id == org.id,
                func.lower(MembershipInvitation.email) == str(payload.email).lower(),
                MembershipInvitation.status == "PENDING",
            )
        )
    ).first()
    if existing:
        raise AppError("invitation_invalid", 422)
    member = (
        await session.scalars(
            select(Membership.id)
            .join(User, Membership.user_id == User.id)
            .where(
                Membership.organization_id == org.id,
                Membership.status != "REVOKED",
                func.lower(User.email) == str(payload.email).lower(),
            )
        )
    ).first()
    if member:
        raise AppError("membership_already_exists", 409)
    invitation = MembershipInvitation(
        organization_id=org.id,
        organization=org,
        email=str(payload.email).lower(),
        role=payload.role,
        invited_by=context.user.id,
        expires_at=utcnow() + timedelta(days=7),
    )
    session.add(invitation)
    await session.flush()
    await audit.record(
        session,
        "invitation.created",
        "invitation",
        invitation.id,
        actor_id=context.user.id,
        org_id=org.id,
        new={"role": invitation.role},
    )
    await event_bus.publish(
        session,
        DomainEvent(
            "INVITATION_CREATED",
            {
                "invitation_id": str(invitation.id),
                "organization_id": str(org.id),
                "role": invitation.role,
            },
            org.id,
        ),
    )
    recipient = (await session.scalars(select(User).where(func.lower(User.email) == invitation.email))).first()
    language = recipient.language if recipient else context.user.language
    subject = translate("invitations.email.subject", language, org=org.name)
    text = translate("invitations.email.text", language, org=org.name, role=payload.role)
    url = f"{get_settings().frontend_base_url.rstrip('/')}/invitations"
    try:
        await send_email(
            OutgoingEmail(
                invitation.email,
                subject,
                f"{text}\n\n{url}",
                f"<p>{escape(text)}</p><p><a href='{escape(url, quote=True)}'>{escape(url)}</a></p>",
                "membership_invitation",
            )
        )
    except EmailDeliveryError as exc:
        raise AppError("service_unavailable", 503) from exc
    return invitation_out(invitation)


async def locked_invitation(
    session: AsyncSession, invitation_id: UUID, *, org_id: UUID | None = None
) -> MembershipInvitation:
    query = select(MembershipInvitation).where(MembershipInvitation.id == invitation_id)
    if org_id:
        query = query.where(MembershipInvitation.organization_id == org_id)
    invitation = (await session.scalars(query)).one_or_none()
    if invitation is None:
        raise AppError("not_found", 404)
    await lock_org(session, invitation.organization_id)
    invitation = (
        await session.scalars(query.with_for_update(of=MembershipInvitation).execution_options(populate_existing=True))
    ).one()
    if invitation.status != "PENDING" or invitation.expires_at <= utcnow():
        raise AppError("invitation_invalid", 422)
    return invitation


async def respond(
    session: AsyncSession, user: User, invitation_id: UUID, accept: bool
) -> MembershipOut | InvitationOut:
    invitation = await locked_invitation(session, invitation_id)
    if invitation.email.lower() != user.email.lower():
        raise AppError("invitation_email_mismatch", 403)
    if user.email_verified_at is None:
        raise AppError("email_not_verified", 403)
    membership: Membership | None = None
    if accept:
        existing = (
            await session.scalars(
                select(Membership.id).where(
                    Membership.user_id == user.id,
                    Membership.organization_id == invitation.organization_id,
                    Membership.status != "REVOKED",
                )
            )
        ).first()
        if existing:
            raise AppError("membership_already_exists", 409)
        validate_role(invitation.organization, invitation.role)
        await ports.subscription_guard.check_limit(session, invitation.organization_id, "users")
        membership = Membership(
            user_id=user.id,
            user=user,
            organization=invitation.organization,
            organization_id=invitation.organization_id,
            role=invitation.role,
            joined_at=utcnow(),
            invited_by=invitation.invited_by,
        )
        session.add(membership)
        await session.flush()
        await audit.record(
            session,
            "membership.created",
            "membership",
            membership.id,
            actor_id=user.id,
            org_id=invitation.organization_id,
            new={"role": membership.role},
        )
        await event_bus.publish(
            session,
            DomainEvent(
                "MEMBERSHIP_CREATED",
                {
                    "membership_id": str(membership.id),
                    "user_id": str(user.id),
                    "role": membership.role,
                },
                invitation.organization_id,
            ),
        )
    invitation.status = "ACCEPTED" if accept else "DECLINED"
    invitation.responded_at = utcnow()
    await audit.record(
        session,
        "invitation.accepted" if accept else "invitation.declined",
        "invitation",
        invitation.id,
        actor_id=user.id,
        org_id=invitation.organization_id,
    )
    await session.flush()
    return membership_out(membership) if membership else invitation_out(invitation)


async def revoke_invitation(session: AsyncSession, context: OrgContext, invitation_id: UUID) -> InvitationOut:
    require_owner(context)
    invitation = await locked_invitation(session, invitation_id, org_id=context.organization.id)
    invitation.status, invitation.responded_at = "REVOKED", utcnow()
    await audit.record(
        session,
        "invitation.revoked",
        "invitation",
        invitation.id,
        actor_id=context.user.id,
        org_id=context.organization.id,
    )
    await session.flush()
    return invitation_out(invitation)


async def locked_member(session: AsyncSession, context: OrgContext, member_id: UUID) -> Membership:
    await lock_org(session, context.organization.id)
    member = (
        await session.scalars(
            select(Membership)
            .where(Membership.id == member_id, Membership.organization_id == context.organization.id)
            .with_for_update(of=Membership)
            .execution_options(populate_existing=True)
        )
    ).one_or_none()
    if member is None:
        raise AppError("not_found", 404)
    return member


async def change_role(session: AsyncSession, context: OrgContext, member_id: UUID, payload: RoleChange) -> MemberOut:
    require_owner(context)
    member = await locked_member(session, context, member_id)
    if member.user_id == context.user.id:
        raise AppError("self_role_change_forbidden", 403)
    if member.role == "OWNER":
        raise AppError("permission_denied", 403)
    validate_role(context.organization, payload.role)
    if member.status == "REVOKED":
        raise AppError("invalid_transition", 409, {"from": member.status, "to": "ROLE_CHANGED"})
    if member.version != payload.version:
        raise AppError("version_conflict", 409)
    old_role = member.role
    member.role, member.version = payload.role, member.version + 1
    await audit.record(
        session,
        "membership.role_changed",
        "membership",
        member.id,
        actor_id=context.user.id,
        org_id=member.organization_id,
        old={"role": old_role},
        new={"role": member.role},
    )
    await event_bus.publish(
        session,
        DomainEvent(
            "MEMBERSHIP_ROLE_CHANGED",
            {
                "membership_id": str(member.id),
                "role": member.role,
                "old_role": old_role,
            },
            member.organization_id,
        ),
    )
    await session.flush()
    return member_out(member)


async def transition_member(
    session: AsyncSession, context: OrgContext, member_id: UUID, action: str, reason: str | None = None
) -> MemberOut:
    member = await locked_member(session, context, member_id)
    if member.role == "OWNER":
        raise AppError("permission_denied", 403)
    if action == "leave" and member.user_id != context.user.id:
        raise AppError("permission_denied", 403)
    if action != "leave" and context.membership.role != "OWNER":
        raise AppError("permission_denied", 403)
    target, allowed, audit_action = {
        "suspend": ("SUSPENDED", {"ACTIVE"}, "membership.suspended"),
        "reactivate": ("ACTIVE", {"SUSPENDED"}, "membership.reactivated"),
        "revoke": ("REVOKED", {"ACTIVE", "SUSPENDED"}, "membership.revoked"),
        "leave": ("REVOKED", {"ACTIVE"}, "membership.left"),
    }[action]
    if member.status not in allowed:
        raise AppError("invalid_transition", 409, {"from": member.status, "to": target})
    if action == "reactivate":
        await ports.subscription_guard.check_limit(session, member.organization_id, "users")
    old_status = member.status
    member.status, member.version = target, member.version + 1
    if target == "SUSPENDED":
        member.suspended_at = utcnow()
    elif target == "ACTIVE":
        member.suspended_at = None
    else:
        member.revoked_at = utcnow()
    await audit.record(
        session,
        audit_action,
        "membership",
        member.id,
        actor_id=context.user.id,
        org_id=member.organization_id,
        old={"status": old_status},
        new={"status": target},
        reason=reason,
    )
    if target == "REVOKED":
        await event_bus.publish(
            session,
            DomainEvent(
                "MEMBERSHIP_REVOKED",
                {
                    "membership_id": str(member.id),
                    "user_id": str(member.user_id),
                },
                member.organization_id,
            ),
        )
    await session.flush()
    return member_out(member)
