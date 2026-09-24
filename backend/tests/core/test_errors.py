from __future__ import annotations

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel, Field

from app.core.errors import AppError, register_error_handlers
from app.core.request_context import RequestContextMiddleware


class Body(BaseModel):
    name: str = Field(min_length=2)


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)
    register_error_handlers(app)

    @app.get("/boom")
    async def boom() -> None:
        raise AppError("invalid_credentials", 401, {"hint": "x"})

    @app.post("/validate")
    async def validate(body: Body) -> dict[str, str]:
        return {"name": body.name}

    @app.get("/crash")
    async def crash() -> None:
        raise RuntimeError("secret internals")

    return app


async def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=_app(), raise_app_exceptions=False), base_url="https://t")


async def test_fnd_008_app_error_format() -> None:
    async with await _client() as http:
        response = await http.get("/boom", headers={"Accept-Language": "ru", "X-Request-Id": "req-123"})
    assert response.status_code == 401
    body = response.json()["error"]
    assert body["code"] == "invalid_credentials"
    assert body["message"] == "Неверный номер телефона или пароль."
    assert body["details"] == {"hint": "x"}
    assert body["request_id"] == "req-123"
    assert response.headers["x-request-id"] == "req-123"


async def test_fnd_008_default_language_is_tajik() -> None:
    async with await _client() as http:
        response = await http.get("/boom")
    assert response.json()["error"]["message"] == "Рақами телефон ё парол нодуруст аст."


async def test_fnd_008_validation_error_fields() -> None:
    async with await _client() as http:
        response = await http.post("/validate", json={"name": "a"}, headers={"Accept-Language": "en"})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"]["fields"][0]["field"] == "name"
    assert error["details"]["fields"][0]["code"] == "string_too_short"


async def test_fnd_008_internal_error_hides_details() -> None:
    async with await _client() as http:
        response = await http.get("/crash")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "secret" not in response.text


async def test_fnd_019_unsafe_request_id_is_replaced() -> None:
    async with await _client() as http:
        response = await http.get("/boom", headers={"X-Request-Id": "bad id\nwith newline"})
    assert response.headers["x-request-id"] != "bad id\nwith newline"
    assert len(response.headers["x-request-id"]) == 32
