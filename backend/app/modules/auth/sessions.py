"""Login sessions (P01 §2.3, IAM-005..007, SEC-003..005).

A login starts a refresh-token family: one `refresh_tokens` row (its `id` is the refresh JWT's `jti`, only the
token's SHA-256 is stored), an access token whose `sid` is the family, and a CSRF value for the double-submit
check that refresh and logout require. Raw tokens are handed to the caller once and never persisted or logged.

Refresh rotates inside the family: the presented token is revoked and linked to its replacement. Presenting a
token that is already revoked is reuse (IAM-007): the whole family is revoked.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.request_context import get_client_ip, get_user_agent
from app.core.security import TokenError, create_access_token, create_refresh_token, decode_refresh_token
from app.core.time import new_id, utcnow
from app.modules.auth.models import RefreshToken
from app.modules.identity.models import User

# SEC-004 / SEC-005 cookie and header names.
REFRESH_COOKIE = "refresh_token"
CSRF_COOKIE = "csrf_token"
CSRF_HEADER = "X-CSRF-Token"


@dataclass(frozen=True)
class IssuedSession:
    access_token: str
    expires_in: int
    refresh_token: str
    refresh_expires_at: datetime
    csrf_token: str


def refresh_token_hash(token: str) -> str:
    """P01 §2.3: `token_hash` is SHA-256 of the refresh token."""
    return hashlib.sha256(token.encode()).hexdigest()


def require_csrf(cookie_value: str | None, header_value: str | None) -> None:
    """SEC-005 double submit: the `X-CSRF-Token` header must equal the `csrf_token` cookie (403 otherwise)."""
    if not cookie_value or not header_value or not hmac.compare_digest(cookie_value, header_value):
        raise AppError("permission_denied", 403)


async def _add_refresh_token(session: AsyncSession, user_id: UUID, family_id: UUID) -> tuple[RefreshToken, str]:
    """A new row in `family_id` and its signed refresh JWT (30 days, SEC-003)."""
    expires_at = utcnow() + timedelta(days=get_settings().refresh_token_ttl_days)
    token_id = new_id()
    refresh = create_refresh_token(user_id, family_id, token_id, expires_at)
    user_agent = get_user_agent()
    row = RefreshToken(
        id=token_id,
        user_id=user_id,
        family_id=family_id,
        token_hash=refresh_token_hash(refresh),
        expires_at=expires_at,
        ip=get_client_ip(),
        user_agent=user_agent[:512] if user_agent else None,
    )
    session.add(row)
    await session.flush()
    return row, refresh


def _issued(user: User, row: RefreshToken, refresh: str, csrf_token: str) -> IssuedSession:
    access, expires_in = create_access_token(user.id, row.family_id, user.token_version)
    return IssuedSession(
        access_token=access,
        expires_in=expires_in,
        refresh_token=refresh,
        refresh_expires_at=row.expires_at,
        csrf_token=csrf_token,
    )


async def start_session(session: AsyncSession, user: User) -> IssuedSession:
    """New refresh family for `user`, persisted in the caller's transaction."""
    row, refresh = await _add_refresh_token(session, user.id, new_id())
    return _issued(user, row, refresh, secrets.token_urlsafe(32))


async def _revoke_family(session: AsyncSession, family_id: UUID) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )


async def rotate_session(session: AsyncSession, refresh: str | None, csrf_token: str) -> IssuedSession:
    """IAM-006 / IAM-007: exchange a valid refresh token for a new access token and a new refresh token."""
    if not refresh:
        raise AppError("not_authenticated", 401)
    try:
        claims = decode_refresh_token(refresh)
        token_id, user_id, family_id = UUID(str(claims["jti"])), UUID(str(claims["sub"])), UUID(str(claims["sid"]))
    except TokenError as exc:
        raise AppError(exc.code, 401) from exc
    except ValueError as exc:
        raise AppError("token_invalid", 401) from exc

    row = await session.get(RefreshToken, token_id)
    if (
        row is None
        or not hmac.compare_digest(row.token_hash, refresh_token_hash(refresh))
        or row.user_id != user_id
        or row.family_id != family_id
    ):
        raise AppError("token_invalid", 401)

    user = await session.get(User, user_id)
    if user is None:
        raise AppError("token_invalid", 401)
    if user.status != "ACTIVE":
        raise AppError("user_blocked", 403)

    now = utcnow()
    # The row lock makes this the single point of truth: of concurrent requests with one token, only one
    # finds it unrevoked; the others see it revoked below and are treated as reuse.
    consumed = await session.scalar(
        update(RefreshToken)
        .where(RefreshToken.id == token_id, RefreshToken.revoked_at.is_(None), RefreshToken.expires_at > now)
        .values(revoked_at=now)
        .returning(RefreshToken.id)
        .execution_options(synchronize_session=False)
    )
    if consumed is None:
        state = (await session.execute(select(RefreshToken.revoked_at).where(RefreshToken.id == token_id))).scalar_one()
        if state is None:  # not revoked, so it lapsed: nothing to punish
            raise AppError("token_expired", 401)
        await _revoke_family(session, family_id)
        await audit.record(
            session, "auth.refresh_reuse", "user", user_id, new={"family_id": str(family_id), "token_id": str(token_id)}
        )
        # Keep the revocation and the audit row although the request fails.
        await session.commit()
        raise AppError("refresh_token_reused", 401)

    replacement, new_refresh = await _add_refresh_token(session, user_id, family_id)
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.id == token_id)
        .values(replaced_by_id=replacement.id)
        .execution_options(synchronize_session=False)
    )
    return _issued(user, replacement, new_refresh, csrf_token)
