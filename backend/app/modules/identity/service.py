from __future__ import annotations

from uuid import UUID

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.errors import AppError
from app.core.permissions import permissions_for
from app.modules.files import images
from app.modules.files.images import active_image_urls
from app.modules.identity.filters import MemberQuery
from app.modules.identity.models import Membership, User
from app.modules.identity.schemas import MemberOut, MemberPage, MembershipOut, MeResponse, MeUpdateRequest, Onboarding


async def visible_memberships(session: AsyncSession, user: User) -> list[Membership]:
    """ACTIVE and SUSPENDED memberships; REVOKED is final and hidden (P01 §3.1)."""
    result = await session.execute(
        select(Membership)
        .where(Membership.user_id == user.id, Membership.status != "REVOKED")
        .order_by(Membership.joined_at)
    )
    return list(result.scalars().unique())


def membership_out(
    membership: Membership, verification_status: str | None = None, logo_url: str | None = None
) -> MembershipOut:
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
        verification_status=verification_status,
        logo_url=logo_url,
    )


async def _org_profiles(session: AsyncSession, memberships: list[Membership]) -> dict[object, tuple[str, UUID | None]]:
    """P02 verification status and CR-003 logo file per organization (one query per profile table)."""
    from app.modules.organizations.models import Company, Store

    ids = [membership.organization_id for membership in memberships]
    if not ids:
        return {}
    profiles: dict[object, tuple[str, UUID | None]] = {}
    for model in (Company, Store):
        rows = await session.execute(
            select(model.id, model.verification_status, model.logo_file_id).where(model.id.in_(ids))
        )
        profiles.update({org_id: (status, logo_id) for org_id, status, logo_id in rows})
    return profiles


async def build_me(session: AsyncSession, user: User) -> MeResponse:
    memberships = await visible_memberships(session, user)
    profiles = await _org_profiles(session, memberships)
    # CR-003: signed only for active files (a retired image never gets a URL), 5 minutes (SEC-008).
    urls = await active_image_urls(session, [user.avatar_file_id, *(logo for _, logo in profiles.values())])

    def _membership(membership: Membership) -> MembershipOut:
        status, logo_id = profiles.get(membership.organization_id, (None, None))
        return membership_out(membership, status, urls.get(logo_id) if logo_id else None)

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
        avatar_url=urls.get(user.avatar_file_id) if user.avatar_file_id else None,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        memberships=[_membership(m) for m in memberships],
        onboarding=Onboarding(org_type=user.onboarding_org_type, org_name=user.onboarding_org_name),  # type: ignore[arg-type]
    )


async def _ensure_phone_free(session: AsyncSession, user: User, phone: str) -> None:
    taken = await session.execute(select(User.id).where(User.phone == phone, User.id != user.id).limit(1))
    if taken.first() is not None:
        raise AppError("phone_taken", 409)


async def update_me(session: AsyncSession, user: User, payload: MeUpdateRequest) -> MeResponse:
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    # CR-003: an explicit `phone: null` (or "", normalised to None) clears the contact phone; omitted leaves it as is.
    if "phone" in payload.model_fields_set:
        changes["phone"] = payload.phone
    if not changes:
        return await build_me(session, user)
    if changes.get("phone") is not None:
        await _ensure_phone_free(session, user, changes["phone"])

    old = {field: getattr(user, field) for field in changes}
    # Savepoint: if a concurrent request takes the same phone first, the unique constraint decides and this request
    # answers 409 phone_taken instead of failing with a 500.
    savepoint = await session.begin_nested()
    for field, value in changes.items():
        setattr(user, field, value)
    try:
        await session.flush()
    except IntegrityError as exc:
        await savepoint.rollback()
        if "uq_users_phone" in str(exc.orig):
            raise AppError("phone_taken", 409) from exc
        raise
    await savepoint.commit()
    await audit.record(session, "user.updated", "user", user.id, actor_id=user.id, old=old, new=changes)
    await session.flush()
    return await build_me(session, user)


async def set_avatar(session: AsyncSession, user: User, upload_file: UploadFile) -> MeResponse:
    """CR-003 `PUT /me/avatar`: always the caller's own avatar - no user id is taken from the request."""
    content_type, raw = await images.read_upload(upload_file)
    image = images.normalize_image(content_type, raw)
    await images.swap_profile_image(
        session,
        holder_model=User,
        holder_id=user.id,
        category="USER_AVATAR",
        image=image,
        filename=upload_file.filename,
        actor_id=user.id,
    )
    return await build_me(session, user)


async def remove_avatar(session: AsyncSession, user: User) -> MeResponse:
    """CR-003 `DELETE /me/avatar`: idempotent - without an avatar nothing changes and the profile is returned."""
    await images.swap_profile_image(
        session,
        holder_model=User,
        holder_id=user.id,
        category="USER_AVATAR",
        image=None,
        filename=None,
        actor_id=user.id,
    )
    return await build_me(session, user)


async def list_members(
    session: AsyncSession,
    organization_id: object,
    query: MemberQuery,
) -> MemberPage:
    """GET /members (P01 §6): the organization's memberships through `MemberQuery` (FND-011 filters and search,
    FND-009 page). The membership id breaks ties, so members who joined at the same moment keep one order."""
    base = (
        select(Membership)
        .join(User, Membership.user_id == User.id)
        .where(Membership.organization_id == organization_id)
    )
    total, rows = await query.fetch(session, base, tie_breaker=Membership.id)
    return MemberPage.of(
        query.page,
        total,
        [
            MemberOut(
                id=m.id,
                user_id=m.user_id,
                full_name=m.user.full_name,
                email=m.user.email,
                phone=m.user.phone,
                role=m.role,
                status=m.status,
                joined_at=m.joined_at,
                version=m.version,
            )
            for m in rows.scalars().unique()
        ],
    )
