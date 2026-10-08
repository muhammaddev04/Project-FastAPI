from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Protocol, cast

from app.core.errors import AppError
from app.core.redis import get_redis


class ScriptExecutor(Protocol):
    """Typed boundary for redis-py's Lua API, which its stubs leave untyped."""

    async def eval(self, script: str, numkeys: int, *args: str | int | float) -> int: ...


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
# 6-digit verification codes: at most 5 wrong guesses per email per 15 minutes (the code's lifetime), whatever the IP.
EMAIL_CODE_ATTEMPTS = RateLimit("auth_email_code", 5, 15 * 60)
# 6-digit password reset codes: at most 5 wrong guesses per email per 30 minutes (the code's lifetime), any IP.
RESET_CODE_ATTEMPTS = RateLimit("password_reset_code", 5, 30 * 60)
# DEL-011: the handover code is six digits, so guessing is cheap without a ceiling on how fast a
# courier may try. The per-delivery attempt counter locks at five; this caps the rate as well.
DELIVERY_CONFIRM = RateLimit("delivery_confirm", 10, 10 * 60)
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
    """FND-016: atomically admit/count a request; parallel callers cannot overfill the window."""
    script = """
    local now = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
    if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
        local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
        return math.max(1, math.ceil(window - (now - tonumber(oldest[2]))))
    end
    redis.call('ZADD', KEYS[1], now, ARGV[4])
    redis.call('EXPIRE', KEYS[1], window)
    return 0
    """
    retry_after = int(
        await cast(ScriptExecutor, get_redis()).eval(
            script, 1, _bucket(rule, key), time.time(), rule.window_seconds, rule.limit, uuid.uuid4().hex
        )
    )
    if retry_after:
        raise AppError(rule.error_code, 429, {"retry_after": retry_after}, headers={"Retry-After": str(retry_after)})
