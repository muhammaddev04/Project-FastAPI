"""Optional "Continue with Google" (F-1.9 [desirable], CR-001: an extra method; email + password stay primary).

Authorization-code flow with `state`, PKCE (S256) and `nonce`; the code is exchanged server-side with the client
secret, which never leaves the backend. The one-time transaction lives in Redis (10 min, single use) and is bound to
the starting browser by an httpOnly cookie, so a code+state pair cannot be replayed from another browser.

Account rules (owner decision; TZ does not define linking):
- a Google identity is linked by its `sub` only (`oauth_identities`), never by email alone;
- a known `sub` signs its user in;
- an unknown `sub` whose verified email is new creates a user with a confirmed email (Google verified it);
- an unknown `sub` whose email already has a TezFarmo account is refused (`oauth_account_exists`): the owner signs
  in with email + password; nothing is linked or created;
- Google must report the email as verified.

Linking (owner request): a signed-in user may link a Google account to their own account explicitly. That flow uses
its own transaction purpose (`LINK_GOOGLE`, bound to the user id and the browser), so a login callback never links
and a link callback never signs anyone in. The user proves control of the TezFarmo account (their session) and of the
Google account (the OAuth round trip); the email plays no part.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlencode
from uuid import UUID

import httpx
import jwt
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.redis import get_redis
from app.core.security import hash_password
from app.core.time import utcnow
from app.modules.auth.sessions import IssuedSession, start_session
from app.modules.identity.models import OAuthIdentity, User

logger = logging.getLogger("tezfarmo.auth.google")

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")
#: Browser-binding cookie of the pending transaction; scoped to the Google endpoints only.
BINDING_COOKIE = "google_oauth"
COOKIE_PATH = "/api/v1/auth/google"
TRANSACTION_SECONDS = 600
LOGIN = "LOGIN"
LINK = "LINK_GOOGLE"
_TIMEOUT_SECONDS = 10
#: Tests answer Google's token endpoint with an `httpx.MockTransport`; production uses the real network.
_transport: httpx.AsyncBaseTransport | None = None


def _require_configured() -> None:
    if not get_settings().google_configured:
        raise AppError("not_supported", 422)


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _key(state: str) -> str:
    return f"oauth:google:{_digest(state)}"


@dataclass(frozen=True)
class GoogleStart:
    authorization_url: str
    binding: str


async def start(purpose: str = LOGIN, user_id: UUID | None = None) -> GoogleStart:
    """New transaction: random state, PKCE verifier and nonce kept server-side; the URL carries only derived values.
    `purpose` (and, for linking, the user) is stored with it, so the result can only finish the flow it started."""
    _require_configured()
    settings = get_settings()
    state, verifier, nonce, binding = (secrets.token_urlsafe(32) for _ in range(4))
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    record = {"verifier": verifier, "nonce": nonce, "binding": _digest(binding), "purpose": purpose}
    if user_id is not None:
        record["user_id"] = str(user_id)
    await get_redis().set(_key(state), json.dumps(record), ex=TRANSACTION_SECONDS)
    query = urlencode(
        {
            "client_id": settings.google_client_id,
            "redirect_uri": settings.google_redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
    )
    return GoogleStart(authorization_url=f"{AUTHORIZE_URL}?{query}", binding=binding)


async def _take_transaction(state: str, binding: str | None) -> dict[str, str]:
    """Single use: the record is deleted as it is read, whatever happens next."""
    raw = await get_redis().getdel(_key(state))
    if raw is None or not binding:
        raise AppError("oauth_state_invalid", 400)
    record: dict[str, str] = json.loads(raw)
    if not hmac.compare_digest(record["binding"], _digest(binding)):
        raise AppError("oauth_state_invalid", 400)
    return record


async def _exchange(code: str, verifier: str) -> str:
    """Server-side code exchange (client secret + PKCE verifier); returns Google's id_token."""
    settings = get_settings()
    data = {
        "code": code,
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "redirect_uri": settings.google_redirect_uri,
        "grant_type": "authorization_code",
        "code_verifier": verifier,
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS, transport=_transport) as client:
            response = await client.post(TOKEN_URL, data=data, headers={"Accept": "application/json"})
    except httpx.HTTPError as exc:
        logger.warning("google token exchange unreachable (%s)", type(exc).__name__)
        raise AppError("service_unavailable", 503) from exc
    if response.status_code != 200:
        # Log only known OAuth error codes, never Google's free-form body or request credentials.
        try:
            body = response.json()
        except ValueError:
            body = {}
        reason = body.get("error") if isinstance(body, dict) else None
        if reason not in ("invalid_client", "invalid_grant", "invalid_request", "unauthorized_client"):
            reason = "unknown_error"
        logger.warning("google token exchange refused (HTTP %s, %s)", response.status_code, reason)
        raise AppError("oauth_failed", 400)
    id_token = response.json().get("id_token")
    if not isinstance(id_token, str):
        logger.warning("google token exchange returned no id_token")
        raise AppError("oauth_failed", 400)
    return id_token


def _claims(id_token: str, nonce: str) -> dict[str, object]:
    """OpenID Connect ID token checks. The token came straight from Google's token endpoint over TLS in exchange for
    our client secret, so (per OIDC Core 3.1.3.7) its origin is established; the claims are still all checked."""
    try:
        claims: dict[str, object] = jwt.decode(
            id_token,
            options={
                "verify_signature": False,
                "verify_exp": True,
                "verify_iat": True,
                "verify_aud": True,
                "require": ["iss", "aud", "sub", "exp", "iat"],
            },
            audience=get_settings().google_client_id,
            algorithms=["RS256"],
        )
    except jwt.PyJWTError as exc:
        logger.warning("google id_token validation failed (%s)", type(exc).__name__)
        raise AppError("oauth_failed", 400) from exc
    if claims.get("iss") not in ISSUERS or not hmac.compare_digest(str(claims.get("nonce", "")), nonce):
        logger.warning("google id_token issuer or nonce mismatch")
        raise AppError("oauth_failed", 400)
    return claims


def _display_name(claims: dict[str, object], email: str) -> str:
    name = " ".join(str(claims.get("name") or "").split())[:150]
    if len(name) >= 2:
        return name
    local = email.partition("@")[0]
    return (local if len(local) >= 2 else email)[:150]


async def _user_for(session: AsyncSession, claims: dict[str, object], language: str) -> User:
    subject = str(claims["sub"])
    identity = await session.scalar(
        select(OAuthIdentity).where(OAuthIdentity.provider == "google", OAuthIdentity.subject == subject)
    )
    if identity is not None:
        user = await session.get(User, identity.user_id)
        if user is None:
            raise AppError("oauth_failed", 400)
        return user

    email = str(claims.get("email") or "").strip().lower()
    if not email or claims.get("email_verified") is not True:
        raise AppError("oauth_email_not_verified", 403)
    if await session.scalar(select(User.id).where(func.lower(User.email) == email)) is not None:
        # Never linked by email alone: the owner of this address signs in with email + password.
        raise AppError("oauth_account_exists", 409)

    user = User(
        email=email,
        full_name=_display_name(claims, email),
        # Password sign-in stays impossible until the owner sets a password through reset (IAM-015).
        password_hash=hash_password(secrets.token_urlsafe(48)),
        language=language,
        email_verified_at=utcnow(),
    )
    try:
        async with session.begin_nested():
            session.add(user)
            await session.flush()
            session.add(
                OAuthIdentity(user_id=user.id, provider="google", subject=subject, email=email, email_verified=True)
            )
            await session.flush()
    except IntegrityError as exc:
        # The same address or Google account was registered concurrently.
        raise AppError("oauth_account_exists", 409) from exc
    await audit.record(
        session,
        "user.registered",
        "user",
        user.id,
        actor_id=user.id,
        new={"language": language, "email_verified": True, "method": "google"},
    )
    return user


async def complete(
    session: AsyncSession, code: str, state: str, binding: str | None, language: str
) -> tuple[User, IssuedSession]:
    """Callback: check the transaction, exchange the code, resolve the user and start a normal TezFarmo session."""
    _require_configured()
    record = await _take_transaction(state, binding)
    if record.get("purpose", LOGIN) != LOGIN:  # a link transaction never signs anyone in
        raise AppError("oauth_state_invalid", 400)
    claims = _claims(await _exchange(code, record["verifier"]), record["nonce"])
    user = await _user_for(session, claims, language)
    if user.status != "ACTIVE":
        raise AppError("user_blocked", 403)
    issued = await start_session(session, user)
    user.last_login_at = utcnow()
    await audit.record(session, "auth.login", "user", user.id, actor_id=user.id, new={"method": "google"})
    await session.flush()
    return user, issued


# --- linking a Google account to the signed-in user -----------------------------------------------------------------


@dataclass(frozen=True)
class GoogleLink:
    status: str  # "linked" | "already_linked"
    email: str | None
    linked_at: datetime


async def _identity_of(session: AsyncSession, user_id: UUID) -> OAuthIdentity | None:
    return await session.scalar(
        select(OAuthIdentity).where(OAuthIdentity.provider == "google", OAuthIdentity.user_id == user_id)
    )


async def link_status(session: AsyncSession, user: User) -> GoogleLink | None:
    identity = await _identity_of(session, user.id)
    if identity is None:
        return None
    return GoogleLink(status="linked", email=identity.email, linked_at=identity.created_at)


async def link_start(session: AsyncSession, user: User) -> GoogleStart:
    """Start linking for the signed-in user; one Google account per user (`oauth_provider_already_linked`)."""
    _require_configured()
    if await _identity_of(session, user.id) is not None:
        raise AppError("oauth_provider_already_linked", 409)
    return await start(LINK, user.id)


async def link_complete(session: AsyncSession, user: User, code: str, state: str, binding: str | None) -> GoogleLink:
    """Finish linking: the transaction must be a LINK started by this same user in this same browser. Links Google's
    `sub` to the user; a `sub` already linked to someone else is refused and never moved."""
    _require_configured()
    record = await _take_transaction(state, binding)
    if record.get("purpose") != LINK or not hmac.compare_digest(record.get("user_id", ""), str(user.id)):
        raise AppError("oauth_state_invalid", 400)
    claims = _claims(await _exchange(code, record["verifier"]), record["nonce"])
    subject = str(claims["sub"])
    email = str(claims.get("email") or "").strip().lower() or None

    existing = await session.scalar(
        select(OAuthIdentity).where(OAuthIdentity.provider == "google", OAuthIdentity.subject == subject)
    )
    if existing is not None:
        if existing.user_id == user.id:
            return GoogleLink(status="already_linked", email=existing.email, linked_at=existing.created_at)
        # Linked to another TezFarmo account: never moved, merged or overwritten; nothing about that account leaks.
        raise AppError("oauth_identity_already_linked", 409)
    if await _identity_of(session, user.id) is not None:
        raise AppError("oauth_provider_already_linked", 409)

    identity = OAuthIdentity(
        user_id=user.id,
        provider="google",
        subject=subject,
        email=email,
        email_verified=claims.get("email_verified") is True,
    )
    try:
        async with session.begin_nested():
            session.add(identity)
            await session.flush()
    except IntegrityError as exc:  # linked concurrently (same sub elsewhere, or a second link for this user)
        raise AppError("oauth_identity_already_linked", 409) from exc
    await audit.record(
        session,
        "auth.google_linked",
        "user",
        user.id,
        actor_id=user.id,
        new={"provider": "google", "identity_id": str(identity.id)},
    )
    await session.flush()
    return GoogleLink(status="linked", email=identity.email, linked_at=identity.created_at)
