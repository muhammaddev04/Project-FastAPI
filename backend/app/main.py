from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api.v1.routes import auth as auth_routes

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="TezFarmo backend foundation and auth slice",
    debug=settings.app_debug,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router, prefix="/api/v1")
app.include_router(auth_routes.profile_router, prefix="/api/v1")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": settings.app_name}
