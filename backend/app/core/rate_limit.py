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


# P00 §4.1 global rate-limit table (auth rows).
AUTH_LOGIN = RateLimit("auth_login", 5, 15 * 60)
AUTH_OTP_SEND = RateLimit("auth_otp_send", 5, 60 * 60)
AUTH_OTP_VERIFY = RateLimit("auth_otp_verify", 10, 60 * 60)
PASSWORD_RESET = RateLimit("password_reset", 3, 60 * 60)


async def hit(rule: RateLimit, key: str) -> None:
    """FND-016: Redis sliding window. Raises 429 rate_limited with Retry-After once the window is full."""
    redis = get_redis()
    bucket = f"rl:{rule.name}:{key}"
    now = time.time()
    async with redis.pipeline(transaction=True) as pipe:
        pipe.zremrangebyscore(bucket, 0, now - rule.window_seconds)
        pipe.zcard(bucket)
        pipe.zrange(bucket, 0, 0, withscores=True)
        _, count, oldest = await pipe.execute()
    if count >= rule.limit:
        retry_after = int(rule.window_seconds - (now - oldest[0][1])) + 1 if oldest else rule.window_seconds
        raise AppError("rate_limited", 429, {"retry_after": retry_after}, headers={"Retry-After": str(retry_after)})
    async with redis.pipeline(transaction=True) as pipe:
        pipe.zadd(bucket, {uuid.uuid4().hex: now})
        pipe.expire(bucket, rule.window_seconds)
        await pipe.execute()
