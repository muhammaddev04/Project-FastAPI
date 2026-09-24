from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.health import health_router, meta_router
from app.core.logging import configure_logging
from app.core.request_context import RequestContextMiddleware
from app.modules.identity.router import router as identity_router
from app.modules.organizations.router import router as organizations_router


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(
        title="TezFarmo API",
        version=settings.app_version,
        debug=settings.app_debug,
        openapi_url="/api/v1/openapi.json",
        docs_url=None if settings.app_env == "production" else "/api/v1/docs",
        redoc_url=None,
    )
    # SEC-009: only configured origins; credentials allowed for the cookie-based auth endpoints.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-Org-Id",
            "X-Request-Id",
            "Accept-Language",
            "Idempotency-Key",
            "X-CSRF-Token",
        ],
        expose_headers=["X-Request-Id", "Retry-After"],
    )
    app.add_middleware(RequestContextMiddleware)
    register_error_handlers(app)
    app.include_router(health_router)
    app.include_router(meta_router)
    app.include_router(identity_router)
    app.include_router(organizations_router)
    return app


app = create_app()
