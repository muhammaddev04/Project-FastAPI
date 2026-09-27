"""Optional "Continue with Google" (F-1.9, CR-001): authorization code + state + PKCE + nonce, server-side exchange,
link by Google `sub` only, refuse an email that already has an unlinked account, then a normal TezFarmo session.
Google's token endpoint is answered by an httpx.MockTransport; nothing leaves the machine."""

from __future__ import annotations

import base64
import hashlib
import logging
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.config import get_settings
from app.modules.auth import google
from app.modules.auth.models import RefreshToken
from app.modules.identity.models import OAuthIdentity, User
from tests.auth.test_refresh import LOGIN, ME, PASSWORD, make_account, set_cookies

START = "/api/v1/auth/google/start"
CALLBACK = "/api/v1/auth/google/callback"
CLIENT_ID = "test-client.apps.googleusercontent.com"
CLIENT_SECRET = "test-client-secret-never-leaves-backend"
REDIRECT = "http://localhost:5174/auth/google/callback"
_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def configured(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", CLIENT_ID)
    monkeypatch.setattr(settings, "google_client_secret", CLIENT_SECRET)
    monkeypatch.setattr(settings, "google_redirect_uri", REDIRECT)
    yield
    google._transport = None


@dataclass
class Started:
    state: str
    nonce: str
    challenge: str
    binding: str
    location: str


async def start(client: AsyncClient) -> Started:
    response = await client.get(START, follow_redirects=False)
    assert response.status_code == 302, response.text
    location = response.headers["location"]
    query = {key: values[0] for key, values in parse_qs(urlparse(location).query).items()}
    binding = set_cookies(response)["google_oauth"].split(";", 1)[0].split("=", 1)[1]
    client.cookies.clear()
    return Started(query["state"], query["nonce"], query["code_challenge"], binding, location)


def id_token(issued_nonce: str, **overrides: object) -> str:
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": "google-sub-1",
        "email": "Nigina@Gmail.com",
        "email_verified": True,
        "name": "Nigina Karimova",
        "iat": now,
        "exp": now + 3600,
        "nonce": issued_nonce,
    }
    claims.update(overrides)
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, _KEY, algorithm="RS256")


def google_answers(handler: Callable[[httpx.Request], httpx.Response]) -> list[httpx.Request]:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    google._transport = httpx.MockTransport(record)
    return seen


def token_response(issued_nonce: str, **overrides: object) -> Callable[[httpx.Request], httpx.Response]:
    return lambda _request: httpx.Response(
        200, json={"id_token": id_token(issued_nonce, **overrides), "access_token": "g"}
    )


async def callback(
    client: AsyncClient, started: Started, *, binding: str | None = None, code: str = "code-1"
) -> Response:
    cookie = binding if binding is not None else started.binding
    headers = {"Cookie": f"google_oauth={cookie}"} if cookie else {}
    response = await client.post(CALLBACK, json={"code": code, "state": started.state}, headers=headers)
    client.cookies.clear()
    return response


def code(response: Response) -> str:
    return response.json()["error"]["code"]


async def users(session: AsyncSession) -> int:
    session.expire_all()
    return await session.scalar(select(func.count()).select_from(User)) or 0


# --- start ---------------------------------------------------------------------------------------------------------


async def test_start_redirects_to_google_with_state_nonce_and_pkce(client: AsyncClient) -> None:
    response = await client.get(START, follow_redirects=False)

    assert response.status_code == 302
    url = urlparse(response.headers["location"])
    assert f"{url.scheme}://{url.netloc}{url.path}" == google.AUTHORIZE_URL
    query = {key: values[0] for key, values in parse_qs(url.query).items()}
    assert query["client_id"] == CLIENT_ID and query["redirect_uri"] == REDIRECT
    assert query["response_type"] == "code" and query["scope"] == "openid email profile"
    assert query["code_challenge_method"] == "S256" and len(query["code_challenge"]) == 43
    assert len(query["state"]) >= 43 and len(query["nonce"]) >= 43
    assert CLIENT_SECRET not in response.headers["location"] and CLIENT_SECRET not in response.text
    cookie = set_cookies(response)["google_oauth"].lower()
    for attribute in ("httponly", "secure", "samesite=lax", "path=/api/v1/auth/google", "max-age=600"):
        assert attribute in cookie
    assert response.headers["Cache-Control"] == "no-store"


async def test_google_is_offered_only_when_configured(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    assert (await client.get("/api/v1/meta")).json()["auth"]["google"] is True
    monkeypatch.setattr(get_settings(), "google_client_secret", "")

    assert (await client.get("/api/v1/meta")).json()["auth"]["google"] is False
    refused = await client.get(START, follow_redirects=False)
    assert refused.status_code == 422 and code(refused) == "not_supported"


# --- callback: new, returning, refused -----------------------------------------------------------------------------


async def test_new_google_user_is_created_verified_and_signed_in(client: AsyncClient, session: AsyncSession) -> None:
    started = await start(client)
    seen = google_answers(token_response(started.nonce))

    response = await callback(client, started)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user"]["email"] == "nigina@gmail.com" and body["user"]["email_verified"] is True
    assert body["user"]["full_name"] == "Nigina Karimova" and body["expires_in"] == 900
    jar = set_cookies(response)
    assert "httponly" in jar["refresh_token"].lower() and "csrf_token" in jar
    assert "max-age=0" in jar["google_oauth"].lower()
    # The exchange used our secret and the PKCE verifier that matches the challenge sent to Google.
    [exchange] = seen
    form = {key: values[0] for key, values in parse_qs(exchange.content.decode()).items()}
    assert str(exchange.url) == google.TOKEN_URL
    assert form["code"] == "code-1" and form["client_secret"] == CLIENT_SECRET and form["redirect_uri"] == REDIRECT
    digest = base64.urlsafe_b64encode(hashlib.sha256(form["code_verifier"].encode()).digest()).rstrip(b"=").decode()
    assert digest == started.challenge
    user = await session.scalar(select(User).where(User.email == "nigina@gmail.com"))
    assert user is not None and user.email_verified_at is not None
    identity = await session.scalar(select(OAuthIdentity).where(OAuthIdentity.user_id == user.id))
    assert identity is not None and identity.subject == "google-sub-1" and identity.provider == "google"
    me = await client.get(ME, headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200 and me.json()["id"] == str(user.id)
    actions = (await session.scalars(select(AuditLog.action).where(AuditLog.entity_id == user.id))).all()
    assert set(actions) == {"user.registered", "auth.login"}


async def test_returning_google_user_signs_in_to_the_same_account(client: AsyncClient, session: AsyncSession) -> None:
    first = await start(client)
    google_answers(token_response(first.nonce))
    user_id = (await callback(client, first)).json()["user"]["id"]
    before = await users(session)

    again = await start(client)
    # Google may report a changed email; the link is the `sub`, not the address.
    google_answers(token_response(again.nonce, email="renamed@gmail.com"))
    response = await callback(client, again, code="code-2")

    assert response.status_code == 200 and response.json()["user"]["id"] == user_id
    assert await users(session) == before
    rows = (await session.scalars(select(RefreshToken).where(RefreshToken.user_id.is_not(None)))).all()
    assert len({row.family_id for row in rows}) == 2  # two separate sessions


async def test_existing_password_account_is_not_linked_by_email(client: AsyncClient, session: AsyncSession) -> None:
    await make_account(session, "nigina@gmail.com")
    before = await users(session)
    started = await start(client)
    google_answers(token_response(started.nonce))

    response = await callback(client, started)

    assert response.status_code == 409 and code(response) == "oauth_account_exists"
    assert "refresh_token" not in set_cookies(response)
    assert await users(session) == before
    assert await session.scalar(select(func.count()).select_from(OAuthIdentity)) == 0
    # The owner still signs in with the password.
    assert (await client.post(LOGIN, json={"email": "nigina@gmail.com", "password": PASSWORD})).status_code == 200


async def test_unverified_google_email_is_refused(client: AsyncClient, session: AsyncSession) -> None:
    started = await start(client)
    google_answers(token_response(started.nonce, email_verified=False))

    response = await callback(client, started)

    assert response.status_code == 403 and code(response) == "oauth_email_not_verified"
    assert await users(session) == 0


async def test_blocked_linked_user_is_refused(client: AsyncClient, session: AsyncSession) -> None:
    first = await start(client)
    google_answers(token_response(first.nonce))
    user_id = (await callback(client, first)).json()["user"]["id"]
    user = await session.get(User, user_id)
    assert user is not None
    user.status = "BLOCKED"
    await session.commit()

    again = await start(client)
    google_answers(token_response(again.nonce))
    response = await callback(client, again, code="code-2")

    assert response.status_code == 403 and code(response) == "user_blocked"
    assert "refresh_token" not in set_cookies(response)


async def test_google_created_account_has_no_usable_password(client: AsyncClient) -> None:
    started = await start(client)
    google_answers(token_response(started.nonce))
    await callback(client, started)

    for password in ("", PASSWORD, "Nigina2026x"):
        response = await client.post(LOGIN, json={"email": "nigina@gmail.com", "password": password or "x"})
        assert response.status_code == 401


# --- state, binding and replay -------------------------------------------------------------------------------------


async def test_state_is_single_use(client: AsyncClient) -> None:
    started = await start(client)
    google_answers(token_response(started.nonce))
    assert (await callback(client, started)).status_code == 200

    replay = await callback(client, started, code="code-2")

    assert replay.status_code == 400 and code(replay) == "oauth_state_invalid"


@pytest.mark.parametrize("binding", ["", "someone-elses-binding"])
async def test_state_from_another_browser_is_refused(client: AsyncClient, session: AsyncSession, binding: str) -> None:
    started = await start(client)
    seen = google_answers(token_response(started.nonce))

    response = await callback(client, started, binding=binding)

    assert response.status_code == 400 and code(response) == "oauth_state_invalid"
    assert seen == []  # the code is never exchanged
    assert await users(session) == 0


async def test_unknown_state_is_refused(client: AsyncClient) -> None:
    started = await start(client)
    forged = Started("forged-state", started.nonce, started.challenge, started.binding, started.location)

    response = await callback(client, forged)

    assert response.status_code == 400 and code(response) == "oauth_state_invalid"


# --- Google's answer -----------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"aud": "another-client"},
        {"iss": "https://evil.example"},
        {"nonce": "wrong-nonce"},
        {"exp": int(time.time()) - 60},
        {"sub": None},
    ],
)
async def test_id_token_claims_are_checked(
    client: AsyncClient, session: AsyncSession, overrides: dict[str, object]
) -> None:
    started = await start(client)
    google_answers(token_response(started.nonce, **overrides))

    response = await callback(client, started)

    assert response.status_code == 400 and code(response) == "oauth_failed"
    assert await users(session) == 0


async def test_refused_code_is_oauth_failed(client: AsyncClient) -> None:
    started = await start(client)
    google_answers(lambda _r: httpx.Response(400, json={"error": "invalid_grant"}))

    response = await callback(client, started)

    assert response.status_code == 400 and code(response) == "oauth_failed"


async def test_unreachable_google_is_service_unavailable(client: AsyncClient) -> None:
    started = await start(client)

    def fail(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    google_answers(fail)
    response = await callback(client, started)

    assert response.status_code == 503 and code(response) == "service_unavailable"


@pytest.mark.parametrize(
    "payload", [{}, {"code": "c"}, {"state": "s"}, {"code": "", "state": "s"}, {"code": "c", "state": "s", "x": 1}]
)
async def test_malformed_callback_is_a_validation_error(client: AsyncClient, payload: dict[str, object]) -> None:
    response = await client.post(CALLBACK, json=payload)
    assert response.status_code == 422 and code(response) == "validation_error"


async def test_secrets_stay_out_of_responses_and_logs(
    client: AsyncClient, session: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        started = await start(client)
        seen = google_answers(token_response(started.nonce))
        response = await callback(client, started)
        refused = await start(client)
        google_answers(lambda _r: httpx.Response(400, json={"error": "invalid_grant"}))
        failed = await callback(client, refused)

    verifier = parse_qs(seen[0].content.decode())["code_verifier"][0]
    for secret in (CLIENT_SECRET, verifier, started.binding, "code-1"):
        assert secret not in caplog.text
        assert secret not in response.text + failed.text
    for entry in (await session.scalars(select(AuditLog))).all():
        assert CLIENT_SECRET not in str(entry.new_data) and verifier not in str(entry.new_data)


# --- the Google link is persistent; sessions come and go --------------------------------------------------------


async def google_session(client: AsyncClient, code_value: str, **claims: object) -> Response:
    started = await start(client)
    google_answers(token_response(started.nonce, **claims))
    return await callback(client, started, code=code_value)


async def identities(session: AsyncSession) -> list[OAuthIdentity]:
    session.expire_all()
    return list((await session.scalars(select(OAuthIdentity))).all())


async def test_linked_google_account_signs_in_again_after_every_logout(
    client: AsyncClient, session: AsyncSession
) -> None:
    from tests.auth.test_logout import log_out
    from tests.auth.test_refresh import rotate, session_from

    user_ids = set()
    for round_number in range(3):
        response = await google_session(client, f"code-{round_number}")
        assert response.status_code == 200, response.text
        current = session_from(response)
        me = await client.get(ME, headers={"Authorization": f"Bearer {current.access}"})
        assert me.status_code == 200 and me.json()["email"] == "nigina@gmail.com"
        user_ids.add(me.json()["id"])
        # The session behaves normally: refresh (reload) works, then logout ends it.
        refreshed = await rotate(client, current)
        assert refreshed.status_code == 200
        current = session_from(refreshed, current.csrf)
        assert (await log_out(client, current)).status_code == 204
        assert (await rotate(client, current)).status_code == 401
        # Logout ends the session, never the Google link.
        [identity] = await identities(session)
        assert identity.subject == "google-sub-1" and str(identity.user_id) in user_ids

    assert len(user_ids) == 1  # always the same TezFarmo account
    assert await users(session) == 1
    assert len(await identities(session)) == 1
    session.expire_all()
    logins = (await session.scalars(select(AuditLog).where(AuditLog.action == "auth.login"))).all()
    assert len(logins) == 3 and all(entry.new_data == {"method": "google"} for entry in logins)


async def test_password_account_with_this_google_account_linked_signs_in_with_google(
    client: AsyncClient, session: AsyncSession
) -> None:
    user_id, email = await make_account(session, "nigina@gmail.com")
    session.add(
        OAuthIdentity(user_id=user_id, provider="google", subject="google-sub-1", email=email, email_verified=True)
    )
    await session.commit()

    response = await google_session(client, "code-1")

    assert response.status_code == 200, response.text
    assert response.json()["user"]["id"] == str(user_id)
    assert await users(session) == 1
    # The password still works too: linking adds a way in, it does not replace one.
    assert (await client.post(LOGIN, json={"email": email, "password": PASSWORD})).status_code == 200


async def test_another_google_account_with_the_same_email_does_not_take_over(
    client: AsyncClient, session: AsyncSession
) -> None:
    first = await google_session(client, "code-1")
    owner_id = first.json()["user"]["id"]

    intruder = await google_session(client, "code-2", sub="google-sub-OTHER")

    assert intruder.status_code == 409 and code(intruder) == "oauth_account_exists"
    assert "refresh_token" not in set_cookies(intruder)
    [identity] = await identities(session)
    assert identity.subject == "google-sub-1" and str(identity.user_id) == owner_id
    assert await users(session) == 1


async def test_one_google_account_links_to_one_user_only(session: AsyncSession) -> None:
    from sqlalchemy.exc import IntegrityError

    first_id, _ = await make_account(session, "a@example.tj")
    second_id, _ = await make_account(session, "b@example.tj")
    session.add(OAuthIdentity(user_id=first_id, provider="google", subject="google-sub-1"))
    await session.commit()

    session.add(OAuthIdentity(user_id=second_id, provider="google", subject="google-sub-1"))
    with pytest.raises(IntegrityError):
        await session.commit()
    await session.rollback()
    # ... and one user holds at most one Google account.
    session.add(OAuthIdentity(user_id=first_id, provider="google", subject="google-sub-2"))
    with pytest.raises(IntegrityError):
        await session.commit()
