"""P01 `POST /auth/password/change` (access): IAM-008 (password change: token_version++ and every refresh revoked),
IAM-003 policy, IAM-005 access check, `invalid_credentials` for a wrong current password, `auth.password_changed`
audit, SEC-002/SEC-011 secrecy (CR-001)."""

from __future__ import annotations

import asyncio
import logging

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.modules.auth.models import RefreshToken
from app.modules.identity.models import User
from tests.auth.test_refresh import LOGIN, ME, PASSWORD, Session, login, make_account, rotate, session_from

CHANGE = "/api/v1/auth/password/change"
EMAIL = "dilshod@pamir.tj"
NEW_PASSWORD = "Khujand2027new"


async def change(client: AsyncClient, access: str | None, current: str = PASSWORD, new: str = NEW_PASSWORD) -> Response:
    headers = {"Authorization": f"Bearer {access}"} if access else {}
    return await client.post(CHANGE, json={"current_password": current, "new_password": new}, headers=headers)


async def sign_in(client: AsyncClient, password: str, email: str = EMAIL) -> Response:
    response = await client.post(LOGIN, json={"email": email, "password": password})
    client.cookies.clear()
    return response


async def me(client: AsyncClient, device: Session) -> Response:
    return await client.get(ME, headers={"Authorization": f"Bearer {device.access}"})


async def the_user(session: AsyncSession, email: str = EMAIL) -> User:
    session.expire_all()
    user = await session.scalar(select(User).where(User.email == email))
    assert user is not None
    return user


async def refresh_rows(session: AsyncSession, user_id: object) -> list[RefreshToken]:
    session.expire_all()
    return list((await session.scalars(select(RefreshToken).where(RefreshToken.user_id == user_id))).all())


async def audits(session: AsyncSession, action: str) -> list[AuditLog]:
    session.expire_all()
    return list((await session.scalars(select(AuditLog).where(AuditLog.action == action))).all())


def code(response: Response) -> str:
    return response.json()["error"]["code"]


# --- success -------------------------------------------------------------------------------------------------------


async def test_change_sets_the_new_password_and_answers_204(client: AsyncClient, session: AsyncSession) -> None:
    await make_account(session, EMAIL)
    before = await the_user(session)
    snapshot = (before.email, before.email_verified_at, before.status, before.full_name, before.language)
    old_hash, old_version = before.password_hash, before.token_version
    device = await login(client)

    response = await change(client, device.access)

    assert response.status_code == 204 and response.content == b""
    assert "set-cookie" not in response.headers
    user = await the_user(session)
    assert user.password_hash != old_hash and user.password_hash.startswith("$argon2id$")
    assert user.token_version == old_version + 1
    assert (user.email, user.email_verified_at, user.status, user.full_name, user.language) == snapshot
    assert code(await sign_in(client, PASSWORD)) == "invalid_credentials"
    assert (await sign_in(client, NEW_PASSWORD)).status_code == 200


async def test_change_signs_out_every_device_including_this_one(client: AsyncClient, session: AsyncSession) -> None:
    user_id, _ = await make_account(session, EMAIL)
    this, phone = await login(client), await login(client)
    laptop = await login(client)
    laptop = session_from(await rotate(client, laptop), laptop.csrf)

    assert (await change(client, this.access)).status_code == 204

    rows = await refresh_rows(session, user_id)
    assert len(rows) == 4 and all(row.revoked_at is not None for row in rows)
    for device in (this, phone, laptop):
        stale = await me(client, device)
        assert stale.status_code == 401 and code(stale) == "token_invalid"  # IAM-005: tv no longer matches
        assert (await rotate(client, device)).status_code == 401  # no old cookie can mint a new access token
    fresh = await login(client, EMAIL, NEW_PASSWORD)
    assert (await me(client, fresh)).status_code == 200
    assert (await rotate(client, fresh)).status_code == 200


async def test_other_users_are_untouched(client: AsyncClient, session: AsyncSession) -> None:
    await make_account(session, EMAIL)
    other_id, other_email = await make_account(session, "other@pamir.tj")
    mine, theirs = await login(client), await login(client, other_email)
    other_version = (await the_user(session, other_email)).token_version

    assert (await change(client, mine.access)).status_code == 204

    assert (await the_user(session, other_email)).token_version == other_version
    assert all(row.revoked_at is None for row in await refresh_rows(session, other_id))
    assert (await me(client, theirs)).status_code == 200
    assert (await rotate(client, theirs)).status_code == 200
    assert (await sign_in(client, PASSWORD, other_email)).status_code == 200


async def test_change_is_audited_once_with_the_new_version_only(client: AsyncClient, session: AsyncSession) -> None:
    user_id, _ = await make_account(session, EMAIL)
    device = await login(client)

    await change(client, device.access)

    [entry] = await audits(session, "auth.password_changed")
    assert entry.entity_type == "user" and entry.entity_id == user_id and entry.actor_id == user_id
    assert entry.new_data == {"token_version": 2} and entry.old_data is None
    assert await audits(session, "auth.password_reset") == []


async def test_the_same_password_again_is_not_forbidden(client: AsyncClient, session: AsyncSession) -> None:
    # TZ defines no "must differ" rule; the policy is IAM-003 only.
    await make_account(session, EMAIL)
    device = await login(client)

    assert (await change(client, device.access, PASSWORD, PASSWORD)).status_code == 204
    assert (await the_user(session)).token_version == 2


# --- failures leave everything as it was ---------------------------------------------------------------------------


async def assert_unchanged(client: AsyncClient, session: AsyncSession, user_id: object, device: Session) -> None:
    user = await the_user(session)
    assert user.token_version == 1
    assert all(row.revoked_at is None for row in await refresh_rows(session, user_id))
    assert await audits(session, "auth.password_changed") == []
    assert (await me(client, device)).status_code == 200
    assert (await sign_in(client, PASSWORD)).status_code == 200


async def test_wrong_current_password_is_invalid_credentials(client: AsyncClient, session: AsyncSession) -> None:
    user_id, _ = await make_account(session, EMAIL)
    device = await login(client)

    response = await change(client, device.access, "Wrong2026pass")

    assert response.status_code == 401 and code(response) == "invalid_credentials"
    await assert_unchanged(client, session, user_id, device)


@pytest.mark.parametrize(
    ("password", "problems"),
    [
        ("short1", {"password_too_short"}),
        ("onlyletters", {"password_needs_letter_and_digit"}),
        ("58302917465", {"password_needs_letter_and_digit"}),
        ("password1", {"password_too_common"}),
        ("a1" * 70, {"password_too_long"}),
        ("", {"password_too_short", "password_needs_letter_and_digit"}),
    ],
)
async def test_weak_new_password_is_rejected(
    client: AsyncClient, session: AsyncSession, password: str, problems: set[str]
) -> None:
    user_id, _ = await make_account(session, EMAIL)
    device = await login(client)

    response = await change(client, device.access, PASSWORD, password)

    assert response.status_code == 422 and code(response) == "weak_password"
    fields = response.json()["error"]["details"]["fields"]
    assert {f["field"] for f in fields} == {"new_password"}
    assert {f["code"] for f in fields} == problems
    await assert_unchanged(client, session, user_id, device)


async def test_wrong_current_password_is_reported_before_a_weak_new_one(
    client: AsyncClient, session: AsyncSession
) -> None:
    await make_account(session, EMAIL)
    device = await login(client)

    response = await change(client, device.access, "Wrong2026pass", "short")

    assert response.status_code == 401 and code(response) == "invalid_credentials"


@pytest.mark.parametrize(
    ("payload", "field", "error"),
    [
        ({"new_password": NEW_PASSWORD}, "current_password", "missing"),
        ({"current_password": PASSWORD}, "new_password", "missing"),
        ({"current_password": "", "new_password": NEW_PASSWORD}, "current_password", "string_too_short"),
        ({"current_password": "x" * 1025, "new_password": NEW_PASSWORD}, "current_password", "string_too_long"),
        ({"current_password": PASSWORD, "new_password": "x" * 1025}, "new_password", "string_too_long"),
        ({"current_password": PASSWORD, "new_password": NEW_PASSWORD, "password": "x"}, "password", "extra_forbidden"),
        (
            {"current_password": PASSWORD, "new_password": NEW_PASSWORD, "token_version": 9},
            "token_version",
            "extra_forbidden",
        ),
    ],
)
async def test_malformed_requests_are_validation_errors(
    client: AsyncClient, session: AsyncSession, payload: dict[str, object], field: str, error: str
) -> None:
    user_id, _ = await make_account(session, EMAIL)
    device = await login(client)

    response = await client.post(CHANGE, json=payload, headers={"Authorization": f"Bearer {device.access}"})

    assert response.status_code == 422 and code(response) == "validation_error"
    fields = [{"field": f["field"], "code": f["code"]} for f in response.json()["error"]["details"]["fields"]]
    assert {"field": field, "code": error} in fields
    await assert_unchanged(client, session, user_id, device)


async def test_empty_new_password_is_weak(client: AsyncClient, session: AsyncSession) -> None:
    await make_account(session, EMAIL)
    device = await login(client)

    response = await change(client, device.access, PASSWORD, "")

    assert response.status_code == 422 and code(response) == "weak_password"


@pytest.mark.parametrize(
    ("authorization", "expected"),
    [
        (None, "not_authenticated"),
        ("Bearer not-a-jwt", "token_invalid"),
    ],
)
async def test_access_token_is_required(
    client: AsyncClient, session: AsyncSession, authorization: str | None, expected: str
) -> None:
    user_id, _ = await make_account(session, EMAIL)
    device = await login(client)
    headers = {"Authorization": authorization} if authorization else {}

    response = await client.post(
        CHANGE, json={"current_password": PASSWORD, "new_password": NEW_PASSWORD}, headers=headers
    )

    assert response.status_code == 401 and code(response) == expected
    await assert_unchanged(client, session, user_id, device)


async def test_refresh_token_is_not_an_access_token(client: AsyncClient, session: AsyncSession) -> None:
    user_id, _ = await make_account(session, EMAIL)
    device = await login(client)

    response = await change(client, device.refresh)

    assert response.status_code == 401 and code(response) == "token_invalid"
    await assert_unchanged(client, session, user_id, device)


async def test_blocked_user_cannot_change_the_password(client: AsyncClient, session: AsyncSession) -> None:
    await make_account(session, EMAIL)
    device = await login(client)
    await session.execute(update(User).where(User.email == EMAIL).values(status="BLOCKED"))
    await session.commit()

    response = await change(client, device.access)

    assert response.status_code == 403 and code(response) == "user_blocked"
    user = await the_user(session)
    assert user.token_version == 1 and await audits(session, "auth.password_changed") == []


async def test_access_token_from_before_a_change_cannot_change_again(
    client: AsyncClient, session: AsyncSession
) -> None:
    await make_account(session, EMAIL)
    device = await login(client)
    assert (await change(client, device.access)).status_code == 204

    again = await change(client, device.access, NEW_PASSWORD, "Another2028pass")

    assert again.status_code == 401 and code(again) == "token_invalid"
    assert (await the_user(session)).token_version == 2
    assert (await sign_in(client, NEW_PASSWORD)).status_code == 200


# --- concurrency ---------------------------------------------------------------------------------------------------


async def test_concurrent_changes_with_the_old_password_succeed_once(
    client: AsyncClient, session: AsyncSession
) -> None:
    await make_account(session, EMAIL)
    devices = [await login(client) for _ in range(3)]
    passwords = ["Khujand2027a", "Khujand2027b", "Khujand2027c"]

    responses = await asyncio.gather(
        *(change(client, device.access, PASSWORD, new) for device, new in zip(devices, passwords, strict=True))
    )

    statuses = [response.status_code for response in responses]
    assert statuses.count(204) == 1 and statuses.count(401) == 2
    # A loser either passed the access check first (then the locked row has a new hash) or came after the commit.
    assert {code(r) for r in responses if r.status_code == 401} <= {"invalid_credentials", "token_invalid"}
    winner = passwords[statuses.index(204)]
    assert (await the_user(session)).token_version == 2
    assert len(await audits(session, "auth.password_changed")) == 1
    for password in [PASSWORD, *passwords]:
        assert (await sign_in(client, password)).status_code == (200 if password == winner else 401)


# --- secrecy -------------------------------------------------------------------------------------------------------


async def test_secrets_stay_out_of_responses_logs_and_audit(
    client: AsyncClient, session: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    await make_account(session, EMAIL)
    old_hash = (await the_user(session)).password_hash
    device = await login(client)

    with caplog.at_level(logging.DEBUG):
        wrong = await change(client, device.access, "Wrong2026pass", "Weak")
        weak = await change(client, device.access, PASSWORD, "short1")
        done = await change(client, device.access)

    assert done.status_code == 204
    new_hash = (await the_user(session)).password_hash
    secrets = [PASSWORD, NEW_PASSWORD, "Wrong2026pass", "short1", old_hash, new_hash, device.access, device.refresh]
    body = wrong.text + weak.text + done.text
    for secret in secrets:
        assert secret not in caplog.text
        assert secret not in body
    for entry in (await session.scalars(select(AuditLog))).all():
        for secret in [*secrets, device.csrf]:
            assert secret not in str(entry.old_data) + str(entry.new_data)
