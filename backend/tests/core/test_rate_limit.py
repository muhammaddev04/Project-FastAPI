from __future__ import annotations

import pytest

from app.core.errors import AppError
from app.core.rate_limit import RateLimit, hit


async def test_fnd_016_rate_limit_429_retry_after() -> None:
    rule = RateLimit("test_rule", 3, 60)
    for _ in range(3):
        await hit(rule, "key-a")
    with pytest.raises(AppError) as exc:
        await hit(rule, "key-a")
    assert exc.value.code == "rate_limited"
    assert exc.value.http_status == 429
    assert exc.value.headers is not None
    assert 0 < int(exc.value.headers["Retry-After"]) <= 61


async def test_fnd_016_rate_limit_keys_are_independent() -> None:
    rule = RateLimit("test_rule", 1, 60)
    await hit(rule, "key-a")
    await hit(rule, "key-b")
