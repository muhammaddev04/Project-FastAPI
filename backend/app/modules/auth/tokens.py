"""One-time email secrets (P01 §2.2, CR-001).

- Email verification and password reset: a 6-digit code typed into the app (`issue_email_code` /
  `consume_email_code`); nothing to click in the email.
- Password reset authorization: after its code is verified, a long random token handed to the browser in the
  verify response (never in an email or URL) and spent by `password/reset/complete` (`issue_email_token` /
  `consume_email_token`). It shares the RESET_PASSWORD purpose with the code but is hashed differently (no user
  or purpose in its HMAC), so a code can never be presented as an authorization.

The raw secret exists only in the email: the database keeps an HMAC-SHA256(APP_SECRET_KEY, ...), so a leaked table
cannot be replayed. A code's HMAC also covers the user and purpose, so equal codes of different users never collide
and a code only works for the account it was sent to. Issuing a secret invalidates the user's earlier unused ones
for the same purpose; consuming one is a single conditional UPDATE, so concurrent requests use it at most once.
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
    # A 6-digit code has a small search space: short-lived, and guesses are capped per email (service layer).
    "VERIFY_EMAIL": timedelta(minutes=15),
    "RESET_PASSWORD": timedelta(minutes=30),
}
#: Once the reset code is verified, the user has this long to choose the new password.
RESET_AUTHORIZATION_LIFETIME = timedelta(minutes=10)
CODE_DIGITS = 6
# 32 random bytes = 256 bits, URL-safe (43 characters).
_TOKEN_BYTES = 32


def hash_token(token: str) -> str:
    key = get_settings().app_secret_key.encode()
    return hmac.new(key, token.encode(), hashlib.sha256).hexdigest()


def hash_code(user_id: UUID, purpose: str, code: str) -> str:
    key = get_settings().app_secret_key.encode()
    return hmac.new(key, f"{purpose}:{user_id}:{code}".encode(), hashlib.sha256).hexdigest()


async def _expire_unused(session: AsyncSession, user_id: UUID, purpose: str) -> None:
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


async def issue_email_token(
    session: AsyncSession, user_id: UUID, purpose: str, lifetime: timedelta | None = None
) -> str:
    """Store a new 256-bit token for `user_id` (earlier unused ones of the purpose expire) and return the raw value
    for its single recipient (never persisted or logged)."""
    now = utcnow()
    await _expire_unused(session, user_id, purpose)
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    session.add(
        EmailToken(
            user_id=user_id,
            purpose=purpose,
            token_hash=hash_token(token),
            expires_at=now + (lifetime or TOKEN_LIFETIMES[purpose]),
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


async def issue_email_code(session: AsyncSession, user_id: UUID, purpose: str) -> str:
    """Store a new 6-digit code for `user_id` (earlier unused ones expire) and return it for the email only."""
    now = utcnow()
    await _expire_unused(session, user_id, purpose)
    code = f"{secrets.randbelow(10**CODE_DIGITS):0{CODE_DIGITS}d}"
    session.add(
        EmailToken(
            user_id=user_id,
            purpose=purpose,
            token_hash=hash_code(user_id, purpose, code),
            expires_at=now + TOKEN_LIFETIMES[purpose],
        )
    )
    return code


async def consume_email_code(session: AsyncSession, user_id: UUID, code: str, purpose: str) -> None:
    """Use `user_id`'s current code once. A wrong or already-used code is `email_token_invalid`; the right code after
    its lifetime (or after a newer code replaced it) is `email_token_expired`."""
    code_hash = hash_code(user_id, purpose, code)
    now = utcnow()
    consumed = await session.scalar(
        update(EmailToken)
        .where(
            EmailToken.user_id == user_id,
            EmailToken.purpose == purpose,
            EmailToken.token_hash == code_hash,
            EmailToken.consumed_at.is_(None),
            EmailToken.expires_at > now,
        )
        .values(consumed_at=now)
        .returning(EmailToken.id)
    )
    if consumed is not None:
        return
    expired = await session.scalar(
        select(EmailToken.id).where(
            EmailToken.user_id == user_id,
            EmailToken.purpose == purpose,
            EmailToken.token_hash == code_hash,
            EmailToken.consumed_at.is_(None),
        )
    )
    raise AppError("email_token_expired" if expired is not None else "email_token_invalid", 422)
