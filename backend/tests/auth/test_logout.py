"""P01 `POST /auth/logout`: IAM-008 (this device's family only), SEC-005 CSRF, cookie clearing, `auth.logout`
audit, idempotent repeat/concurrent logout without reuse alarms (CR-001)."""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Iterator
from datetime import timedelta
from uuid import uuid4

import jwt
import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.config import get_settings
from app.core.email import MemoryEmailProvider, OutgoingEmail, set_email_provider
from app.core.security import create_refresh_token
from app.core.time import utcnow
from app.modules.identity.models import User
from tests.auth.test_refresh import (
    ME,
    Session,
    cookie_value,
    login,
    make_account,
    rotate,
    rows,
    session_from,
    set_cookies,
)

LOGOUT = "/api/v1/auth/logout"
TOKEN_IN_LINK = re.compile(r"/verify-email\?token=([A-Za-z0-9_-]+)")


@pytest.fixture
def outbox() -> Iterator[list[OutgoingEmail]]:
    provider = MemoryEmailProvider()
    set_email_provider(provider)
    yield provider.outbox
    set_email_provider(None)


async def logout(
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
    response = await client.post(LOGOUT, headers=headers)
    client.cookies.clear()
    return response


async def log_out(client: AsyncClient, current: Session) -> Response:
    return await logout(client, current.refresh, current.csrf, current.csrf)


async def audit_count(session: AsyncSession, action: str) -> int:
    session.expire_all()
    return await session.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == action)) or 0


def code(response: Response) -> str:
    return response.json()["error"]["code"]


async def test_full_session_lifecycle(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    email, password = "nigina@example.tj", "Dushanbe2026x"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Nigina Karimova", "language": "en"},
    )
    raw = TOKEN_IN_LINK.search(outbox[-1].text).group(1)  # type: ignore[union-attr]
    assert (await client.post("/api/v1/auth/email/verify", json={"token": raw})).status_code == 204
    first = await login(client, email, password)
    assert (await client.get(ME, headers={"Authorization": f"Bearer {first.access}"})).status_code == 200
    second = session_from(await rotate(client, first), first.csrf)
    assert (await client.get(ME, headers={"Authorization": f"Bearer {second.access}"})).status_code == 200

    response = await log_out(client, second)

    assert response.status_code == 204 and response.content == b""
    after = await rotate(client, second)
    assert after.status_code == 401
    assert set_cookies(after) == {} and "access_token" not in after.text


async def test_logout_revokes_this_family_and_clears_both_cookies(client: AsyncClient, session: AsyncSession) -> None:
    user_id, email = await make_account(session)
    first = await login(client, email)
    current = session_from(await rotate(client, first), first.csrf)
    rows_before = len(await rows(session))

    response = await log_out(client, current)

    assert response.status_code == 204
    assert response.headers["Cache-Control"] == "no-store"
    chain = await rows(session)
    assert len(chain) == rows_before == 2  # nothing new is issued
    assert all(row.revoked_at is not None for row in chain)
    family_id = str(chain[0].family_id)
    jar = set_cookies(response)
    refresh_deletion, csrf_deletion = jar["refresh_token"].lower(), jar["csrf_token"].lower()
    # Deleting a cookie needs the same name, path and security attributes it was set with.
    for attribute in ("max-age=0", "path=/api/v1/auth", "httponly", "secure", "samesite=strict"):
        assert attribute in refresh_deletion
    for attribute in ("max-age=0", "path=/;", "secure", "samesite=strict"):
        assert attribute in csrf_deletion + ";"
    assert "httponly" not in csrf_deletion
    assert cookie_value(jar["refresh_token"]).strip('"') == ""

    assert await audit_count(session, "auth.logout") == 1
    assert await audit_count(session, "auth.refresh_reuse") == 0
    [entry] = (await session.scalars(select(AuditLog).where(AuditLog.action == "auth.logout"))).all()
    assert entry.entity_id == user_id and entry.actor_id == user_id
    assert entry.new_data == {"family_id": family_id}


async def test_logout_ends_only_this_device(client: AsyncClient, session: AsyncSession) -> None:
    _, email = await make_account(session)
    device_a = await login(client, email)
    device_b = await login(client, email)

    assert (await log_out(client, device_a)).status_code == 204

    family_a = jwt.decode(device_a.refresh, options={"verify_signature": False})["sid"]
    family_b = jwt.decode(device_b.refresh, options={"verify_signature": False})["sid"]
    assert family_a != family_b
    for row in await rows(session):
        assert (row.revoked_at is not None) == (str(row.family_id) == family_a)
    assert (await rotate(client, device_b)).status_code == 200


async def test_access_token_is_not_revoked_by_logout(client: AsyncClient, session: AsyncSession) -> None:
    """IAM-008: logout revokes the refresh family; only logout-all / password change bump token_version.
    An access token already issued keeps working until it expires (15 minutes, SEC-003)."""
    user_id, email = await make_account(session)
    current = await login(client, email)
    version = await session.scalar(select(User.token_version).where(User.id == user_id))

    assert (await log_out(client, current)).status_code == 204

    assert (await client.get(ME, headers={"Authorization": f"Bearer {current.access}"})).status_code == 200
    session.expire_all()
    assert await session.scalar(select(User.token_version).where(User.id == user_id)) == version


async def test_repeated_logout_is_idempotent_and_not_reuse(client: AsyncClient, session: AsyncSession) -> None:
    _, email = await make_account(session)
    current = await login(client, email)

    first = await log_out(client, current)
    second = await log_out(client, current)

    assert first.status_code == second.status_code == 204
    assert "refresh_token" in set_cookies(second)  # the cookies are cleared again
    assert all(row.revoked_at is not None for row in await rows(session))
    assert len(await rows(session)) == 1
    assert await audit_count(session, "auth.logout") == 1
    assert await audit_count(session, "auth.refresh_reuse") == 0


async def test_logout_with_an_older_token_of_the_session_still_ends_it(
    client: AsyncClient, session: AsyncSession
) -> None:
    _, email = await make_account(session)
    first = await login(client, email)
    current = session_from(await rotate(client, first), first.csrf)

    response = await log_out(client, first)  # genuine, but already rotated away

    assert response.status_code == 204
    assert all(row.revoked_at is not None for row in await rows(session))
    assert await audit_count(session, "auth.refresh_reuse") == 0
    assert (await rotate(client, current)).status_code == 401


async def test_logout_with_an_expired_but_genuine_token_ends_the_session(
    client: AsyncClient, session: AsyncSession
) -> None:
    user_id, email = await make_account(session)
    current = await login(client, email)
    [row] = await rows(session)
    expired = create_refresh_token(user_id, row.family_id, row.id, utcnow() - timedelta(seconds=1))
    await session.execute(
        update(type(row)).where(type(row).id == row.id).values(expires_at=utcnow() - timedelta(seconds=1))
    )
    await session.commit()

    # The stored hash belongs to the issued token, so an expired copy with other claims is not accepted...
    assert (await logout(client, expired, current.csrf, current.csrf)).status_code == 401
    # ...but the issued token itself, now lapsed, still ends its session.
    response = await log_out(client, current)
    assert response.status_code == 204
    assert all(r.revoked_at is not None for r in await rows(session))


async def test_invalid_tokens_are_rejected_without_revoking_anything(
    client: AsyncClient, session: AsyncSession
) -> None:
    user_id, email = await make_account(session)
    current = await login(client, email)
    [row] = await rows(session)
    settings = get_settings()
    now = int(utcnow().timestamp())
    claims = {
        "sub": str(user_id),
        "sid": str(row.family_id),
        "jti": str(row.id),
        "typ": "refresh",
        "iat": now,
        "exp": now + 3600,
    }
    candidates = {
        "malformed": "not-a-jwt",
        "access token": current.access,
        "access secret": jwt.encode(claims, settings.jwt_access_secret, algorithm="HS256"),
        "wrong type": jwt.encode({**claims, "typ": "access"}, settings.jwt_refresh_secret, algorithm="HS256"),
        "unknown jti": jwt.encode({**claims, "jti": str(uuid4())}, settings.jwt_refresh_secret, algorithm="HS256"),
        "hash mismatch": jwt.encode({**claims, "iat": now - 5}, settings.jwt_refresh_secret, algorithm="HS256"),
        "other family": jwt.encode({**claims, "sid": str(uuid4())}, settings.jwt_refresh_secret, algorithm="HS256"),
        "unsigned": jwt.encode(claims, None, algorithm="none"),
    }

    for name, token in candidates.items():
        response = await logout(client, token, current.csrf, current.csrf)
        assert response.status_code == 401, name
        assert code(response) == "token_invalid", name
        assert response.json()["error"]["details"] == {}, name
        assert set_cookies(response) == {}, name
    missing = await logout(client, None, current.csrf, current.csrf)
    assert missing.status_code == 401 and code(missing) == "not_authenticated"

    [unchanged] = await rows(session)
    assert unchanged.revoked_at is None
    assert await audit_count(session, "auth.logout") == 0
    assert (await rotate(client, current)).status_code == 200


@pytest.mark.parametrize(
    ("csrf_cookie", "csrf_header"),
    [("same", None), (None, "same"), ("", "same"), ("same", ""), ("same", "other"), (None, None)],
)
async def test_sec_005_csrf_failures_are_403_and_change_nothing(
    client: AsyncClient, session: AsyncSession, csrf_cookie: str | None, csrf_header: str | None
) -> None:
    _, email = await make_account(session)
    current = await login(client, email)
    cookie = current.csrf if csrf_cookie == "same" else csrf_cookie
    header = {"same": current.csrf, "other": "forged-value"}.get(csrf_header, csrf_header)  # type: ignore[arg-type]

    response = await logout(client, current.refresh, cookie, header)

    assert response.status_code == 403 and code(response) == "permission_denied"
    assert set_cookies(response) == {}
    [unchanged] = await rows(session)
    assert unchanged.revoked_at is None
    assert await audit_count(session, "auth.logout") == 0
    assert (await log_out(client, current)).status_code == 204


async def test_blocked_user_can_still_log_out(client: AsyncClient, session: AsyncSession) -> None:
    user_id, email = await make_account(session)
    current = await login(client, email)
    await session.execute(update(User).where(User.id == user_id).values(status="BLOCKED"))
    await session.commit()

    response = await log_out(client, current)

    assert response.status_code == 204
    assert all(row.revoked_at is not None for row in await rows(session))


async def test_concurrent_logouts_converge_to_one_logged_out_state(client: AsyncClient, session: AsyncSession) -> None:
    _, email = await make_account(session)
    current = await login(client, email)

    responses = await asyncio.gather(*(log_out(client, current) for _ in range(3)))

    assert [response.status_code for response in responses] == [204, 204, 204]
    assert all(row.revoked_at is not None for row in await rows(session))
    assert await audit_count(session, "auth.logout") == 1
    assert await audit_count(session, "auth.refresh_reuse") == 0


async def test_secrets_stay_out_of_responses_logs_and_audit(
    client: AsyncClient, session: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    _, email = await make_account(session)
    current = await login(client, email)

    with caplog.at_level(logging.DEBUG):
        ok = await log_out(client, current)
        denied = await logout(client, current.refresh, current.csrf, "forged-value")

    for secret in (current.refresh, current.access, current.csrf, "Tezfarmo2026"):
        assert secret not in caplog.text
        assert secret not in ok.text and secret not in denied.text
    for entry in (await session.scalars(select(AuditLog))).all():
        stored = str(entry.old_data) + str(entry.new_data)
        assert current.refresh not in stored and current.access not in stored and current.csrf not in stored
