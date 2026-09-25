from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Cookie, Header, Response, status

from app.core.time import utcnow
from app.modules.auth import service
from app.modules.auth.schemas import (
    LoginRequest,
    LoginResponse,
    RefreshResponse,
    RegisterRequest,
    ResendVerificationRequest,
    VerifyEmailRequest,
)
from app.modules.auth.sessions import CSRF_COOKIE, CSRF_HEADER, REFRESH_COOKIE, IssuedSession
from app.modules.identity.deps import SessionDep

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post(
    "/register",
    status_code=status.HTTP_202_ACCEPTED,
    response_class=Response,
    summary="Register with email and password; a confirmation link is emailed (IAM-001, CR-001)",
    responses={
        202: {"description": "Accepted. The same answer whether or not the email is already registered."},
        422: {"description": "`validation_error` or `weak_password` (IAM-003)."},
        429: {"description": "`rate_limited` (auth_email_send, 5 per hour per email)."},
        503: {"description": "`service_unavailable`: the email could not be sent; nothing was created."},
    },
)
async def register(payload: RegisterRequest, session: SessionDep) -> Response:
    await service.register(session, payload)
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post(
    "/email/verify",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Confirm the email address with the token from the email link (IAM-002, CR-001)",
    responses={
        204: {"description": "The email is confirmed; the token can no longer be used."},
        422: {"description": "`email_token_invalid` (unknown or already used) or `email_token_expired`."},
        429: {"description": "`rate_limited` (auth_email_verify, 10 per hour per IP)."},
    },
)
async def verify_email(payload: VerifyEmailRequest, session: SessionDep) -> Response:
    await service.verify_email(session, payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/email/resend",
    status_code=status.HTTP_202_ACCEPTED,
    response_class=Response,
    summary="Send a new confirmation link to an unverified address (P01 §6, CR-001)",
    responses={
        202: {"description": "Accepted. The same answer for unknown, verified and unverified addresses."},
        422: {"description": "`validation_error`."},
        429: {
            "description": "`email_resend_too_early` (60 s after the previous email) or `rate_limited` "
            "(auth_email_send, 5 per hour per email); both with Retry-After."
        },
        503: {"description": "`service_unavailable`: the email could not be sent; earlier links stay valid."},
    },
)
async def resend_verification(payload: ResendVerificationRequest, session: SessionDep) -> Response:
    await service.resend_verification(session, payload)
    return Response(status_code=status.HTTP_202_ACCEPTED)


def _set_session_cookies(response: Response, issued: IssuedSession) -> None:
    max_age = int((issued.refresh_expires_at - utcnow()).total_seconds())
    # SEC-004: httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth.
    response.set_cookie(
        REFRESH_COOKIE,
        issued.refresh_token,
        max_age=max_age,
        path="/api/v1/auth",
        secure=True,
        httponly=True,
        samesite="strict",
    )
    # SEC-005 double submit: readable by the app, echoed as X-CSRF-Token on refresh/logout.
    response.set_cookie(
        CSRF_COOKIE, issued.csrf_token, max_age=max_age, path="/", secure=True, httponly=False, samesite="strict"
    )
    response.headers["Cache-Control"] = "no-store"


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Sign in with email and password (F-1.2, IAM-004, CR-001)",
    responses={
        200: {
            "description": "`{access_token, expires_in, user}`. Sets the httpOnly refresh cookie (SEC-004) and the "
            "`csrf_token` cookie for the double-submit check on refresh/logout (SEC-005)."
        },
        401: {"description": "`invalid_credentials`: unknown email or wrong password (indistinguishable)."},
        403: {"description": "`email_not_verified` or `user_blocked` (only after a correct password)."},
        422: {"description": "`validation_error`."},
        429: {"description": "`rate_limited` (auth_login, 5 failed attempts per 15 minutes per email + IP)."},
    },
)
async def login(payload: LoginRequest, session: SessionDep, response: Response) -> LoginResponse:
    body, issued = await service.login(session, payload)
    _set_session_cookies(response, issued)
    return body


@router.post(
    "/refresh",
    response_model=RefreshResponse,
    summary="Rotate the refresh cookie and get a new access token (IAM-006/007, SEC-004/005)",
    responses={
        200: {"description": "`{access_token, expires_in}`; the refresh cookie is replaced (same family)."},
        401: {
            "description": "`not_authenticated` (no cookie), `token_invalid`, `token_expired`, or "
            "`refresh_token_reused` (the whole session family is revoked)."
        },
        403: {"description": "`permission_denied` (CSRF check failed) or `user_blocked`."},
    },
)
async def refresh(
    session: SessionDep,
    response: Response,
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
    csrf_cookie: Annotated[str | None, Cookie(alias=CSRF_COOKIE)] = None,
    csrf_header: Annotated[str | None, Header(alias=CSRF_HEADER)] = None,
) -> RefreshResponse:
    body, issued = await service.refresh(session, refresh_token, csrf_cookie, csrf_header)
    _set_session_cookies(response, issued)
    return body
