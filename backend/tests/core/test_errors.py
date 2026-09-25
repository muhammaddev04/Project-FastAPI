from __future__ import annotations

import logging

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel, Field

from app.core.config import Settings
from app.core.errors import AppError, register_error_handlers
from app.core.logging import JsonFormatter, mask_phone
from app.core.request_context import RequestContextMiddleware


class Payload(BaseModel):
    name: str = Field(min_length=2)


def _probe_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)
    register_error_handlers(app)

    @app.get("/boom")
    async def boom() -> None:
        raise AppError("permission_denied", 403, {"hint": "x"})

    @app.post("/validate")
    async def validate(body: Payload) -> dict[str, str]:
        return {"name": body.name}

    @app.get("/crash")
    async def crash() -> None:
        raise RuntimeError("secret internals")

    return app


def _probe_client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=_probe_app(), raise_app_exceptions=False), base_url="https://t")


async def test_fnd_008_app_error_format() -> None:
    async with _probe_client() as http:
        response = await http.get("/boom", headers={"Accept-Language": "ru", "X-Request-Id": "req-123"})
    assert response.status_code == 403
    assert response.json() == {
        "error": {
            "code": "permission_denied",
            "message": "У вас нет прав на это действие.",
            "details": {"hint": "x"},
            "request_id": "req-123",
        }
    }
    assert response.headers["x-request-id"] == "req-123"


async def test_fnd_008_default_language_is_tajik() -> None:
    async with _probe_client() as http:
        response = await http.get("/boom")
    assert response.json()["error"]["message"] == "Шумо ба ин амал ҳуқуқ надоред."


async def test_fnd_008_validation_error_fields() -> None:
    async with _probe_client() as http:
        response = await http.post("/validate", json={"name": "a"}, headers={"Accept-Language": "en"})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"]["fields"] == [
        {"field": "name", "code": "string_too_short", "message": "This value is too short."}
    ]


async def test_fnd_008_internal_error_hides_details() -> None:
    async with _probe_client() as http:
        response = await http.get("/crash")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "secret" not in response.text


async def test_fnd_019_unsafe_request_id_is_replaced() -> None:
    async with _probe_client() as http:
        response = await http.get("/boom", headers={"X-Request-Id": "bad id with spaces"})
    assert response.headers["x-request-id"] != "bad id with spaces"
    assert len(response.headers["x-request-id"]) == 32


def test_sec_011_logs_mask_phone_numbers() -> None:
    assert mask_phone("sms to +992900001234 sent") == "sms to +992*****1234 sent"
    record = logging.LogRecord("t", logging.INFO, __file__, 1, "user +992900001234", None, None)
    assert "+992900001234" not in JsonFormatter().format(record)


def test_fnd_002_production_refuses_insecure_defaults() -> None:
    with pytest.raises(ValueError):
        Settings(app_env="production")
    production = Settings(
        app_env="production",
        jwt_access_secret="s" * 40,
        email_provider="smtp",
        smtp_host="smtp.gmail.com",
        from_email="noreply@tezfarmo.tj",
    )
    assert production.app_env == "production"
