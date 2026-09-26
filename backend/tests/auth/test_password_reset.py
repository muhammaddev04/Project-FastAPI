"""P01 password reset: IAM-015 (start always 202, RESET_PASSWORD 30 min single use, token_version++), IAM-008
(password change revokes every refresh family), IAM-003 policy, `password_reset` rate limit, IAM-016 delivery,
`auth.password_reset` audit (CR-001)."""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Iterator
from datetime import timedelta

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.email import EmailDeliveryError, MemoryEmailProvider, OutgoingEmail, set_email_provider
from app.core.time import utcnow
from app.modules.auth.models import EmailToken, RefreshToken
from app.modules.auth.tokens import hash_token, issue_email_token
from app.modules.identity.models import User
from tests.auth.test_refresh import LOGIN, ME, PASSWORD, login, make_account, rotate, session_from

START = "/api/v1/auth/password/reset/start"
COMPLETE = "/api/v1/auth/password/reset/complete"
EMAIL = "dilshod@pamir.tj"
NEW_PASSWORD = "Khujand2027new"
RESET_LINK = re.compile(r"/reset-password\?token=([A-Za-z0-9_-]+)")
VERIFY_LINK = re.compile(r"/verify-email\?token=([A-Za-z0-9_-]+)")


@pytest.fixture
def outbox() -> Iterator[list[OutgoingEmail]]:
    provider = MemoryEmailProvider()
    set_email_provider(provider)
    yield provider.outbox
    set_email_provider(None)


class _FailingEmail:
    async def send(self, email: OutgoingEmail) -> None:
        raise EmailDeliveryError(email.template)


def link_token(email: OutgoingEmail) -> str:
    match = RESET_LINK.search(email.text)
    assert match
    return match.group(1)


async def request_link(client: AsyncClient, outbox: list[OutgoingEmail], email: str = EMAIL) -> str:
    response = await client.post(START, json={"email": email})
    assert response.status_code == 202
    return link_token(outbox[-1])


async def complete(client: AsyncClient, token: str, new_password: str = NEW_PASSWORD) -> Response:
    return await client.post(COMPLETE, json={"token": token, "new_password": new_password})


async def reset_tokens(session: AsyncSession) -> list[EmailToken]:
    session.expire_all()
    query = select(EmailToken).where(EmailToken.purpose == "RESET_PASSWORD").order_by(EmailToken.created_at)
    return list((await session.scalars(query)).all())


async def the_user(session: AsyncSession, email: str = EMAIL) -> User:
    session.expire_all()
    user = await session.scalar(select(User).where(User.email == email))
    assert user is not None
    return user


async def audits(session: AsyncSession, action: str) -> list[AuditLog]:
    session.expire_all()
    return list((await session.scalars(select(AuditLog).where(AuditLog.action == action))).all())


async def sign_in(client: AsyncClient, password: str, email: str = EMAIL) -> Response:
    response = await client.post(LOGIN, json={"email": email, "password": password})
    client.cookies.clear()
    return response


def code(response: Response) -> str:
    return response.json()["error"]["code"]


# --- lifecycle ---------------------------------------------------------------------------------------------------


async def test_iam_015_password_reset_flow(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    email, old_password = "nigina@example.tj", "Dushanbe2026x"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": old_password, "full_name": "Nigina Karimova", "language": "en"},
    )
    verify = VERIFY_LINK.search(outbox[-1].text).group(1)  # type: ignore[union-attr]
    assert (await client.post("/api/v1/auth/email/verify", json={"token": verify})).status_code == 204
    device = await login(client, email, old_password)
    device = session_from(await rotate(client, device), device.csrf)
    assert (await client.get(ME, headers={"Authorization": f"Bearer {device.access}"})).status_code == 200

    raw = await request_link(client, outbox, email)
    response = await complete(client, raw)

    assert response.status_code == 204 and response.content == b""
    assert code(await sign_in(client, old_password, email)) == "invalid_credentials"
    # The old access token dies with token_version++, the old refresh cookie with its revoked family.
    stale = await client.get(ME, headers={"Authorization": f"Bearer {device.access}"})
    assert stale.status_code == 401 and code(stale) == "token_invalid"
    assert (await rotate(client, device)).status_code == 401
    assert (await sign_in(client, NEW_PASSWORD, email)).status_code == 200
    reused = await complete(client, raw, "Another2028pass")
    assert reused.status_code == 422 and code(reused) == "email_token_invalid"
    assert (await sign_in(client, NEW_PASSWORD, email)).status_code == 200


# --- start ---------------------------------------------------------------------------------------------------------


async def test_start_emails_a_30_minute_reset_link_and_stores_only_its_hmac(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    user_id, _ = await make_account(session, EMAIL, full_name="Dilshod Rahimov", language="en")
    started = utcnow()

    response = await client.post(START, json={"email": EMAIL})

    assert response.status_code == 202 and response.content == b""
    [sent] = outbox
    assert sent.to == EMAIL and sent.template == "password_reset"
    assert sent.subject == "Reset your TezFarmo password"
    assert "Dilshod Rahimov" in sent.text and "30 minutes" in sent.text
    raw = link_token(sent)
    assert len(raw) >= 43  # 256 bits
    [row] = await reset_tokens(session)
    assert row.user_id == user_id and row.purpose == "RESET_PASSWORD"
    assert row.token_hash == hash_token(raw) and raw not in row.token_hash
    assert row.consumed_at is None
    lifetime = row.expires_at - started
    assert timedelta(minutes=29, seconds=55) <= lifetime <= timedelta(minutes=30, seconds=5)
    assert raw not in response.text


async def test_unknown_address_gets_the_same_answer_and_nothing_else(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    known = await client.post(START, json={"email": EMAIL})
    unknown = await client.post(START, json={"email": "nobody@pamir.tj"})

    assert unknown.status_code == known.status_code == 202
    assert unknown.content == known.content == b""
    assert unknown.headers.get("content-type") == known.headers.get("content-type")
    assert len(outbox) == 1 and outbox[0].to == EMAIL
    assert len(await reset_tokens(session)) == 1


async def test_email_is_trimmed_and_lowercased(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)

    response = await client.post(START, json={"email": "  Dilshod@PAMIR.tj "})

    assert response.status_code == 202
    assert [sent.to for sent in outbox] == [EMAIL]


async def test_email_uses_the_accounts_language(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL, language="ru")

    await client.post(START, json={"email": EMAIL})

    assert outbox[-1].subject == "Восстановление пароля TezFarmo"
    assert "30 мин" in outbox[-1].text


async def test_a_new_link_supersedes_the_previous_one(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    first = await request_link(client, outbox)
    second = await request_link(client, outbox)

    stale = await complete(client, first)

    assert stale.status_code == 422 and code(stale) == "email_token_expired"
    assert (await complete(client, second)).status_code == 204


async def test_password_reset_limit_is_3_per_hour_for_known_and_unknown_addresses(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    for address in (EMAIL, "nobody@pamir.tj"):
        for _ in range(3):
            assert (await client.post(START, json={"email": address})).status_code == 202
        blocked = await client.post(START, json={"email": address.upper()})
        assert blocked.status_code == 429 and code(blocked) == "rate_limited"
        assert int(blocked.headers["Retry-After"]) > 0
    assert len(outbox) == 3


async def test_login_and_reset_limits_are_independent(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    for _ in range(3):
        await client.post(START, json={"email": EMAIL})

    assert (await sign_in(client, PASSWORD)).status_code == 200


async def test_delivery_failure_answers_503_and_keeps_the_previous_link_valid(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    old_raw = await request_link(client, outbox)
    set_email_provider(_FailingEmail())
    try:
        response = await client.post(START, json={"email": EMAIL})
    finally:
        set_email_provider(None)

    assert response.status_code == 503 and code(response) == "service_unavailable"
    assert "smtp" not in response.text.lower()
    [only] = await reset_tokens(session)
    assert only.token_hash == hash_token(old_raw) and only.expires_at > utcnow()
    assert (await complete(client, old_raw)).status_code == 204


@pytest.mark.parametrize(
    ("payload", "field", "error"),
    [
        ({}, "email", "missing"),
        ({"email": ""}, "email", "value_error"),
        ({"email": "   "}, "email", "value_error"),
        ({"email": "not-an-email"}, "email", "value_error"),
        ({"email": EMAIL, "token": "abc"}, "token", "extra_forbidden"),
        ({"email": EMAIL, "new_password": NEW_PASSWORD}, "new_password", "extra_forbidden"),
    ],
)
async def test_malformed_start_requests_are_validation_errors_without_side_effects(
    client: AsyncClient,
    session: AsyncSession,
    outbox: list[OutgoingEmail],
    payload: dict[str, object],
    field: str,
    error: str,
) -> None:
    await make_account(session, EMAIL)

    response = await client.post(START, json=payload)

    assert response.status_code == 422 and code(response) == "validation_error"
    fields = [{"field": f["field"], "code": f["code"]} for f in response.json()["error"]["details"]["fields"]]
    assert {"field": field, "code": error} in fields
    assert outbox == [] and await reset_tokens(session) == []


async def test_unverified_account_can_reset_but_stays_unverified(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL, email_verified_at=None)

    assert (await complete(client, await request_link(client, outbox))).status_code == 204

    assert (await the_user(session)).email_verified_at is None
    # The reset is not a way around IAM-004: signing in still needs the confirmed address.
    assert code(await sign_in(client, NEW_PASSWORD)) == "email_not_verified"


async def test_blocked_account_can_reset_but_stays_blocked(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL, status="BLOCKED")

    assert (await complete(client, await request_link(client, outbox))).status_code == 204

    assert (await the_user(session)).status == "BLOCKED"
    assert code(await sign_in(client, NEW_PASSWORD)) == "user_blocked"


# --- complete ------------------------------------------------------------------------------------------------------


async def test_complete_changes_the_password_and_uses_up_the_link(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    before = await the_user(session)
    snapshot = (before.email, before.email_verified_at, before.status, before.full_name, before.language)
    old_hash, old_version = before.password_hash, before.token_version
    raw = await request_link(client, outbox)

    response = await complete(client, raw)

    assert response.status_code == 204 and response.content == b""
    user = await the_user(session)
    assert user.password_hash != old_hash and NEW_PASSWORD not in user.password_hash
    assert user.password_hash.startswith("$argon2id$")
    assert user.token_version == old_version + 1
    assert (user.email, user.email_verified_at, user.status, user.full_name, user.language) == snapshot
    [row] = await reset_tokens(session)
    assert row.consumed_at is not None
    assert code(await sign_in(client, PASSWORD)) == "invalid_credentials"
    assert (await sign_in(client, NEW_PASSWORD)).status_code == 200


async def test_reset_signs_out_every_device(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    user_id, _ = await make_account(session, EMAIL)
    other_id, other_email = await make_account(session, "other@pamir.tj")
    phone, laptop = await login(client, EMAIL), await login(client, EMAIL)
    laptop = session_from(await rotate(client, laptop), laptop.csrf)
    bystander = await login(client, other_email)

    assert (await complete(client, await request_link(client, outbox))).status_code == 204

    session.expire_all()
    mine = (await session.scalars(select(RefreshToken).where(RefreshToken.user_id == user_id))).all()
    assert len(mine) == 3 and all(row.revoked_at is not None for row in mine)
    for device in (phone, laptop):
        stale = await client.get(ME, headers={"Authorization": f"Bearer {device.access}"})
        assert stale.status_code == 401 and code(stale) == "token_invalid"
        assert (await rotate(client, device)).status_code == 401
    # Other users are untouched.
    theirs = (await session.scalars(select(RefreshToken).where(RefreshToken.user_id == other_id))).all()
    assert all(row.revoked_at is None for row in theirs)
    assert (await client.get(ME, headers={"Authorization": f"Bearer {bystander.access}"})).status_code == 200
    assert (await rotate(client, bystander)).status_code == 200
    # A fresh sign-in with the new password works normally.
    fresh = await login(client, EMAIL, NEW_PASSWORD)
    assert (await client.get(ME, headers={"Authorization": f"Bearer {fresh.access}"})).status_code == 200


async def test_reset_is_audited_once_without_secrets(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    user_id, _ = await make_account(session, EMAIL)
    raw = await request_link(client, outbox)

    await complete(client, raw)

    [entry] = await audits(session, "auth.password_reset")
    assert entry.entity_id == user_id and entry.actor_id == user_id
    assert entry.new_data == {"token_version": 2}
    assert await audits(session, "auth.refresh_reuse") == []


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
async def test_weak_new_password_is_rejected_and_the_link_stays_usable(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail], password: str, problems: set[str]
) -> None:
    await make_account(session, EMAIL)
    raw = await request_link(client, outbox)
    version = (await the_user(session)).token_version

    response = await complete(client, raw, password)

    assert response.status_code == 422 and code(response) == "weak_password"
    fields = response.json()["error"]["details"]["fields"]
    assert {f["field"] for f in fields} == {"new_password"}
    assert {f["code"] for f in fields} == problems
    assert (await the_user(session)).token_version == version
    assert (await reset_tokens(session))[0].consumed_at is None
    assert (await complete(client, raw)).status_code == 204


async def test_unknown_token_is_invalid_and_changes_nothing(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    raw = await request_link(client, outbox)

    response = await complete(client, raw[:-2] + ("AA" if not raw.endswith("AA") else "BB"))

    assert response.status_code == 422 and code(response) == "email_token_invalid"
    assert (await the_user(session)).token_version == 1
    assert (await sign_in(client, PASSWORD)).status_code == 200
    assert await audits(session, "auth.password_reset") == []


async def test_verification_token_cannot_reset_a_password(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    user_id, _ = await make_account(session, EMAIL, email_verified_at=None)
    verify_raw = await issue_email_token(session, user_id, "VERIFY_EMAIL")
    await session.commit()

    response = await complete(client, verify_raw)

    assert response.status_code == 422 and code(response) == "email_token_invalid"
    assert (await the_user(session)).token_version == 1
    # The verification link itself is untouched and still works.
    assert (await client.post("/api/v1/auth/email/verify", json={"token": verify_raw})).status_code == 204


async def test_expired_token_is_rejected(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    raw = await request_link(client, outbox)
    await session.execute(
        update(EmailToken)
        .where(EmailToken.token_hash == hash_token(raw))
        .values(expires_at=utcnow() - timedelta(seconds=1))
    )
    await session.commit()

    response = await complete(client, raw)

    assert response.status_code == 422 and code(response) == "email_token_expired"
    assert (await sign_in(client, PASSWORD)).status_code == 200


@pytest.mark.parametrize(
    ("payload", "field", "error"),
    [
        ({"new_password": NEW_PASSWORD}, "token", "missing"),
        ({"token": "", "new_password": NEW_PASSWORD}, "token", "string_too_short"),
        ({"token": "x" * 513, "new_password": NEW_PASSWORD}, "token", "string_too_long"),
        ({"token": "abc"}, "new_password", "missing"),
        ({"token": "abc", "new_password": "x" * 1025}, "new_password", "string_too_long"),
        ({"token": "abc", "new_password": NEW_PASSWORD, "email": EMAIL}, "email", "extra_forbidden"),
        ({"token": "abc", "new_password": NEW_PASSWORD, "password": "x"}, "password", "extra_forbidden"),
    ],
)
async def test_malformed_complete_requests_are_validation_errors(
    client: AsyncClient, session: AsyncSession, payload: dict[str, object], field: str, error: str
) -> None:
    await make_account(session, EMAIL)

    response = await client.post(COMPLETE, json=payload)

    assert response.status_code == 422 and code(response) == "validation_error"
    fields = [{"field": f["field"], "code": f["code"]} for f in response.json()["error"]["details"]["fields"]]
    assert {"field": field, "code": error} in fields
    assert (await the_user(session)).token_version == 1


async def test_concurrent_completions_with_one_token_succeed_once(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    raw = await request_link(client, outbox)
    passwords = ["Khujand2027a", "Khujand2027b", "Khujand2027c"]

    responses = await asyncio.gather(*(complete(client, raw, password) for password in passwords))

    statuses = [response.status_code for response in responses]
    assert statuses.count(204) == 1 and statuses.count(422) == 2
    assert all(code(r) == "email_token_invalid" for r in responses if r.status_code == 422)
    winner = passwords[statuses.index(204)]
    assert (await the_user(session)).token_version == 2
    assert len(await audits(session, "auth.password_reset")) == 1
    for password in passwords:
        assert (await sign_in(client, password)).status_code == (200 if password == winner else 401)


async def test_secrets_stay_out_of_responses_logs_and_audit(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail], caplog: pytest.LogCaptureFixture
) -> None:
    await make_account(session, EMAIL)
    device = await login(client, EMAIL)

    with caplog.at_level(logging.DEBUG):
        started = await client.post(START, json={"email": EMAIL})
        raw = link_token(outbox[-1])
        completed = await complete(client, raw)

    assert "email recorded (not sent): password_reset" in caplog.text  # the capture sees the email logger
    user = await the_user(session)
    secrets = [raw, hash_token(raw), NEW_PASSWORD, PASSWORD, user.password_hash, device.access, device.refresh]
    for secret in secrets:
        assert secret not in caplog.text
        assert secret not in started.text + completed.text
    assert EMAIL not in caplog.text
    count = await session.scalar(select(func.count()).select_from(AuditLog))
    assert count
    for entry in (await session.scalars(select(AuditLog))).all():
        for secret in secrets:
            assert secret not in str(entry.old_data) + str(entry.new_data)
