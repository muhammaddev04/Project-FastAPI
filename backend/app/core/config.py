from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_DEFAULT = "dev-only-insecure-secret-change-me-before-deploy"


class Settings(BaseSettings):
    """Application settings (TZ P00 FND-002 / FND-003)."""

    app_name: str = "TezFarmo"
    app_env: Literal["development", "testing", "staging", "production"] = "development"
    app_debug: bool = False
    app_version: str = "0.1.0"

    database_url: str = "postgresql+asyncpg://tezfarmo:tezfarmo@localhost:5432/tezfarmo"
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # SEC-003: separate secrets for access and refresh tokens, plus an OTP HMAC secret.
    jwt_access_secret: str = INSECURE_DEFAULT + "-access"
    jwt_refresh_secret: str = INSECURE_DEFAULT + "-refresh"
    jwt_flow_secret: str = INSECURE_DEFAULT + "-flow"
    otp_hmac_secret: str = INSECURE_DEFAULT + "-otp"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 30
    flow_token_ttl_minutes: int = 15

    # SEC-004 / SEC-005: refresh cookie and CSRF double-submit cookie.
    refresh_cookie_name: str = "refresh_token"
    csrf_cookie_name: str = "csrf_token"
    auth_cookie_path: str = "/api/v1/auth"
    cookie_secure: bool = True

    # IAM-016: SMS delivery. `console` prints codes to the server log in development only.
    sms_provider: Literal["console"] = "console"

    # Optional Google sign-in (not part of TZ v4; kept by product decision and secured).
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:5173/auth/google/callback"

    default_language: Literal["tg", "ru", "en"] = "tg"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @model_validator(mode="after")
    def _refuse_insecure_production(self) -> Settings:
        if self.app_env == "production":
            secrets = (self.jwt_access_secret, self.jwt_refresh_secret, self.jwt_flow_secret, self.otp_hmac_secret)
            weak = any(len(value) < 32 or value.startswith(INSECURE_DEFAULT) for value in secrets)
            if self.app_debug or weak or not self.cookie_secure:
                raise ValueError("production requires 32+ byte explicit secrets, APP_DEBUG=false and secure cookies")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
