from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.errors import AppError
from app.core.permissions import permissions_for
from app.core.rate_limit import DEFAULT_AUTHENTICATED, hit
from app.core.security import TokenError, decode_access_token
from app.modules.identity.models import Membership, Organization, User

_bearer = HTTPBearer(auto_error=False)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def get_current_user(
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    """SEC-001 step 1 / IAM-005: valid access JWT, existing ACTIVE user, matching token_version."""
    if credentials is None:
        raise AppError("not_authenticated", 401)
    try:
        claims = decode_access_token(credentials.credentials)
        user_id = UUID(str(claims["sub"]))
    except TokenError as exc:
        raise AppError(exc.code, 401) from exc
    except ValueError as exc:
        raise AppError("token_invalid", 401) from exc
    user = await session.get(User, user_id)
    if user is None or claims.get("tv") != user.token_version:
        raise AppError("token_invalid", 401)
    if user.status != "ACTIVE":
        raise AppError("user_blocked", 403)
    await hit(DEFAULT_AUTHENTICATED, str(user.id))
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


@dataclass(frozen=True)
class OrgContext:
    user: User
    membership: Membership
    organization: Organization

    @property
    def permissions(self) -> frozenset[str]:
        return permissions_for(self.organization.type, self.membership.role)


async def get_org_context(
    session: SessionDep,
    user: CurrentUser,
    x_org_id: Annotated[str | None, Header(alias="X-Org-Id")] = None,
) -> OrgContext:
    """SEC-001 steps 2-3 / IAM-010, IAM-014: re-checked on every request, never cached."""
    if not x_org_id:
        raise AppError("org_context_required", 400)
    try:
        org_id = UUID(x_org_id)
    except ValueError as exc:
        raise AppError("not_found", 404) from exc
    membership = (
        await session.execute(
            select(Membership)
            .where(Membership.user_id == user.id, Membership.organization_id == org_id)
            .order_by(Membership.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if membership is None:
        # SEC-007: another tenant's organization is indistinguishable from a missing one.
        raise AppError("not_found", 404)
    if membership.status != "ACTIVE":
        raise AppError("membership_inactive", 403)
    if membership.organization.status == "BLOCKED":
        raise AppError("organization_blocked", 403)
    return OrgContext(user=user, membership=membership, organization=membership.organization)


OrgContextDep = Annotated[OrgContext, Depends(get_org_context)]


def require_permission(code: str) -> type[OrgContext]:
    """P01 §5 `require(permission)`: 403 permission_denied when the active role lacks `code`."""

    async def dependency(context: OrgContextDep) -> OrgContext:
        if code not in context.permissions:
            raise AppError("permission_denied", 403)
        return context

    return Annotated[OrgContext, Depends(dependency)]  # type: ignore[return-value]
