from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.errors import install_error_contract, register_error_handlers
from app.core.health import health_router, meta_router
from app.core.logging import configure_logging
from app.core.metrics import MetricsMiddleware, metrics_router
from app.core.monitoring import configure_monitoring
from app.core.request_context import RequestContextMiddleware
from app.modules.auth.router import router as auth_router
from app.modules.catalog.router import router as catalog_router
from app.modules.catalog.service import install as install_catalog
from app.modules.delivery.ports import install as install_delivery
from app.modules.delivery.router import router as delivery_router
from app.modules.files.router import router as files_router
from app.modules.finance.ports import install as install_finance
from app.modules.identity.router import router as identity_router
from app.modules.identity.team_router import router as team_router
from app.modules.inventory.router import router as inventory_router
from app.modules.inventory.service import install as install_inventory
from app.modules.orders.router import router as orders_router
from app.modules.orders.service import install as install_orders
from app.modules.organizations.ports import install_handlers
from app.modules.organizations.router import router as organizations_router
from app.modules.partnerships.router import router as partnerships_router
from app.modules.subscriptions.router import admin_router as subscription_admin_router
from app.modules.subscriptions.router import router as subscription_router
from app.modules.subscriptions.service import install as install_subscriptions
from app.modules.support.router import router as support_router
from app.modules.verification.router import admin_router as admin_verification_router
from app.modules.verification.router import router as verification_router


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    configure_monitoring()
    install_handlers()
    install_subscriptions()
    install_catalog()
    install_inventory()
    install_orders()
    install_delivery()
    install_finance()
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
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
    app.add_middleware(MetricsMiddleware)
    register_error_handlers(app)
    app.include_router(health_router)
    app.include_router(meta_router)
    app.include_router(metrics_router)
    app.include_router(support_router)
    app.include_router(auth_router)
    app.include_router(identity_router)
    app.include_router(team_router)
    app.include_router(organizations_router)
    app.include_router(files_router)
    app.include_router(verification_router)
    app.include_router(admin_verification_router)
    app.include_router(subscription_router)
    app.include_router(subscription_admin_router)
    app.include_router(catalog_router)
    app.include_router(inventory_router)
    app.include_router(partnerships_router)
    app.include_router(orders_router)
    app.include_router(delivery_router)
    install_error_contract(app)
    return app


app = create_app()
