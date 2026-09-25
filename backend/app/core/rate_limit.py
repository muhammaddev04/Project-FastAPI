from __future__ import annotations

import time
import uuid
from dataclasses import dataclass

from app.core.errors import AppError
from app.core.redis import get_redis


@dataclass(frozen=True)
class RateLimit:
    name: str
    limit: int
    window_seconds: int
    #: 02_ERROR_CODES code answered when the window is full (429).
    error_code: str = "rate_limited"


# P00 §4.1 global rate-limit table.
AUTH_LOGIN = RateLimit("auth_login", 5, 15 * 60)
# CR-001: the email-channel limits replace the SMS OTP ones (same numbers).
AUTH_EMAIL_SEND = RateLimit("auth_email_send", 5, 60 * 60)
AUTH_EMAIL_VERIFY = RateLimit("auth_email_verify", 10, 60 * 60)
# P01 §2.2: another verification email only 60 s after the previous one (per email).
EMAIL_RESEND_COOLDOWN = RateLimit("auth_email_resend", 1, 60, error_code="email_resend_too_early")
PASSWORD_RESET = RateLimit("password_reset", 3, 60 * 60)
DEFAULT_AUTHENTICATED = RateLimit("default_authenticated", 300, 60)


def _bucket(rule: RateLimit, key: str) -> str:
    return f"rl:{rule.name}:{key}"


async def check(rule: RateLimit, key: str) -> None:
    """Raise 429 rate_limited (+ Retry-After) when the sliding window for `key` is full."""
    now = time.time()
    async with get_redis().pipeline(transaction=True) as pipe:
        pipe.zremrangebyscore(_bucket(rule, key), 0, now - rule.window_seconds)
        pipe.zcard(_bucket(rule, key))
        pipe.zrange(_bucket(rule, key), 0, 0, withscores=True)
        _, count, oldest = await pipe.execute()
    if count >= rule.limit:
        retry_after = int(rule.window_seconds - (now - oldest[0][1])) + 1 if oldest else rule.window_seconds
        raise AppError(rule.error_code, 429, {"retry_after": retry_after}, headers={"Retry-After": str(retry_after)})


async def record(rule: RateLimit, key: str) -> None:
    """Count one event for `key` (e.g. only failed attempts)."""
    async with get_redis().pipeline(transaction=True) as pipe:
        pipe.zadd(_bucket(rule, key), {uuid.uuid4().hex: time.time()})
        pipe.expire(_bucket(rule, key), rule.window_seconds)
        await pipe.execute()


async def hit(rule: RateLimit, key: str) -> None:
    """FND-016: Redis sliding window - check, then count this request."""
    await check(rule, key)
    await record(rule, key)
