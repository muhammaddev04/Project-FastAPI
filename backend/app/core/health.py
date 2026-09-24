from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import get_engine
from app.core.i18n import DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES
from app.core.redis import get_redis

health_router = APIRouter(prefix="/api/health", tags=["health"])
meta_router = APIRouter(prefix="/api/v1", tags=["meta"])


@health_router.get("/live", summary="Liveness probe")
async def live() -> dict[str, str]:
    return {"status": "ok"}


@health_router.get("/ready", summary="Readiness probe (PostgreSQL + Redis)")
async def ready() -> JSONResponse:
    """FND-020: 503 with per-dependency details when any dependency is down."""
    checks: dict[str, str] = {}
    try:
        async with get_engine().connect() as connection:
            await connection.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception:  # noqa: BLE001 - readiness must report, not raise
        checks["postgres"] = "unavailable"
    try:
        await get_redis().ping()
        checks["redis"] = "ok"
    except Exception:  # noqa: BLE001
        checks["redis"] = "unavailable"
    healthy = all(value == "ok" for value in checks.values())
    body: dict[str, Any] = {"status": "ok" if healthy else "unavailable", "details": checks}
    return JSONResponse(body, status_code=200 if healthy else 503)


# Sign-in methods that are implemented and enabled. Deferred P01 features stay false until they are
# actually implemented, so clients never offer a flow that cannot complete.
AUTH_METHODS: dict[str, bool] = {
    "password_login": False,
    "registration": False,
    "password_reset": False,
    "email_verification": False,
    "google": False,
}


@meta_router.get("/meta", summary="Public platform metadata")
async def meta() -> dict[str, Any]:
    settings = get_settings()
    return {
        "version": settings.app_version,
        "languages": list(SUPPORTED_LANGUAGES),
        "default_language": DEFAULT_LANGUAGE,
        "currency": "TJS",
        "auth": dict(AUTH_METHODS),
    }
