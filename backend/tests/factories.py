"""Test fixtures only. Real sessions are issued by the (deferred) P01 session service, never by these helpers."""

from __future__ import annotations

from datetime import timedelta
from itertools import count

import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password
from app.core.time import new_id, utcnow
from app.modules.identity.models import Membership, Organization, User

_phones = count(900_000_001)


async def make_user(
    session: AsyncSession, *, full_name: str = "Test User", status: str = "ACTIVE", **extra: object
) -> User:
    user = User(
        phone=f"+992{next(_phones)}",
        full_name=full_name,
        password_hash=hash_password("Tezfarmo2026"),
        phone_verified_at=utcnow(),
        status=status,
        **extra,
    )
    session.add(user)
    await session.flush()
    return user


async def make_org(session: AsyncSession, owner: User, org_type: str = "COMPANY", name: str = "Org") -> Organization:
    org = Organization(type=org_type, name=name, created_by=owner.id)
    session.add(org)
    await session.flush()
    session.add(Membership(user_id=owner.id, organization_id=org.id, role="OWNER", joined_at=utcnow()))
    await session.flush()
    return org


async def add_member(
    session: AsyncSession, org: Organization, user: User, role: str, status: str = "ACTIVE"
) -> Membership:
    membership = Membership(user_id=user.id, organization_id=org.id, role=role, status=status, joined_at=utcnow())
    session.add(membership)
    await session.flush()
    return membership


def token_for(user: User, *, ttl: timedelta = timedelta(minutes=15), token_version: int | None = None) -> str:
    """Sign a fixture access token with the configured test secret (IAM-005 claim layout)."""
    now = utcnow()
    claims = {
        "sub": str(user.id),
        "sid": str(new_id()),
        "tv": user.token_version if token_version is None else token_version,
        "typ": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
    }
    return jwt.encode(claims, get_settings().jwt_access_secret, algorithm="HS256")


def auth(user: User, org: Organization | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token_for(user)}"}
    if org is not None:
        headers["X-Org-Id"] = str(org.id)
    return headers
