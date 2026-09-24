from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.i18n import resolve_language, translate
from app.core.request_context import get_request_id

logger = logging.getLogger("tezfarmo.errors")


class AppError(Exception):
    """Domain error rendered with the API-001 envelope (FND-008)."""

    def __init__(
        self,
        code: str,
        http_status: int,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.http_status = http_status
        self.details = details or {}
        self.headers = headers


def error_body(request: Request, code: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    language = resolve_language(request.headers.get("accept-language"))
    return {
        "error": {
            "code": code,
            "message": translate(f"errors.{code}", language),
            "details": details or {},
            "request_id": get_request_id(),
        }
    }


_STATUS_CODES = {
    400: "bad_request",
    401: "not_authenticated",
    403: "permission_denied",
    404: "not_found",
    405: "bad_request",
    429: "rate_limited",
}


def _field_path(location: tuple[Any, ...]) -> str:
    parts = [str(part) for part in location if part not in ("body", "query", "path", "header")]
    path = ""
    for part in parts:
        path += f"[{part}]" if part.isdigit() else (f".{part}" if path else part)
    return path


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            error_body(request, exc.code, exc.details), status_code=exc.http_status, headers=exc.headers
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        language = resolve_language(request.headers.get("accept-language"))
        fields = []
        for issue in exc.errors():
            ctx = issue.get("ctx") or {}
            code = str(ctx.get("error_code") or issue.get("type") or "invalid")
            fields.append(
                {
                    "field": _field_path(tuple(issue.get("loc", ()))),
                    "code": code,
                    "message": translate(f"validation.{code}", language),
                }
            )
        return JSONResponse(error_body(request, "validation_error", {"fields": fields}), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _STATUS_CODES.get(exc.status_code, "internal_error" if exc.status_code >= 500 else "bad_request")
        return JSONResponse(error_body(request, code), status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error", extra={"request_id": get_request_id()})
        return JSONResponse(error_body(request, "internal_error"), status_code=500)
