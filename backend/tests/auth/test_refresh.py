"""P01 `POST /auth/refresh`: IAM-006 rotation, IAM-007 reuse detection (family revoke, refresh_token_reused),
SEC-004 cookie, SEC-005 double-submit CSRF (403), IAM-005 access claims (CR-001)."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID, uuid4

import jwt
import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.config import get_settings
from app.core.email import MemoryEmailProvider, OutgoingEmail, set_email_provider
from app.core.security import create_refresh_token
from app.core.time import utcnow
from app.modules.auth.models import RefreshToken
from app.modules.identity.models import User
from tests.factories import make_user

LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
ME = "/api/v1/me"
PASSWORD = "Tezfarmo2026"  # tests.factories.make_user
TOKEN_IN_LINK = re.compile(r"/verify-email\?token=([A-Za-z0-9_-]+)")


@dataclass(frozen=True)
class Session:
    access: str
    refresh: str
    csrf: str


@pytest.fixture
def outbox() -> Iterator[list[OutgoingEmail]]:
    provider = MemoryEmailProvider()
    set_email_provider(provider)
    yield provider.outbox
    set_email_provider(None)


def set_cookies(response: Response) -> dict[str, str]:
    return {h.split("=", 1)[0]: h for h in response.headers.get_list("set-cookie")}


def cookie_value(header: str) -> str:
    return header.split(";", 1)[0].split("=", 1)[1]


def session_from(response: Response, csrf: str | None = None) -> Session:
    jar = set_cookies(response)
    return Session(
        access=response.json()["access_token"],
        refresh=cookie_value(jar["refresh_token"]),
        csrf=cookie_value(jar["csrf_token"]) if "csrf_token" in jar else csrf or "",
    )


async def make_account(session: AsyncSession, email: str = "dilshod@pamir.tj", **extra: object) -> tuple[UUID, str]:
    user = await make_user(session, email=email, **extra)
    await session.commit()
    return user.id, user.email


async def login(client: AsyncClient, email: str = "dilshod@pamir.tj", password: str = PASSWORD) -> Session:
    response = await client.post(LOGIN, json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    client.cookies.clear()  # every refresh below sends its cookies explicitly
    return session_from(response)


async def refresh(
    client: AsyncClient, refresh_token: str | None, csrf_cookie: str | None, csrf_header: str | None
) -> Response:
    parts = []
    if refresh_token is not None:
        parts.append(f"refresh_token={refresh_token}")
    if csrf_cookie is not None:
        parts.append(f"csrf_token={csrf_cookie}")
    headers = {"Cookie": "; ".join(parts)} if parts else {}
    if csrf_header is not None:
        headers["X-CSRF-Token"] = csrf_header
    response = await client.post(REFRESH, headers=headers)
    client.cookies.clear()
    return response


async def rotate(client: AsyncClient, current: Session) -> Response:
    return await refresh(client, current.refresh, current.csrf, current.csrf)


async def rows(session: AsyncSession) -> list[RefreshToken]:
    session.expire_all()
    return list((await session.scalars(select(RefreshToken).order_by(RefreshToken.created_at))).all())


def code(response: Response) -> str:
    return response.json()["error"]["code"]


async def test_register_verify_login_refresh_chain(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    email, password = "nigina@example.tj", "Dushanbe2026x"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Nigina Karimova", "language": "tg"},
    )
    raw = TOKEN_IN_LINK.search(outbox[-1].text).group(1)  # type: ignore[union-attr]
    assert (await client.post("/api/v1/auth/email/verify", json={"token": raw})).status_code == 204
    first = await login(client, email, password)
    assert (await client.get(ME, headers={"Authorization": f"Bearer {first.access}"})).status_code == 200

    response = await rotate(client, first)

    assert response.status_code == 200
    second = session_from(response, first.csrf)
    me = await client.get(ME, headers={"Authorization": f"Bearer {second.access}"})
    assert me.status_code == 200 and me.json()["email"] == email
    # The old refresh token is spent: presenting it again is reuse (IAM-007).
    stale = await rotate(client, first)
    assert stale.status_code == 401 and code(stale) == "refresh_token_reused"


async def test_rotation_replaces_the_token_inside_the_family(client: AsyncClient, session: AsyncSession) -> None:
    user_id, email = await make_account(session)
    first = await login(client, email)
    started = utcnow()

    response = await rotate(client, first)

    assert response.status_code == 200
    assert set(response.json()) == {"access_token", "expires_in"}
    second = session_from(response, first.csrf)
    old, new = await rows(session)
    assert old.revoked_at is not None and old.replaced_by_id == new.id
    assert new.revoked_at is None and new.replaced_by_id is None
    assert new.family_id == old.family_id and new.user_id == old.user_id == user_id
    assert new.token_hash == hashlib.sha256(second.refresh.encode()).hexdigest()
    assert second.refresh not in {new.token_hash, str(new.id)} and second.refresh != first.refresh
    assert timedelta(days=30) - timedelta(minutes=1) <= new.expires_at - started <= timedelta(days=30, minutes=1)

    refresh_claims = jwt.decode(second.refresh, get_settings().jwt_refresh_secret, algorithms=["HS256"])
    assert refresh_claims["typ"] == "refresh" and refresh_claims["jti"] == str(new.id)
    assert refresh_claims["sid"] == str(new.family_id) and refresh_claims["sub"] == str(user_id)
    access_claims = jwt.decode(second.access, get_settings().jwt_access_secret, algorithms=["HS256"])
    assert set(access_claims) == {"sub", "sid", "tv", "typ", "iat", "exp"}
    assert access_claims["typ"] == "access" and access_claims["sid"] == str(new.family_id)
    assert access_claims["exp"] - access_claims["iat"] == 15 * 60 == response.json()["expires_in"]


async def test_cookies_and_cache_headers_on_refresh(client: AsyncClient, session: AsyncSession) -> None:
    _, email = await make_account(session)
    first = await login(client, email)

    response = await rotate(client, first)

    jar = set_cookies(response)
    for attribute in ("HttpOnly", "Secure", "SameSite=strict", "Path=/api/v1/auth"):
        assert attribute.lower() in jar["refresh_token"].lower()
    # The CSRF value stays the same and is re-set for the new session lifetime; it stays readable by the app.
    assert cookie_value(jar["csrf_token"]) == first.csrf
    assert "httponly" not in jar["csrf_token"].lower() and "path=/;" in jar["csrf_token"].lower() + ";"
    assert response.headers["Cache-Control"] == "no-store"
    new_refresh = cookie_value(jar["refresh_token"])
    assert new_refresh not in response.text and first.csrf not in response.text


async def test_a_session_can_rotate_repeatedly(client: AsyncClient, session: AsyncSession) -> None:
    _, email = await make_account(session)
    current = await login(client, email)
    for _ in range(3):
        response = await rotate(client, current)
        assert response.status_code == 200
        current = session_from(response, current.csrf)

    chain = await rows(session)
    assert len(chain) == 4 and len({row.family_id for row in chain}) == 1
    assert [row.revoked_at is None for row in chain] == [False, False, False, True]
    assert [row.replaced_by_id for row in chain[:-1]] == [row.id for row in chain[1:]]


async def test_iam_007_reuse_revokes_only_the_affected_family(client: AsyncClient, session: AsyncSession) -> None:
    user_id, email = await make_account(session)
    a1 = await login(client, email)
    b1 = await login(client, email)  # a second device: its own family
    a2 = session_from(await rotate(client, a1), a1.csrf)

    reused = await rotate(client, a1)

    assert reused.status_code == 401 and code(reused) == "refresh_token_reused"
    assert set_cookies(reused) == {} and "access_token" not in reused.text
    family_a = (await rows(session))[0].family_id
    for row in await rows(session):
        if row.family_id == family_a:
            assert row.revoked_at is not None
        else:
            assert row.revoked_at is None
    # The legitimate-looking successor is dead too; the other device keeps working.
    after = await rotate(client, a2)
    assert after.status_code == 401 and code(after) == "refresh_token_reused"
    assert (await rotate(client, b1)).status_code == 200

    audit = (await session.scalars(select(AuditLog).where(AuditLog.action == "auth.refresh_reuse"))).all()
    assert len(audit) == 2 and {entry.entity_id for entry in audit} == {user_id}
    assert audit[0].new_data["family_id"] == str(family_a)  # type: ignore[index]
    for entry in audit:
        stored = str(entry.old_data) + str(entry.new_data)
        for secret in (a1.refresh, a2.refresh, a1.access, a1.csrf):
            assert secret not in stored


async def test_concurrent_refreshes_with_one_token_rotate_at_most_once(
    client: AsyncClient, session: AsyncSession
) -> None:
    _, email = await make_account(session)
    current = await login(client, email)

    responses = await asyncio.gather(*(rotate(client, current) for _ in range(3)))

    # Exactly one request rotates; the others find the token already revoked.
    assert sorted(response.status_code for response in responses) == [200, 401, 401]
    assert all(code(r) == "refresh_token_reused" for r in responses if r.status_code != 200)
    # Only one replacement was ever created, and racing copies count as reuse, so the family is revoked (IAM-007).
    chain = await rows(session)
    assert len(chain) == 2
    assert all(row.revoked_at is not None for row in chain)


async def test_expired_refresh_token_is_rejected_without_issuing_anything(
    client: AsyncClient, session: AsyncSession
) -> None:
    user_id, email = await make_account(session)
    current = await login(client, email)
    [row] = await rows(session)
    expired_jwt = create_refresh_token(user_id, row.family_id, row.id, utcnow() - timedelta(seconds=1))

    by_jwt = await refresh(client, expired_jwt, current.csrf, current.csrf)
    assert by_jwt.status_code == 401 and code(by_jwt) == "token_expired"

    # The row lapsed server-side while the JWT still looks valid.
    await session.execute(
        update(RefreshToken).where(RefreshToken.id == row.id).values(expires_at=utcnow() - timedelta(seconds=1))
    )
    await session.commit()
    by_row = await rotate(client, current)
    assert by_row.status_code == 401 and code(by_row) == "token_expired"
    [unchanged] = await rows(session)
    assert unchanged.revoked_at is None  # an expired token is not reuse
    assert set_cookies(by_row) == {}


async def test_invalid_tokens_are_token_invalid_and_change_nothing(client: AsyncClient, session: AsyncSession) -> None:
    user_id, email = await make_account(session)
    current = await login(client, email)
    [row] = await rows(session)
    settings = get_settings()
    now = int(utcnow().timestamp())
    valid_claims = {"sub": str(user_id), "sid": str(row.family_id), "jti": str(row.id), "typ": "refresh"}
    claims = {**valid_claims, "iat": now, "exp": now + 3600}
    candidates = {
        "malformed": "not-a-jwt",
        "access token": current.access,
        "access secret": jwt.encode(claims, settings.jwt_access_secret, algorithm="HS256"),
        "wrong type": jwt.encode({**claims, "typ": "access"}, settings.jwt_refresh_secret, algorithm="HS256"),
        "no jti": jwt.encode(
            {k: v for k, v in claims.items() if k != "jti"}, settings.jwt_refresh_secret, algorithm="HS256"
        ),
        "unknown jti": jwt.encode({**claims, "jti": str(uuid4())}, settings.jwt_refresh_secret, algorithm="HS256"),
        # Correctly signed for the real row, but not the token that was issued (stored hash differs).
        "hash mismatch": jwt.encode({**claims, "iat": now - 5}, settings.jwt_refresh_secret, algorithm="HS256"),
        "other family": jwt.encode({**claims, "sid": str(uuid4())}, settings.jwt_refresh_secret, algorithm="HS256"),
        "unsigned": jwt.encode(claims, None, algorithm="none"),
    }

    for name, token in candidates.items():
        response = await refresh(client, token, current.csrf, current.csrf)
        assert response.status_code == 401, name
        assert code(response) == "token_invalid", name
        assert response.json()["error"]["details"] == {}, name
        assert set_cookies(response) == {}, name

    [unchanged] = await rows(session)
    assert unchanged.revoked_at is None
    assert (await rotate(client, current)).status_code == 200


async def test_missing_refresh_cookie_is_not_authenticated(client: AsyncClient, session: AsyncSession) -> None:
    _, email = await make_account(session)
    current = await login(client, email)

    response = await refresh(client, None, current.csrf, current.csrf)

    assert response.status_code == 401 and code(response) == "not_authenticated"


@pytest.mark.parametrize(
    ("csrf_cookie", "csrf_header"),
    [("same", None), (None, "same"), ("same", "other"), (None, None), ("same", "")],
)
async def test_sec_005_csrf_failures_are_403_and_change_nothing(
    client: AsyncClient, session: AsyncSession, csrf_cookie: str | None, csrf_header: str | None
) -> None:
    _, email = await make_account(session)
    current = await login(client, email)

    cookie = current.csrf if csrf_cookie == "same" else csrf_cookie
    header = {"same": current.csrf, "other": "forged-value"}.get(csrf_header, csrf_header)  # type: ignore[arg-type]
    response = await refresh(client, current.refresh, cookie, header)

    assert response.status_code == 403 and code(response) == "permission_denied"
    assert set_cookies(response) == {}
    [unchanged] = await rows(session)
    assert unchanged.revoked_at is None
    assert (await rotate(client, current)).status_code == 200


async def test_blocked_user_cannot_refresh(client: AsyncClient, session: AsyncSession) -> None:
    user_id, email = await make_account(session)
    current = await login(client, email)
    await session.execute(update(User).where(User.id == user_id).values(status="BLOCKED"))
    await session.commit()

    response = await rotate(client, current)

    assert response.status_code == 403 and code(response) == "user_blocked"
    assert set_cookies(response) == {} and "access_token" not in response.text
    [unchanged] = await rows(session)
    assert unchanged.revoked_at is None and unchanged.replaced_by_id is None


async def test_new_access_token_carries_the_current_token_version(client: AsyncClient, session: AsyncSession) -> None:
    user_id, email = await make_account(session)
    current = await login(client, email)
    await session.execute(update(User).where(User.id == user_id).values(token_version=User.token_version + 1))
    await session.commit()

    response = await rotate(client, current)

    assert response.status_code == 200
    # The old access token is rejected after the bump (IAM-005); the refreshed one works.
    assert (await client.get(ME, headers={"Authorization": f"Bearer {current.access}"})).status_code == 401
    new_access = response.json()["access_token"]
    assert (await client.get(ME, headers={"Authorization": f"Bearer {new_access}"})).status_code == 200


async def test_tokens_stay_out_of_logs(
    client: AsyncClient, session: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    _, email = await make_account(session)
    first = await login(client, email)

    with caplog.at_level(logging.DEBUG):
        ok = await rotate(client, first)
        reused = await rotate(client, first)

    second = session_from(ok, first.csrf)
    assert reused.status_code == 401
    for secret in (first.refresh, second.refresh, second.access, first.csrf):
        assert secret not in caplog.text
        assert secret not in reused.text
