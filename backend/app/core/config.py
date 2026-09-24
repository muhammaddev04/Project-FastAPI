from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_DEFAULT = "dev-only-insecure-secret-change-me-before-deploy"


class Settings(BaseSettings):
    """Single settings object (TZ P00 FND-002 / FND-003). Values come from the environment or `.env`."""

    app_name: str = "TezFarmo"
    app_env: Literal["development", "testing", "staging", "production"] = "development"
    app_debug: bool = False
    app_version: str = "0.1.0"
    log_level: str = "INFO"

    database_url: str = "postgresql+asyncpg://tezfarmo:tezfarmo@localhost:5433/tezfarmo"
    redis_url: str = "redis://localhost:6380/0"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # SEC-003: access tokens are signed with their own secret.
    jwt_access_secret: str = INSECURE_DEFAULT + "-access"
    access_token_ttl_minutes: int = 15

    # FND-017 private S3-compatible storage. Buckets are never public; files are reached via signed URLs (SEC-008).
    s3_endpoint: str = "localhost:9000"
    s3_access_key: str = "tezfarmo"
    s3_secret_key: str = "tezfarmo-dev-secret"
    s3_bucket_private: str = "tezfarmo-private"
    s3_secure: bool = False

    # Optional "Continue with Google" (owner requirement, not in TZ v4). Secrets stay server-side.
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:5173/auth/google/callback"

    default_language: Literal["tg", "ru", "en"] = "tg"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def google_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @model_validator(mode="after")
    def _refuse_insecure_production(self) -> Settings:
        """FND-002: production must not start with debug on or weak/default secrets."""
        if self.app_env == "production":
            secrets = (self.jwt_access_secret,)
            weak = any(len(value) < 32 or value.startswith(INSECURE_DEFAULT) for value in secrets)
            if self.app_debug or weak:
                raise ValueError("production requires 32+ byte explicit secrets and APP_DEBUG=false")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
