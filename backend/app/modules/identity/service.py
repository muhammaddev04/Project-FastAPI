from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.permissions import permissions_for
from app.modules.identity.models import Membership, User
from app.modules.identity.schemas import MemberOut, MemberPage, MembershipOut, MeResponse, MeUpdateRequest


async def visible_memberships(session: AsyncSession, user: User) -> list[Membership]:
    """ACTIVE and SUSPENDED memberships; REVOKED is final and hidden (P01 §3.1)."""
    result = await session.execute(
        select(Membership)
        .where(Membership.user_id == user.id, Membership.status != "REVOKED")
        .order_by(Membership.joined_at)
    )
    return list(result.scalars().unique())


def membership_out(membership: Membership) -> MembershipOut:
    org = membership.organization
    usable = membership.status == "ACTIVE" and org.status != "BLOCKED"
    return MembershipOut(
        id=membership.id,
        organization_id=org.id,
        org_type=org.type,  # type: ignore[arg-type]
        org_name=org.name,
        org_status=org.status,
        role=membership.role,
        status=membership.status,
        joined_at=membership.joined_at,
        permissions=sorted(permissions_for(org.type, membership.role)) if usable else [],
    )


async def build_me(session: AsyncSession, user: User) -> MeResponse:
    memberships = await visible_memberships(session, user)
    return MeResponse(
        id=user.id,
        phone=user.phone,
        full_name=user.full_name,
        email=user.email,
        email_verified=user.email_verified_at is not None,
        language=user.language,  # type: ignore[arg-type]
        status=user.status,
        is_superadmin=user.is_superadmin,
        phone_verified_at=user.phone_verified_at,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        memberships=[membership_out(m) for m in memberships],
    )


async def update_me(session: AsyncSession, user: User, payload: MeUpdateRequest) -> MeResponse:
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    old = {field: getattr(user, field) for field in changes}
    for field, value in changes.items():
        setattr(user, field, value)
    if changes:
        await audit.record(session, "user.updated", "user", user.id, actor_id=user.id, old=old, new=changes)
        await session.flush()
    return await build_me(session, user)


async def list_members(
    session: AsyncSession,
    organization_id: object,
    *,
    role: str | None,
    status: str | None,
    search: str | None,
    limit: int,
    offset: int,
) -> MemberPage:
    """GET /members (P01 §6): filter role/status, search full_name/phone, API-002 pagination."""
    query = (
        select(Membership)
        .join(User, Membership.user_id == User.id)
        .where(Membership.organization_id == organization_id)
    )
    if role:
        query = query.where(Membership.role == role)
    if status:
        query = query.where(Membership.status == status)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.where(or_(User.full_name.ilike(pattern), User.phone.ilike(pattern)))
    total = (await session.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    rows = (await session.execute(query.order_by(Membership.joined_at).limit(limit).offset(offset))).scalars().unique()
    return MemberPage(
        count=total,
        limit=limit,
        offset=offset,
        results=[
            MemberOut(
                id=m.id,
                user_id=m.user_id,
                full_name=m.user.full_name,
                phone=m.user.phone,
                role=m.role,
                status=m.status,
                joined_at=m.joined_at,
            )
            for m in rows
        ],
    )
