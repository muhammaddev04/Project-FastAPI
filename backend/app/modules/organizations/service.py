from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.errors import AppError
from app.core.time import utcnow
from app.modules.identity.models import Membership, Organization, User
from app.modules.identity.service import membership_out
from app.modules.organizations.schemas import OrganizationCreate, OrganizationCreated, OrganizationOut

MAX_OWNED_ORGANIZATIONS = 5  # ORG-003


async def create_organization(
    session: AsyncSession, user: User, org_type: str, payload: OrganizationCreate
) -> OrganizationCreated:
    """ORG-001 / ORG-002: organization + ACTIVE OWNER membership in one transaction, both audited."""
    owned = (
        await session.execute(
            select(func.count())
            .select_from(Membership)
            .where(Membership.user_id == user.id, Membership.role == "OWNER", Membership.status == "ACTIVE")
        )
    ).scalar_one()
    if owned >= MAX_OWNED_ORGANIZATIONS:
        raise AppError("organization_limit_reached", 409, {"max": MAX_OWNED_ORGANIZATIONS, "current": owned})

    organization = Organization(type=org_type, name=payload.name, created_by=user.id)
    session.add(organization)
    await session.flush()
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
        new={"type": org_type, "name": organization.name},
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
    return OrganizationCreated(
        organization=OrganizationOut(
            id=organization.id,
            type=org_type,
            name=organization.name,
            status=organization.status,  # type: ignore[arg-type]
        ),
        membership=membership_out(membership),
    )
