"""Login sessions (P01 §2.3, IAM-005, SEC-003..005).

A login starts a refresh-token family: one `refresh_tokens` row (its `id` is the refresh JWT's `jti`, only the
token's SHA-256 is stored), an access token whose `sid` is the family, and a CSRF value for the double-submit
check that refresh and logout will require. Raw tokens are handed to the caller once and never persisted or logged.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.request_context import get_client_ip, get_user_agent
from app.core.security import create_access_token, create_refresh_token
from app.core.time import new_id, utcnow
from app.modules.auth.models import RefreshToken
from app.modules.identity.models import User

# SEC-004 / SEC-005 cookie names.
REFRESH_COOKIE = "refresh_token"
CSRF_COOKIE = "csrf_token"


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


async def start_session(session: AsyncSession, user: User) -> IssuedSession:
    """New refresh family for `user`, persisted in the caller's transaction."""
    family_id, token_id = new_id(), new_id()
    expires_at = utcnow() + timedelta(days=get_settings().refresh_token_ttl_days)
    refresh = create_refresh_token(user.id, family_id, token_id, expires_at)
    user_agent = get_user_agent()
    session.add(
        RefreshToken(
            id=token_id,
            user_id=user.id,
            family_id=family_id,
            token_hash=refresh_token_hash(refresh),
            expires_at=expires_at,
            ip=get_client_ip(),
            user_agent=user_agent[:512] if user_agent else None,
        )
    )
    access, expires_in = create_access_token(user.id, family_id, user.token_version)
    return IssuedSession(
        access_token=access,
        expires_in=expires_in,
        refresh_token=refresh,
        refresh_expires_at=expires_at,
        csrf_token=secrets.token_urlsafe(32),
    )
