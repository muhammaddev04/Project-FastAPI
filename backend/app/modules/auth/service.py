"""P01 registration, email verification, resend, login, refresh, logout, password reset and password change
(IAM-001..008, IAM-015, IAM-016; CR-001).

Registration only creates the user: the organization comes later from `/welcome` (ORG-001). The response never
reveals whether an email is registered: a new address gets a verification link, a known one gets an
"you already have an account" email, and both requests answer `202` the same way.
"""

from __future__ import annotations

import hashlib
from functools import cache
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.config import get_settings
from app.core.email import EmailDeliveryError, OutgoingEmail, get_email
from app.core.email_templates import render
from app.core.errors import AppError
from app.core.events import DomainEvent, event_bus
from app.core.rate_limit import (
    AUTH_EMAIL_SEND,
    AUTH_EMAIL_VERIFY,
    AUTH_LOGIN,
    EMAIL_CODE_ATTEMPTS,
    EMAIL_RESEND_COOLDOWN,
    PASSWORD_RESET,
    RESET_CODE_ATTEMPTS,
    check,
    hit,
    record,
)
from app.core.request_context import get_client_ip
from app.core.security import hash_password, verify_password
from app.core.time import utcnow
from app.modules.auth.password_policy import password_problems
from app.modules.auth.schemas import (
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
from app.modules.auth.sessions import (
    IssuedSession,
    end_session,
    require_csrf,
    revoke_all_sessions,
    rotate_session,
    start_session,
)
from app.modules.auth.tokens import (
    RESET_AUTHORIZATION_LIFETIME,
    TOKEN_LIFETIMES,
    consume_email_code,
    consume_email_token,
    issue_email_code,
    issue_email_token,
)
from app.modules.identity.models import User
from app.modules.identity.service import build_me

VERIFY_EMAIL = "VERIFY_EMAIL"
RESET_PASSWORD = "RESET_PASSWORD"


def _rate_key(email: str) -> str:
    # Keyed by email (P00 §4.1) without storing the address itself in Redis.
    return hashlib.sha256(email.encode()).hexdigest()[:32]


def _link(path: str, token: str | None = None) -> str:
    base = get_settings().frontend_base_url.rstrip("/")
    return f"{base}{path}?token={token}" if token else f"{base}{path}"


async def _deliver(email: OutgoingEmail) -> None:
    """IAM-016: sent directly (not through the outbox); a failed delivery rolls the request back with 503."""
    try:
        await get_email().send(email)
    except EmailDeliveryError as exc:
        raise AppError("service_unavailable", 503) from exc


async def _send_verification(session: AsyncSession, user: User) -> None:
    """New 6-digit VERIFY_EMAIL code (earlier unused ones expire) and the localized code email - no link - in the
    caller's transaction."""
    code = await issue_email_code(session, user.id, VERIFY_EMAIL)
    lifetime_minutes = int(TOKEN_LIFETIMES[VERIFY_EMAIL].total_seconds() // 60)
    await _deliver(
        render(
            "verification",
            user.language,
            to=user.email,
            name=user.full_name,
            code=code,
            minutes=lifetime_minutes,
        )
    )


async def register(session: AsyncSession, payload: RegisterRequest) -> None:
    problems = password_problems(payload.password)
    if problems:
        raise AppError("weak_password", 422, {"fields": [{"field": "password", "code": code} for code in problems]})

    await hit(AUTH_EMAIL_SEND, _rate_key(payload.email))
    # Whatever the address, an email goes out now, so the 60 s resend cooldown starts (P01 §2.2).
    await record(EMAIL_RESEND_COOLDOWN, _rate_key(payload.email))
    # Hash before looking the address up, so known and unknown emails cost about the same time (no enumeration).
    password_hash = hash_password(payload.password)

    existing = await session.scalar(select(User).where(func.lower(User.email) == payload.email))
    if existing is not None:
        await _deliver(
            render(
                "account_exists",
                existing.language,
                to=existing.email,
                name=existing.full_name,
                action_url=_link("/login"),
                minutes=0,
            )
        )
        return

    user = User(
        email=payload.email,
        full_name=payload.full_name,
        password_hash=password_hash,
        language=payload.language,
        # P01 §10 onboarding intent - only for a new user; an existing account is never changed from here.
        onboarding_org_type=payload.org_type,
        onboarding_org_name=payload.org_name if payload.org_type else None,
    )
    try:
        async with session.begin_nested():
            session.add(user)
            await session.flush()
    except IntegrityError:
        # The same address was registered concurrently; answer exactly like any known address.
        return

    await audit.record(
        session,
        "user.registered",
        "user",
        user.id,
        actor_id=user.id,
        new={"language": user.language, "email_verified": False, "onboarding_org_type": user.onboarding_org_type},
    )
    await event_bus.publish(session, DomainEvent("USER_REGISTERED", {"user_id": str(user.id)}))
    await _send_verification(session, user)


async def verify_email(session: AsyncSession, payload: VerifyEmailRequest) -> tuple[LoginResponse, IssuedSession]:
    """IAM-002 with a 6-digit code: the current, unused, unexpired code of that email's account confirms the address
    once, then starts a session so registration continues without a second login.

    A code has only a million values, so wrong guesses are capped per email (`auth_email_code`, 5 per 15 minutes,
    whatever the IP) on top of the per-IP `auth_email_verify` limit. An unknown address and a wrong code give the
    same `email_token_invalid` and count the same way, so the answer does not reveal which accounts exist.
    """
    await hit(AUTH_EMAIL_VERIFY, get_client_ip() or "unknown")
    attempts_key = _rate_key(payload.email)
    await check(EMAIL_CODE_ATTEMPTS, attempts_key)
    user_id = await session.scalar(select(User.id).where(func.lower(User.email) == payload.email))
    try:
        if user_id is None:
            raise AppError("email_token_invalid", 422)
        await consume_email_code(session, user_id, payload.code, VERIFY_EMAIL)
    except AppError:
        await record(EMAIL_CODE_ATTEMPTS, attempts_key)
        raise
    # Keep the first confirmation time if the address was somehow confirmed already; consuming the token is enough.
    verified_at = await session.scalar(
        update(User)
        .where(User.id == user_id, User.email_verified_at.is_(None))
        .values(email_verified_at=utcnow())
        .returning(User.email_verified_at)
    )
    if verified_at is not None:
        await audit.record(
            session, "user.email_verified", "user", user_id, actor_id=user_id, new={"email_verified": True}
        )
    user = await session.scalar(select(User).where(User.id == user_id).with_for_update())
    assert user is not None
    if user.status != "ACTIVE":
        raise AppError("user_blocked", 403)
    issued = await start_session(session, user)
    user.last_login_at = utcnow()
    await audit.record(session, "auth.login", "user", user.id, actor_id=user.id, new={"method": "email_verification"})
    await session.flush()
    return LoginResponse(
        access_token=issued.access_token, expires_in=issued.expires_in, user=await build_me(session, user)
    ), issued


async def resend_verification(session: AsyncSession, payload: ResendVerificationRequest) -> None:
    """P01 §6 `email/resend`: always `202`. Only an unverified account gets a new link; unknown and already
    verified addresses get nothing. The cooldown and hourly limit apply to every address alike, so neither the
    answer nor a 429 reveals whether an account exists or is verified.
    """
    key = _rate_key(payload.email)
    await check(EMAIL_RESEND_COOLDOWN, key)
    await hit(AUTH_EMAIL_SEND, key)
    await record(EMAIL_RESEND_COOLDOWN, key)

    user = await session.scalar(select(User).where(func.lower(User.email) == payload.email))
    if user is None or user.email_verified_at is not None:
        return
    await _send_verification(session, user)


@cache
def _dummy_password_hash() -> str:
    """IAM-004: unknown emails are checked against this hash so they cost the same time as wrong passwords."""
    return hash_password("timing-equalizer-not-a-real-password-0")


async def login(session: AsyncSession, payload: LoginRequest) -> tuple[LoginResponse, IssuedSession]:
    """F-1.2 / IAM-004: email + password. Unknown email and wrong password are the same `invalid_credentials`;
    only after a correct password does the answer say more (`user_blocked`, `email_not_verified`)."""
    limit_key = f"{_rate_key(payload.email)}:{get_client_ip() or 'unknown'}"
    await check(AUTH_LOGIN, limit_key)

    user = await session.scalar(select(User).where(func.lower(User.email) == payload.email))
    password_ok = verify_password(payload.password, user.password_hash if user else _dummy_password_hash())
    if user is None or not password_ok:
        # F-1.6: failed attempts count toward the 5 / 15 min lock, for known and unknown addresses alike.
        await record(AUTH_LOGIN, limit_key)
        if user is not None:
            await audit.record(session, "auth.login_failed", "user", user.id, new={"reason": "invalid_credentials"})
            # Keep the audit row although the request itself fails.
            await session.commit()
        raise AppError("invalid_credentials", 401)
    if user.status != "ACTIVE":
        raise AppError("user_blocked", 403)
    if user.email_verified_at is None:
        raise AppError("email_not_verified", 403)

    issued = await start_session(session, user)
    user.last_login_at = utcnow()
    await audit.record(session, "auth.login", "user", user.id, actor_id=user.id)
    await session.flush()
    return LoginResponse(
        access_token=issued.access_token, expires_in=issued.expires_in, user=await build_me(session, user)
    ), issued


async def refresh(
    session: AsyncSession, refresh_cookie: str | None, csrf_cookie: str | None, csrf_header: str | None
) -> tuple[RefreshResponse, IssuedSession]:
    """P01 §6 `auth/refresh` (cookie + CSRF): the CSRF check comes first, before any token or session is touched."""
    require_csrf(csrf_cookie, csrf_header)
    assert csrf_cookie is not None  # guaranteed by require_csrf
    issued = await rotate_session(session, refresh_cookie, csrf_cookie)
    return RefreshResponse(access_token=issued.access_token, expires_in=issued.expires_in), issued


async def logout(
    session: AsyncSession, refresh_cookie: str | None, csrf_cookie: str | None, csrf_header: str | None
) -> None:
    """P01 §6 `auth/logout` (cookie + CSRF): CSRF first, then this session's family is revoked (IAM-008).

    Committed here, before the caller answers 204, so success is never reported for a revocation that was lost.
    """
    require_csrf(csrf_cookie, csrf_header)
    await end_session(session, refresh_cookie)
    await session.commit()


async def start_password_reset(session: AsyncSession, payload: PasswordResetStartRequest) -> None:
    """IAM-015 `password/reset/start`: always `202`. A registered address gets a 30-minute 6-digit RESET_PASSWORD
    code by email - no link (earlier unused codes and authorizations expire); an unknown one gets nothing. The
    `password_reset` limit counts every address alike, so neither the answer nor a 429 reveals whether an account
    exists.
    """
    await hit(PASSWORD_RESET, _rate_key(payload.email))

    user = await session.scalar(select(User).where(func.lower(User.email) == payload.email))
    if user is None:
        return
    code = await issue_email_code(session, user.id, RESET_PASSWORD)
    await _deliver(
        render(
            "password_reset",
            user.language,
            to=user.email,
            name=user.full_name,
            code=code,
            minutes=int(TOKEN_LIFETIMES[RESET_PASSWORD].total_seconds() // 60),
        )
    )


async def verify_password_reset(
    session: AsyncSession, payload: PasswordResetVerifyRequest
) -> PasswordResetVerifyResponse:
    """IAM-015 step 2: the current, unused, unexpired reset code of that email's account is spent once and exchanged
    for a one-time reset authorization (256 bits, 10 minutes) that only `password/reset/complete` accepts.

    Wrong guesses are capped per email (`password_reset_code`, 5 per 30 minutes, whatever the IP) on top of the
    per-IP `auth_email_verify` limit shared by every email code. An unknown address and a wrong code give the same
    `email_token_invalid` and count the same way, so the answer does not reveal which accounts exist.
    """
    await hit(AUTH_EMAIL_VERIFY, get_client_ip() or "unknown")
    attempts_key = _rate_key(payload.email)
    await check(RESET_CODE_ATTEMPTS, attempts_key)
    user_id = await session.scalar(select(User.id).where(func.lower(User.email) == payload.email))
    try:
        if user_id is None:
            raise AppError("email_token_invalid", 422)
        await consume_email_code(session, user_id, payload.code, RESET_PASSWORD)
    except AppError:
        await record(RESET_CODE_ATTEMPTS, attempts_key)
        raise
    reset_token = await issue_email_token(session, user_id, RESET_PASSWORD, RESET_AUTHORIZATION_LIFETIME)
    await session.commit()
    return PasswordResetVerifyResponse(
        reset_token=reset_token, expires_in=int(RESET_AUTHORIZATION_LIFETIME.total_seconds())
    )


async def complete_password_reset(session: AsyncSession, payload: PasswordResetCompleteRequest) -> None:
    """IAM-015 `password/reset/complete`: a valid reset authorization (from `password/reset/verify`) sets the new
    password once.

    `token_version++` ends every access token and all refresh families are revoked, so every device signs in again
    (IAM-008 "password change"). The policy is checked before the token is touched, so a weak password does not
    use up the link. Committed here, before the caller answers 204.
    """
    problems = password_problems(payload.new_password)
    if problems:
        raise AppError("weak_password", 422, {"fields": [{"field": "new_password", "code": code} for code in problems]})
    password_hash = hash_password(payload.new_password)

    # Single conditional UPDATE: of concurrent requests with one token, only one gets past this line.
    user_id = await consume_email_token(session, payload.token, RESET_PASSWORD)
    await _replace_password(session, user_id, password_hash, "auth.password_reset")


async def change_password(session: AsyncSession, user: User, payload: PasswordChangeRequest) -> None:
    """P01 §6 `password/change` (access): the current password, then the IAM-003 policy, then IAM-008 - the new
    password, `token_version++` and every refresh family revoked, so all devices (this one included) sign in again.

    The user row is locked first and the current password is checked against the locked row, so of concurrent
    changes made with the same old password only one succeeds. Committed here, before the caller answers 204.
    """
    locked = await session.get(User, user.id, with_for_update=True, populate_existing=True)
    if locked is None or not verify_password(payload.current_password, locked.password_hash):
        # Same code as a wrong login password (IAM-004); nothing is changed or audited.
        raise AppError("invalid_credentials", 401)
    problems = password_problems(payload.new_password)
    if problems:
        raise AppError("weak_password", 422, {"fields": [{"field": "new_password", "code": code} for code in problems]})
    await _replace_password(session, locked.id, hash_password(payload.new_password), "auth.password_changed")


async def _replace_password(session: AsyncSession, user_id: UUID, password_hash: str, action: str) -> None:
    """IAM-008 / IAM-015: store the new hash, `token_version++` (old access tokens die), revoke every refresh family
    (old cookies cannot mint new ones), audit `action` with the new version only, and commit."""
    token_version = await session.scalar(
        update(User)
        .where(User.id == user_id)
        .values(password_hash=password_hash, token_version=User.token_version + 1)
        .returning(User.token_version)
        .execution_options(synchronize_session=False)
    )
    await revoke_all_sessions(session, user_id)
    await audit.record(session, action, "user", user_id, actor_id=user_id, new={"token_version": token_version})
    await session.commit()
