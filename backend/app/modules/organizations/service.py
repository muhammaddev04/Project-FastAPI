from __future__ import annotations

import secrets
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.errors import AppError
from app.core.time import utcnow
from app.modules.identity.deps import OrgContext
from app.modules.identity.models import Membership, Organization, User
from app.modules.identity.service import membership_out
from app.modules.organizations.models import Company, Store
from app.modules.organizations.schemas import (
    CompanyCreate,
    OrganizationCreated,
    OrganizationProfile,
    OrganizationUpdate,
    StoreCreate,
)

MAX_OWNED_ORGANIZATIONS = 5  # ORG-003
PUBLIC_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # P02 §1.1: A-Z and 2-9 without 0, O, 1, I
LEGAL_FIELDS = ("legal_name", "tax_identifier")
CONTACT_FIELDS = ("phone", "email", "city", "address", "latitude", "longitude")


def _public_code() -> str:
    return "".join(secrets.choice(PUBLIC_CODE_ALPHABET) for _ in range(8))


async def _unique_public_code(session: AsyncSession) -> str:
    """ORG-001: generated with retry on collision (checked before insert; the UNIQUE constraint is the backstop)."""
    for _ in range(10):
        code = _public_code()
        taken = (await session.execute(select(Company.id).where(Company.public_code == code))).first()
        if taken is None:
            return code
    raise AppError("internal_error", 500)


async def _ensure_tax_identifier_free(
    session: AsyncSession, model: type[Company] | type[Store], value: str | None, own_id: UUID | None = None
) -> None:
    """ORG-004: unique tax identifier -> 409 tax_identifier_taken."""
    if value is None:
        return
    query = select(model.id).where(model.tax_identifier == value)
    if own_id is not None:
        query = query.where(model.id != own_id)
    if (await session.execute(query)).first() is not None:
        raise AppError("tax_identifier_taken", 409)


def profile_out(organization: Organization, profile: Company | Store) -> OrganizationProfile:
    return OrganizationProfile(
        id=organization.id,
        type=organization.type,  # type: ignore[arg-type]
        name=organization.name,
        status=organization.status,
        legal_name=profile.legal_name,
        tax_identifier=profile.tax_identifier,
        public_code=profile.public_code if isinstance(profile, Company) else None,
        phone=profile.phone,
        email=profile.email,
        city=profile.city,
        address=profile.address,
        latitude=getattr(profile, "latitude", None),
        longitude=getattr(profile, "longitude", None),
        verification_status=profile.verification_status,  # type: ignore[arg-type]
        verified_at=profile.verified_at,
        legal_locked=profile.verification_status == "APPROVED",
        version=profile.version,
    )


async def load_profile(session: AsyncSession, organization: Organization) -> Company | Store:
    model: type[Company] | type[Store] = Company if organization.type == "COMPANY" else Store
    profile = await session.get(model, organization.id)
    if profile is None:  # every organization is created together with its profile
        raise AppError("not_found", 404)
    return profile


async def create_organization(
    session: AsyncSession, user: User, org_type: str, payload: CompanyCreate | StoreCreate
) -> OrganizationCreated:
    """ORG-001 / ORG-002: organization + profile + ACTIVE OWNER membership in one transaction, audited."""
    owned = (
        await session.execute(
            select(func.count())
            .select_from(Membership)
            .where(Membership.user_id == user.id, Membership.role == "OWNER", Membership.status == "ACTIVE")
        )
    ).scalar_one()
    if owned >= MAX_OWNED_ORGANIZATIONS:
        raise AppError("organization_limit_reached", 409, {"max": MAX_OWNED_ORGANIZATIONS, "current": owned})

    model: type[Company] | type[Store] = Company if org_type == "COMPANY" else Store
    await _ensure_tax_identifier_free(session, model, payload.tax_identifier)
    if isinstance(payload, StoreCreate) and (payload.latitude is None) != (payload.longitude is None):
        raise AppError("invalid_coordinates", 422)

    organization = Organization(type=org_type, name=payload.name, created_by=user.id)
    session.add(organization)
    await session.flush()

    common: dict[str, Any] = {
        "id": organization.id,
        "legal_name": payload.legal_name,
        "tax_identifier": payload.tax_identifier,
        "phone": payload.phone,
        "email": str(payload.email) if payload.email else None,
        "city": payload.city,
        "address": payload.address,
    }
    profile: Company | Store
    if isinstance(payload, CompanyCreate):
        profile = Company(**common, public_code=await _unique_public_code(session))
    else:
        profile = Store(**common, latitude=payload.latitude, longitude=payload.longitude)
    session.add(profile)

    membership = Membership(user_id=user.id, organization_id=organization.id, role="OWNER", joined_at=utcnow())
    session.add(membership)
    await session.flush()
    membership.organization = organization

    await audit.record(
        session,
        "organization.created",
        "organization",
        organization.id,
        actor_id=user.id,
        org_id=organization.id,
        new={"type": org_type, "name": organization.name, "city": payload.city},
    )
    await audit.record(
        session,
        "membership.created",
        "membership",
        membership.id,
        actor_id=user.id,
        org_id=organization.id,
        new={"role": "OWNER", "user_id": str(user.id)},
    )
    return OrganizationCreated(organization=profile_out(organization, profile), membership=membership_out(membership))


async def get_profile(session: AsyncSession, context: OrgContext) -> OrganizationProfile:
    return profile_out(context.organization, await load_profile(session, context.organization))


async def update_profile(
    session: AsyncSession, context: OrgContext, payload: OrganizationUpdate
) -> OrganizationProfile:
    """ORG-005 / ORG-006: owners edit everything (legal fields only until APPROVED); managers edit contacts only."""
    organization = context.organization
    if organization.status != "ACTIVE":
        raise AppError("organization_blocked", 403)
    profile = await load_profile(session, organization)
    changes = payload.model_dump(exclude_unset=True, exclude={"version"})
    if not changes:
        return profile_out(organization, profile)
    if payload.version != profile.version:
        raise AppError("version_conflict", 409, {"current_version": profile.version})

    permissions = context.permissions
    touches_legal = any(field in changes for field in LEGAL_FIELDS) or "name" in changes
    touches_contacts = any(field in changes for field in CONTACT_FIELDS)
    if touches_legal and "org.edit_legal" not in permissions:
        raise AppError("permission_denied", 403)
    if touches_contacts and "org.edit_contacts" not in permissions:
        raise AppError("permission_denied", 403)
    if any(field in changes for field in LEGAL_FIELDS) and profile.verification_status == "APPROVED":
        raise AppError("verification_not_editable", 409)
    if isinstance(profile, Company) and ("latitude" in changes or "longitude" in changes):
        raise AppError(
            "validation_error", 422, {"fields": [{"field": "latitude", "code": "extra_forbidden", "message": ""}]}
        )
    if isinstance(profile, Company) and "tax_identifier" in changes and changes["tax_identifier"] is None:
        raise AppError(
            "validation_error", 422, {"fields": [{"field": "tax_identifier", "code": "missing", "message": ""}]}
        )
    if "tax_identifier" in changes:
        await _ensure_tax_identifier_free(session, type(profile), changes["tax_identifier"], own_id=profile.id)
    if isinstance(profile, Store):
        latitude = changes.get("latitude", profile.latitude)
        longitude = changes.get("longitude", profile.longitude)
        if (latitude is None) != (longitude is None):
            raise AppError("invalid_coordinates", 422)

    old = {field: str(getattr(organization if field == "name" else profile, field)) for field in changes}
    for field, value in changes.items():
        if field == "name":
            organization.name = value
            organization.version += 1
        else:
            setattr(profile, field, str(value) if field == "email" and value else value)
    profile.version += 1
    await session.flush()
    await audit.record(
        session,
        "organization.updated",
        "organization",
        organization.id,
        actor_id=context.user.id,
        org_id=organization.id,
        old=old,
        new={field: str(value) for field, value in changes.items()},
    )
    return profile_out(organization, profile)
