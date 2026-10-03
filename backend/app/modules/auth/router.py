from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Cookie, Header, Request, Response, status
from fastapi.responses import RedirectResponse

from app.core.i18n import resolve_language
from app.core.time import utcnow
from app.modules.auth import google, service
from app.modules.auth.schemas import (
    GoogleCallbackRequest,
    GoogleLinkOut,
    GoogleLinkStartResponse,
    LoginRequest,
    LoginResponse,
    PasswordChangeRequest,
    PasswordResetCompleteRequest,
    PasswordResetStartRequest,
    PasswordResetVerifyRequest,
    PasswordResetVerifyResponse,
    RefreshResponse,
    RegisterRequest,
    ResendVerificationRequest,
    VerifyEmailRequest,
)
from app.modules.auth.sessions import CSRF_COOKIE, CSRF_HEADER, REFRESH_COOKIE, IssuedSession
from app.modules.identity.deps import CurrentUser, SessionDep
from app.modules.identity.service import build_me

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
    response_model=LoginResponse,
    summary="Confirm the email address with the 6-digit code from the verification email (IAM-002, CR-001)",
    responses={
        200: {"description": "The email is confirmed and a session is started; the code can no longer be used."},
        403: {"description": "`user_blocked`: blocked users cannot start a session."},
        422: {
            "description": "`validation_error` (email, or a code that is not exactly 6 digits), `email_token_invalid` "
            "(wrong, already used, or unknown address - indistinguishable) or `email_token_expired`."
        },
        429: {
            "description": "`rate_limited`: auth_email_verify (10 per hour per IP) or auth_email_code (5 wrong codes "
            "per 15 minutes per email); with Retry-After."
        },
    },
)
async def verify_email(payload: VerifyEmailRequest, session: SessionDep, response: Response) -> LoginResponse:
    body, issued = await service.verify_email(session, payload)
    _set_session_cookies(response, issued)
    return body


@router.post(
    "/email/resend",
    status_code=status.HTTP_202_ACCEPTED,
    response_class=Response,
    summary="Send a new 6-digit confirmation code to an unverified address (P01 §6, CR-001)",
    responses={
        202: {"description": "Accepted. The same answer for unknown, verified and unverified addresses."},
        422: {"description": "`validation_error`."},
        429: {
            "description": "`email_resend_too_early` (60 s after the previous email) or `rate_limited` "
            "(auth_email_send, 5 per hour per email); both with Retry-After."
        },
        503: {"description": "`service_unavailable`: the email could not be sent; the earlier code stays valid."},
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


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="End this device's session: revoke its refresh family and clear the cookies (IAM-008, SEC-005)",
    responses={
        204: {"description": "Logged out (also when this session had already ended). Session cookies are cleared."},
        401: {"description": "`not_authenticated` (no cookie) or `token_invalid`."},
        403: {"description": "`permission_denied` (CSRF check failed)."},
    },
)
async def logout(
    session: SessionDep,
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
    csrf_cookie: Annotated[str | None, Cookie(alias=CSRF_COOKIE)] = None,
    csrf_header: Annotated[str | None, Header(alias=CSRF_HEADER)] = None,
) -> Response:
    await service.logout(session, refresh_token, csrf_cookie, csrf_header)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    # Deletion must repeat the attributes the cookies were set with, or browsers keep the originals.
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth", secure=True, httponly=True, samesite="strict")
    response.delete_cookie(CSRF_COOKIE, path="/", secure=True, httponly=False, samesite="strict")
    response.headers["Cache-Control"] = "no-store"
    return response


@router.post(
    "/password/reset/start",
    status_code=status.HTTP_202_ACCEPTED,
    response_class=Response,
    summary="Email a 6-digit code for choosing a new password (IAM-015, CR-001)",
    responses={
        202: {"description": "Accepted. The same answer whether or not the email is registered."},
        422: {"description": "`validation_error`."},
        429: {"description": "`rate_limited` (password_reset, 3 per hour per email), with Retry-After."},
        503: {"description": "`service_unavailable`: the email could not be sent; the earlier code stays valid."},
    },
)
async def start_password_reset(payload: PasswordResetStartRequest, session: SessionDep) -> Response:
    await service.start_password_reset(session, payload)
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post(
    "/password/reset/verify",
    response_model=PasswordResetVerifyResponse,
    summary="Check the 6-digit reset code and get a one-time reset authorization (IAM-015)",
    responses={
        200: {"description": "`{reset_token, expires_in}`: single use, 10 minutes, only for password/reset/complete."},
        422: {
            "description": "`validation_error` (email, or a code that is not exactly 6 digits), `email_token_invalid` "
            "(wrong, already used, or unknown address - indistinguishable) or `email_token_expired`."
        },
        429: {
            "description": "`rate_limited`: auth_email_verify (10 per hour per IP) or password_reset_code (5 wrong "
            "codes per 30 minutes per email); with Retry-After."
        },
    },
)
async def verify_password_reset(
    payload: PasswordResetVerifyRequest, session: SessionDep, response: Response
) -> PasswordResetVerifyResponse:
    body = await service.verify_password_reset(session, payload)
    response.headers["Cache-Control"] = "no-store"
    return body


@router.post(
    "/password/reset/complete",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Set a new password with the reset authorization from /verify; signs out every device (IAM-015)",
    responses={
        204: {"description": "Password changed; the authorization is used up, all sessions and access tokens end."},
        422: {
            "description": "`validation_error`, `weak_password` (IAM-003), `email_token_invalid` (unknown or "
            "already used) or `email_token_expired`."
        },
    },
)
async def complete_password_reset(payload: PasswordResetCompleteRequest, session: SessionDep) -> Response:
    await service.complete_password_reset(session, payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/password/change",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Change the password with the current one; signs out every device (IAM-008, IAM-003)",
    responses={
        204: {"description": "Password changed; token_version++ and every refresh session is revoked."},
        401: {
            "description": "`not_authenticated`, `token_invalid`, `token_expired`, or `invalid_credentials` "
            "(wrong current password)."
        },
        403: {"description": "`user_blocked`."},
        422: {"description": "`validation_error` or `weak_password` (IAM-003)."},
        429: {"description": "`rate_limited` (default_authenticated)."},
    },
)
async def change_password(payload: PasswordChangeRequest, session: SessionDep, user: CurrentUser) -> Response:
    await service.change_password(session, user, payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/google/start",
    status_code=status.HTTP_302_FOUND,
    response_class=RedirectResponse,
    summary="Continue with Google: redirect to Google's consent screen (F-1.9, optional)",
    responses={
        302: {"description": "To Google, with state, nonce and a PKCE challenge; sets the httpOnly binding cookie."},
        422: {"description": "`not_supported`: Google sign-in is not configured on this server."},
    },
)
async def google_start() -> RedirectResponse:
    started = await google.start()
    response = RedirectResponse(started.authorization_url, status_code=status.HTTP_302_FOUND)
    # Lax: the cookie must survive the top-level return from Google; scoped to the Google endpoints only.
    response.set_cookie(
        google.BINDING_COOKIE,
        started.binding,
        max_age=google.TRANSACTION_SECONDS,
        path=google.COOKIE_PATH,
        secure=True,
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@router.post(
    "/google/callback",
    response_model=LoginResponse,
    summary="Finish Continue with Google: exchange the code server-side and sign in (F-1.9, optional)",
    responses={
        200: {"description": "Same as login: `{access_token, expires_in, user}` plus the refresh and CSRF cookies."},
        400: {"description": "`oauth_state_invalid` (expired, reused or from another browser) or `oauth_failed`."},
        403: {"description": "`oauth_email_not_verified` or `user_blocked`."},
        409: {"description": "`oauth_account_exists`: the email belongs to an account not linked to this Google user."},
        422: {"description": "`validation_error` or `not_supported`."},
        503: {"description": "`service_unavailable`: Google could not be reached."},
    },
)
async def google_callback(
    payload: GoogleCallbackRequest,
    request: Request,
    session: SessionDep,
    response: Response,
    binding: Annotated[str | None, Cookie(alias=google.BINDING_COOKIE)] = None,
) -> LoginResponse:
    language = resolve_language(request.headers.get("accept-language"))
    user, issued = await google.complete(session, payload.code, payload.state, binding, language)
    body = LoginResponse(
        access_token=issued.access_token, expires_in=issued.expires_in, user=await build_me(session, user)
    )
    _set_session_cookies(response, issued)
    response.delete_cookie(google.BINDING_COOKIE, path=google.COOKIE_PATH, secure=True, httponly=True, samesite="lax")
    return body


def _link_out(link: google.GoogleLink | None) -> GoogleLinkOut:
    if link is None:
        return GoogleLinkOut(connected=False)
    return GoogleLinkOut(connected=True, status=link.status, email=link.email, linked_at=link.linked_at)  # type: ignore[arg-type]


@router.get(
    "/google/link",
    response_model=GoogleLinkOut,
    summary="Is a Google account connected to the signed-in user? (access)",
)
async def google_link_status(session: SessionDep, user: CurrentUser) -> GoogleLinkOut:
    return _link_out(await google.link_status(session, user))


@router.post(
    "/google/link/start",
    response_model=GoogleLinkStartResponse,
    summary="Start linking a Google account to the signed-in user (access); returns Google's consent URL",
    responses={
        409: {"description": "`oauth_provider_already_linked`: this user already has a Google account connected."},
        422: {"description": "`not_supported`: Google sign-in is not configured on this server."},
    },
)
async def google_link_start(session: SessionDep, user: CurrentUser, response: Response) -> GoogleLinkStartResponse:
    started = await google.link_start(session, user)
    response.set_cookie(
        google.BINDING_COOKIE,
        started.binding,
        max_age=google.TRANSACTION_SECONDS,
        path=google.COOKIE_PATH,
        secure=True,
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"
    return GoogleLinkStartResponse(authorization_url=started.authorization_url)


@router.post(
    "/google/link/callback",
    response_model=GoogleLinkOut,
    summary="Finish linking: exchange the code server-side and link that Google account to the signed-in user",
    responses={
        400: {
            "description": "`oauth_state_invalid` (expired, reused, another browser or user, or not a link flow) "
            "or `oauth_failed`."
        },
        409: {
            "description": "`oauth_identity_already_linked` (that Google account belongs to another TezFarmo "
            "account) or `oauth_provider_already_linked`."
        },
        503: {"description": "`service_unavailable`: Google could not be reached."},
    },
)
async def google_link_callback(
    payload: GoogleCallbackRequest,
    session: SessionDep,
    user: CurrentUser,
    response: Response,
    binding: Annotated[str | None, Cookie(alias=google.BINDING_COOKIE)] = None,
) -> GoogleLinkOut:
    link = await google.link_complete(session, user, payload.code, payload.state, binding)
    response.delete_cookie(google.BINDING_COOKIE, path=google.COOKIE_PATH, secure=True, httponly=True, samesite="lax")
    return _link_out(link)
