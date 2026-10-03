from __future__ import annotations

import asyncio

import pytest

from app.core.errors import AppError
from app.core.rate_limit import RateLimit, hit


async def test_fnd_016_rate_limit_429_retry_after() -> None:
    rule = RateLimit("test_rule", 3, 60)
    for _ in range(3):
        await hit(rule, "key-a")
    with pytest.raises(AppError) as exc:
        await hit(rule, "key-a")
    assert exc.value.code == "rate_limited" and exc.value.http_status == 429
    assert exc.value.headers is not None and 0 < int(exc.value.headers["Retry-After"]) <= 61
    await hit(rule, "key-b")  # keys are independent


async def test_fnd_016_parallel_requests_obey_limit() -> None:
    rule = RateLimit("parallel_rule", 5, 60)
    results = await asyncio.gather(*(hit(rule, "shared") for _ in range(40)), return_exceptions=True)
    assert sum(result is None for result in results) == 5
    denied = [result for result in results if isinstance(result, AppError)]
    assert len(denied) == 35
    assert all(error.http_status == 429 and error.headers and error.headers["Retry-After"] for error in denied)
