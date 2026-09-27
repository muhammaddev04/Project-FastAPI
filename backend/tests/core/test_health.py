from __future__ import annotations

from httpx import AsyncClient


async def test_fnd_020_health_and_meta(client: AsyncClient) -> None:
    assert (await client.get("/api/health/live")).json() == {"status": "ok"}
    ready = await client.get("/api/health/ready")
    assert ready.status_code == 200 and ready.json()["details"] == {"postgres": "ok", "redis": "ok"}
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
