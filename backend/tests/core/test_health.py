from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.redis import get_redis
from app.core.storage import get_storage


async def test_fnd_020_health_and_meta(client: AsyncClient) -> None:
    await get_storage()._ensure_bucket()
    assert (await client.get("/api/health/live")).json() == {"status": "ok"}
    ready = await client.get("/api/health/ready")
    assert ready.status_code == 200 and ready.json()["details"] == {"postgres": "ok", "redis": "ok", "s3": "ok"}
    meta = (await client.get("/api/v1/meta")).json()
    assert meta["default_language"] == "tg" and meta["languages"] == ["tg", "ru", "en"] and meta["currency"] == "TJS"
    # Only methods with a working backend and frontend flow are advertised; the rest stay deferred.
    assert meta["auth"] == {
        "password_login": True,
        "registration": True,
        "password_reset": True,
        "email_verification": True,
        "google": False,
    }


@pytest.mark.parametrize("raises", [False, True])
async def test_fnd_020_s3_unavailable_returns_503(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, raises: bool
) -> None:
    async def unavailable() -> bool:
        if raises:
            raise ConnectionError("storage offline")
        return False

    monkeypatch.setattr(get_storage(), "ready", unavailable)
    response = await client.get("/api/health/ready")
    assert response.status_code == 503
    assert response.json()["details"]["s3"] == "unavailable"
    assert (await client.get("/api/health/live")).status_code == 200


async def test_fnd_020_ready_503_when_redis_down(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def offline() -> None:
        raise ConnectionError("Redis offline")

    monkeypatch.setattr(get_redis(), "ping", offline)
    response = await client.get("/api/health/ready")
    assert response.status_code == 503
    assert response.json()["details"]["redis"] == "unavailable"
    assert (await client.get("/api/health/live")).status_code == 200
