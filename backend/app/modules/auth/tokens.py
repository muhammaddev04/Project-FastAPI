"""One-time email tokens (P01 §2.2, CR-001).

The raw token exists only in the email link: the database keeps HMAC-SHA256(APP_SECRET_KEY, token), so a leaked
table cannot be replayed. Issuing a token invalidates the user's earlier unused tokens for the same purpose;
consuming one is a single conditional UPDATE, so concurrent requests can use a token at most once.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.time import utcnow
from app.modules.auth.models import EmailToken

TOKEN_LIFETIMES: dict[str, timedelta] = {
    "VERIFY_EMAIL": timedelta(hours=24),
    "RESET_PASSWORD": timedelta(minutes=30),
}
# 32 random bytes = 256 bits, URL-safe (43 characters).
_TOKEN_BYTES = 32


def hash_token(token: str) -> str:
    key = get_settings().app_secret_key.encode()
    return hmac.new(key, token.encode(), hashlib.sha256).hexdigest()


async def issue_email_token(session: AsyncSession, user_id: UUID, purpose: str) -> str:
    """Store a new token for `user_id` and return the raw value for the email link (never persisted or logged)."""
    now = utcnow()
    await session.execute(
        update(EmailToken)
        .where(
            EmailToken.user_id == user_id,
            EmailToken.purpose == purpose,
            EmailToken.consumed_at.is_(None),
            EmailToken.expires_at > now,
        )
        .values(expires_at=now)
    )
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    session.add(
        EmailToken(
            user_id=user_id, purpose=purpose, token_hash=hash_token(token), expires_at=now + TOKEN_LIFETIMES[purpose]
        )
    )
    return token


async def consume_email_token(session: AsyncSession, token: str, purpose: str) -> UUID:
    """Mark a valid token used and return its user id.

    Unknown, wrong-purpose or already-used tokens are `email_token_invalid`; a known unused token past its
    lifetime (including one superseded by a newer token) is `email_token_expired` (02_ERROR_CODES, CR-001).
    """
    token_hash = hash_token(token)
    now = utcnow()
    user_id = await session.scalar(
        update(EmailToken)
        .where(
            EmailToken.token_hash == token_hash,
            EmailToken.purpose == purpose,
            EmailToken.consumed_at.is_(None),
            EmailToken.expires_at > now,
        )
        .values(consumed_at=now)
        .returning(EmailToken.user_id)
    )
    if user_id is not None:
        return user_id
    # Nothing was consumed: explain why without revealing more than "expired" vs "not usable".
    expired = await session.scalar(
        select(EmailToken.id).where(
            EmailToken.token_hash == token_hash,
            EmailToken.purpose == purpose,
            EmailToken.consumed_at.is_(None),
        )
    )
    raise AppError("email_token_expired" if expired is not None else "email_token_invalid", 422)
