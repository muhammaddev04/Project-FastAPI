"""P01 login: F-1.2 / IAM-004 (no enumeration, email_not_verified), IAM-005 access claims, P01 §2.3 refresh
family, SEC-004/005 cookies, auth_login rate limit, §7 audit (CR-001)."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

import jwt
import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.config import get_settings
from app.core.email import MemoryEmailProvider, OutgoingEmail, set_email_provider
from app.core.time import utcnow
from app.modules.auth.models import RefreshToken
from app.modules.identity.models import User
from tests.factories import make_user

LOGIN = "/api/v1/auth/login"
PASSWORD = "Tezfarmo2026"  # tests.factories.make_user
TOKEN_IN_LINK = re.compile(r"/verify-email\?token=([A-Za-z0-9_-]+)")


@pytest.fixture
def outbox() -> Iterator[list[OutgoingEmail]]:
    provider = MemoryEmailProvider()
    set_email_provider(provider)
    yield provider.outbox
    set_email_provider(None)


@dataclass(frozen=True)
class Account:
    """Plain values of a fixture user (safe to read after the test session expires its objects)."""

    id: UUID
    email: str
    token_version: int
    password_hash: str


async def verified_user(session: AsyncSession, email: str = "dilshod@pamir.tj", **extra: object) -> Account:
    user = await make_user(session, full_name="Dilshod Rahimov", email=email, **extra)
    await session.commit()
    return Account(user.id, user.email, user.token_version, user.password_hash)


def cookies(response: Response) -> dict[str, str]:
    """Set-Cookie headers by cookie name (the full header, attributes included)."""
    return {header.split("=", 1)[0]: header for header in response.headers.get_list("set-cookie")}


def cookie_value(header: str) -> str:
    return header.split(";", 1)[0].split("=", 1)[1]


async def refresh_rows(session: AsyncSession) -> list[RefreshToken]:
    session.expire_all()
    return list((await session.scalars(select(RefreshToken))).all())


async def test_register_verify_login_chain(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    email, password = "nigina@example.tj", "Dushanbe2026x"
    registered = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Nigina Karimova", "language": "ru"},
    )
    assert registered.status_code == 202

    early = await client.post(LOGIN, json={"email": email, "password": password})
    assert early.status_code == 403
    assert early.json()["error"]["code"] == "email_not_verified"
    assert "access_token" not in early.text and cookies(early) == {}
    assert await refresh_rows(session) == []

    raw = TOKEN_IN_LINK.search(outbox[-1].text).group(1)  # type: ignore[union-attr]
    assert (await client.post("/api/v1/auth/email/verify", json={"token": raw})).status_code == 204

    response = await client.post(LOGIN, json={"email": "  Nigina@Example.TJ ", "password": password})

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"access_token", "expires_in", "user"}
    me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    # `user` is exactly what GET /me returns for the same token.
    assert body["user"] == me.json()
    assert body["user"]["email"] == email and body["user"]["email_verified"] is True


async def test_access_token_claims_and_lifetime(client: AsyncClient, session: AsyncSession) -> None:
    user = await verified_user(session)

    response = await client.post(LOGIN, json={"email": user.email, "password": PASSWORD})

    body = response.json()
    claims = jwt.decode(body["access_token"], get_settings().jwt_access_secret, algorithms=["HS256"])
    [row] = await refresh_rows(session)
    assert set(claims) == {"sub", "sid", "tv", "typ", "iat", "exp"}
    assert claims["sub"] == str(user.id)
    assert claims["typ"] == "access"
    assert claims["tv"] == user.token_version
    assert claims["sid"] == str(row.family_id)
    assert claims["exp"] - claims["iat"] == 15 * 60 == body["expires_in"]
    assert user.email not in body["access_token"]


async def test_refresh_session_is_persisted_hashed_and_set_as_a_strict_cookie(
    client: AsyncClient, session: AsyncSession
) -> None:
    user = await verified_user(session)
    started = utcnow()

    response = await client.post(
        LOGIN, json={"email": user.email, "password": PASSWORD}, headers={"User-Agent": "TezFarmo-Test/1.0"}
    )

    jar = cookies(response)
    refresh_header, csrf_header = jar["refresh_token"], jar["csrf_token"]
    # SEC-004: httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth.
    for attribute in ("HttpOnly", "Secure", "SameSite=strict", "Path=/api/v1/auth"):
        assert attribute.lower() in refresh_header.lower()
    # SEC-005: the CSRF double-submit cookie is readable by the app.
    assert "httponly" not in csrf_header.lower()
    for attribute in ("Secure", "SameSite=strict", "Path=/"):
        assert attribute.lower() in csrf_header.lower()
    assert response.headers["Cache-Control"] == "no-store"

    refresh = cookie_value(refresh_header)
    claims = jwt.decode(refresh, get_settings().jwt_refresh_secret, algorithms=["HS256"])
    [row] = await refresh_rows(session)
    assert claims["typ"] == "refresh" and claims["sub"] == str(user.id)
    assert claims["jti"] == str(row.id) and claims["sid"] == str(row.family_id)
    assert row.user_id == user.id
    assert row.token_hash == hashlib.sha256(refresh.encode()).hexdigest()
    assert refresh not in {row.token_hash, str(row.id), str(row.family_id)}
    assert row.revoked_at is None and row.replaced_by_id is None
    assert timedelta(days=30) - timedelta(minutes=1) <= row.expires_at - started <= timedelta(days=30, minutes=1)
    assert row.user_agent == "TezFarmo-Test/1.0"
    # The refresh token never appears in the JSON body.
    assert refresh not in response.text


async def test_login_updates_last_login_and_audits_without_secrets(client: AsyncClient, session: AsyncSession) -> None:
    user = await verified_user(session)

    response = await client.post(LOGIN, json={"email": user.email, "password": PASSWORD})

    session.expire_all()
    assert (await session.get(User, user.id)).last_login_at is not None  # type: ignore[union-attr]
    [entry] = (await session.scalars(select(AuditLog).where(AuditLog.action == "auth.login"))).all()
    assert entry.entity_id == user.id and entry.actor_id == user.id
    stored = str(entry.old_data) + str(entry.new_data)
    for secret in (PASSWORD, response.json()["access_token"], cookie_value(cookies(response)["refresh_token"])):
        assert secret not in stored


async def test_iam_004_unknown_email_and_wrong_password_are_indistinguishable(
    client: AsyncClient, session: AsyncSession
) -> None:
    user = await verified_user(session)

    wrong_password = await client.post(LOGIN, json={"email": user.email, "password": "Wrong2026pass"})
    unknown_email = await client.post(LOGIN, json={"email": "nobody@example.tj", "password": PASSWORD})

    for response in (wrong_password, unknown_email):
        assert response.status_code == 401
        error = response.json()["error"]
        assert error["code"] == "invalid_credentials" and error["details"] == {}
        assert cookies(response) == {} and "access_token" not in response.text
    assert wrong_password.json()["error"]["message"] == unknown_email.json()["error"]["message"]
    assert await refresh_rows(session) == []
    session.expire_all()
    assert (await session.get(User, user.id)).last_login_at is None  # type: ignore[union-attr]


async def test_unverified_account_with_wrong_password_is_invalid_credentials_not_a_verification_oracle(
    client: AsyncClient, session: AsyncSession
) -> None:
    user = await verified_user(session, email_verified_at=None)

    wrong = await client.post(LOGIN, json={"email": user.email, "password": "Wrong2026pass"})
    right = await client.post(LOGIN, json={"email": user.email, "password": PASSWORD})

    assert wrong.status_code == 401 and wrong.json()["error"]["code"] == "invalid_credentials"
    assert right.status_code == 403 and right.json()["error"]["code"] == "email_not_verified"
    assert cookies(right) == {} and "access_token" not in right.text
    assert await refresh_rows(session) == []


async def test_iam_009_blocked_user_cannot_sign_in(client: AsyncClient, session: AsyncSession) -> None:
    user = await verified_user(session, status="BLOCKED")

    right = await client.post(LOGIN, json={"email": user.email, "password": PASSWORD})
    wrong = await client.post(LOGIN, json={"email": user.email, "password": "Wrong2026pass"})

    assert right.status_code == 403 and right.json()["error"]["code"] == "user_blocked"
    assert wrong.status_code == 401 and wrong.json()["error"]["code"] == "invalid_credentials"
    assert await refresh_rows(session) == []


async def test_failed_login_is_audited_for_known_accounts_only(client: AsyncClient, session: AsyncSession) -> None:
    user = await verified_user(session)

    await client.post(LOGIN, json={"email": user.email, "password": "Wrong2026pass"})
    await client.post(LOGIN, json={"email": "nobody@example.tj", "password": "Wrong2026pass"})

    session.expire_all()
    [entry] = (await session.scalars(select(AuditLog).where(AuditLog.action == "auth.login_failed"))).all()
    assert entry.entity_id == user.id and entry.actor_id is None
    assert entry.new_data == {"reason": "invalid_credentials"}
    assert "Wrong2026pass" not in str(entry.new_data)


async def test_password_and_tokens_stay_out_of_responses_and_logs(
    client: AsyncClient, session: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    user = await verified_user(session)

    with caplog.at_level(logging.DEBUG):
        ok = await client.post(LOGIN, json={"email": user.email, "password": PASSWORD})
        failed = await client.post(LOGIN, json={"email": user.email, "password": "Wrong2026pass"})

    access, refresh = ok.json()["access_token"], cookie_value(cookies(ok)["refresh_token"])
    for secret in (PASSWORD, "Wrong2026pass", access, refresh, user.password_hash):
        assert secret not in caplog.text
    for response in (ok, failed):
        assert PASSWORD not in response.text and "argon2" not in response.text
        assert "password_hash" not in response.text


async def test_rate_limit_auth_login_5_failures_per_15_minutes(client: AsyncClient, session: AsyncSession) -> None:
    user = await verified_user(session)
    for _ in range(5):
        assert (await client.post(LOGIN, json={"email": user.email, "password": "Wrong2026pass"})).status_code == 401

    # Locked even with the right password, and case/whitespace do not open a new bucket.
    blocked = await client.post(LOGIN, json={"email": f"  {user.email.upper()} ", "password": PASSWORD})

    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "rate_limited"
    assert int(blocked.headers["Retry-After"]) > 0
    assert await refresh_rows(session) == []
    # Another account is not affected.
    other = await verified_user(session, email="other@pamir.tj")
    assert (await client.post(LOGIN, json={"email": other.email, "password": PASSWORD})).status_code == 200


async def test_rate_limit_treats_unknown_addresses_the_same(client: AsyncClient) -> None:
    for _ in range(5):
        response = await client.post(LOGIN, json={"email": "nobody@example.tj", "password": "Wrong2026pass"})
        assert response.status_code == 401
    blocked = await client.post(LOGIN, json={"email": "nobody@example.tj", "password": "Wrong2026pass"})
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "rate_limited"


async def test_successful_logins_do_not_use_up_the_limit(client: AsyncClient, session: AsyncSession) -> None:
    user = await verified_user(session)
    statuses = [
        (await client.post(LOGIN, json={"email": user.email, "password": PASSWORD})).status_code for _ in range(7)
    ]
    assert statuses == [200] * 7


async def test_concurrent_logins_start_independent_sessions(client: AsyncClient, session: AsyncSession) -> None:
    user = await verified_user(session)

    responses = await asyncio.gather(
        *(client.post(LOGIN, json={"email": user.email, "password": PASSWORD}) for _ in range(3))
    )

    assert [response.status_code for response in responses] == [200, 200, 200]
    rows = await refresh_rows(session)
    assert len(rows) == 3
    assert len({row.family_id for row in rows}) == 3
    assert len({row.token_hash for row in rows}) == 3
    sids = {jwt.decode(r.json()["access_token"], options={"verify_signature": False})["sid"] for r in responses}
    assert sids == {str(row.family_id) for row in rows}
    assert await session.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "auth.login")) == 3


@pytest.mark.parametrize(
    ("payload", "field", "code"),
    [
        ({"password": PASSWORD}, "email", "missing"),
        ({"email": "dilshod@pamir.tj"}, "password", "missing"),
        ({"email": "", "password": PASSWORD}, "email", "value_error"),
        ({"email": "   ", "password": PASSWORD}, "email", "value_error"),
        ({"email": "not-an-email", "password": PASSWORD}, "email", "value_error"),
        ({"email": "dilshod@pamir.tj", "password": ""}, "password", "string_too_short"),
        ({"email": "dilshod@pamir.tj", "password": PASSWORD, "remember": True}, "remember", "extra_forbidden"),
        ({"email": "dilshod@pamir.tj", "password": PASSWORD, "phone": "+992900000000"}, "phone", "extra_forbidden"),
    ],
)
async def test_malformed_requests_are_validation_errors(
    client: AsyncClient, session: AsyncSession, payload: dict[str, object], field: str, code: str
) -> None:
    await verified_user(session)

    response = await client.post(LOGIN, json=payload)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert {"field": field, "code": code} in [
        {"field": f["field"], "code": f["code"]} for f in error["details"]["fields"]
    ]
    assert cookies(response) == {} and await refresh_rows(session) == []
