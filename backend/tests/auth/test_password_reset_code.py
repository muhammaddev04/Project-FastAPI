"""Password reset with a 6-digit code (IAM-015 as changed by the owner): `start` emails a code (no link), `verify`
spends it once for a 10-minute single-use authorization, `complete` accepts only that authorization. Codes are
user- and purpose-bound HMACs, capped at 5 wrong guesses per email per 30 minutes (CR-001)."""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Iterator
from datetime import timedelta
from uuid import UUID

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.email import MemoryEmailProvider, OutgoingEmail, set_email_provider
from app.core.time import utcnow
from app.modules.auth.models import EmailToken
from app.modules.auth.tokens import hash_code, hash_token, issue_email_code
from app.modules.identity.models import User
from tests.auth.test_refresh import LOGIN, PASSWORD, make_account

START = "/api/v1/auth/password/reset/start"
VERIFY = "/api/v1/auth/password/reset/verify"
COMPLETE = "/api/v1/auth/password/reset/complete"
EMAIL = "dilshod@pamir.tj"
NEW_PASSWORD = "Khujand2027new"
CODE_IN_EMAIL = re.compile(r":\s*([0-9]{6})\s*$", re.M)


@pytest.fixture
def outbox() -> Iterator[list[OutgoingEmail]]:
    provider = MemoryEmailProvider()
    set_email_provider(provider)
    yield provider.outbox
    set_email_provider(None)


def email_code(message: OutgoingEmail) -> str:
    match = CODE_IN_EMAIL.search(message.text)
    assert match
    return match.group(1)


async def start(client: AsyncClient, outbox: list[OutgoingEmail], email: str = EMAIL) -> str:
    assert (await client.post(START, json={"email": email})).status_code == 202
    return email_code(outbox[-1])


async def verify(client: AsyncClient, code: str, email: str = EMAIL) -> Response:
    return await client.post(VERIFY, json={"email": email, "code": code})


async def complete(client: AsyncClient, token: str, password: str = NEW_PASSWORD) -> Response:
    return await client.post(COMPLETE, json={"token": token, "new_password": password})


def other_code(code: str) -> str:
    return f"{(int(code) + 1) % 1_000_000:06d}"


def error(response: Response) -> str:
    return response.json()["error"]["code"]


async def user_id(session: AsyncSession, email: str = EMAIL) -> UUID:
    session.expire_all()
    found = await session.scalar(select(User.id).where(User.email == email))
    assert found is not None
    return found


async def sign_in(client: AsyncClient, password: str, email: str = EMAIL) -> int:
    response = await client.post(LOGIN, json={"email": email, "password": password})
    client.cookies.clear()
    return response.status_code


# --- the whole flow ------------------------------------------------------------------------------------------------


async def test_code_is_verified_then_the_authorization_resets_the_password(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    code = await start(client, outbox)

    verified = await verify(client, code)

    assert verified.status_code == 200
    assert verified.headers["Cache-Control"] == "no-store"
    body = verified.json()
    assert set(body) == {"reset_token", "expires_in"} and body["expires_in"] == 600
    assert len(body["reset_token"]) >= 43 and code not in body["reset_token"]
    assert (await complete(client, body["reset_token"])).status_code == 204
    assert await sign_in(client, PASSWORD) == 401
    assert await sign_in(client, NEW_PASSWORD) == 200
    # Both the code and the authorization are spent.
    assert error(await verify(client, code)) == "email_token_invalid"
    reused = await complete(client, body["reset_token"], "Another2028pass")
    assert reused.status_code == 422 and error(reused) == "email_token_invalid"
    assert await sign_in(client, NEW_PASSWORD) == 200


async def test_authorization_lives_10_minutes_and_is_stored_as_hmac(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    started = utcnow()
    token = (await verify(client, await start(client, outbox))).json()["reset_token"]

    session.expire_all()
    row = await session.scalar(select(EmailToken).where(EmailToken.token_hash == hash_token(token)))
    assert row is not None and row.purpose == "RESET_PASSWORD" and row.consumed_at is None
    assert token not in row.token_hash
    assert timedelta(minutes=9, seconds=55) <= row.expires_at - started <= timedelta(minutes=10, seconds=5)


# --- the code ------------------------------------------------------------------------------------------------------


async def test_code_is_stored_as_user_bound_hmac(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    code = await start(client, outbox)
    uid = await user_id(session)

    row = await session.scalar(select(EmailToken).where(EmailToken.user_id == uid))

    assert row is not None and row.token_hash == hash_code(uid, "RESET_PASSWORD", code)
    assert code not in row.token_hash


async def test_codes_are_random(client: AsyncClient, session: AsyncSession) -> None:
    uid, _ = await make_account(session, EMAIL)
    codes = {await issue_email_code(session, uid, "RESET_PASSWORD") for _ in range(30)}
    await session.rollback()

    assert all(re.fullmatch(r"[0-9]{6}", code) for code in codes) and len(codes) >= 25


async def test_wrong_code_is_rejected_and_the_right_one_still_works(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    code = await start(client, outbox)

    wrong = await verify(client, other_code(code))

    assert wrong.status_code == 422 and error(wrong) == "email_token_invalid"
    assert (await verify(client, code)).status_code == 200


async def test_expired_code_is_rejected(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    code = await start(client, outbox)
    uid = await user_id(session)
    await session.execute(
        update(EmailToken)
        .where(EmailToken.token_hash == hash_code(uid, "RESET_PASSWORD", code))
        .values(expires_at=utcnow() - timedelta(seconds=1))
    )
    await session.commit()

    response = await verify(client, code)

    assert response.status_code == 422 and error(response) == "email_token_expired"


async def test_used_code_is_rejected(client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]) -> None:
    await make_account(session, EMAIL)
    code = await start(client, outbox)
    assert (await verify(client, code)).status_code == 200

    again = await verify(client, code)

    assert again.status_code == 422 and error(again) == "email_token_invalid"


async def test_a_new_code_retires_the_old_code_and_any_pending_authorization(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    first_code = await start(client, outbox)
    early_token = (await verify(client, first_code)).json()["reset_token"]
    second_start_code = await start(client, outbox)
    third_code = await start(client, outbox)

    if second_start_code != third_code:  # equal random codes are a one-in-a-million event
        stale = await verify(client, second_start_code)
        assert stale.status_code == 422 and error(stale) == "email_token_expired"
    # The authorization from before the new code no longer works either.
    old_auth = await complete(client, early_token)
    assert old_auth.status_code == 422 and error(old_auth) == "email_token_expired"
    token = (await verify(client, third_code)).json()["reset_token"]
    assert (await complete(client, token)).status_code == 204


async def test_the_code_itself_is_not_an_authorization(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    code = await start(client, outbox)

    response = await complete(client, code)

    assert response.status_code == 422 and error(response) == "email_token_invalid"
    assert await sign_in(client, PASSWORD) == 200
    assert (await verify(client, code)).status_code == 200  # the code is untouched


async def test_a_code_only_works_for_its_account_and_purpose(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    other_id, other_email = await make_account(session, "other@pamir.tj")
    code = await start(client, outbox)
    verify_code = await issue_email_code(session, other_id, "VERIFY_EMAIL")
    await session.commit()

    assert error(await verify(client, code, other_email)) == "email_token_invalid"
    assert error(await verify(client, verify_code, other_email)) == "email_token_invalid"
    assert (await verify(client, code)).status_code == 200


async def test_unknown_address_is_indistinguishable_from_a_wrong_code(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    code = await start(client, outbox)

    unknown = await verify(client, code, "nobody@pamir.tj")
    wrong = await verify(client, other_code(code))

    assert unknown.status_code == wrong.status_code == 422
    assert unknown.json()["error"]["code"] == wrong.json()["error"]["code"] == "email_token_invalid"
    assert unknown.json()["error"]["message"] == wrong.json()["error"]["message"]


async def test_five_wrong_codes_lock_the_reset_for_that_email(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    code = await start(client, outbox)
    guess = code
    for _ in range(5):
        guess = other_code(guess)
        assert (await verify(client, guess)).status_code == 422

    blocked = await verify(client, code)

    assert blocked.status_code == 429 and error(blocked) == "rate_limited"
    assert int(blocked.headers["Retry-After"]) > 0
    # Even the right code was not spent.
    uid = await user_id(session)
    row = await session.scalar(
        select(EmailToken).where(EmailToken.token_hash == hash_code(uid, "RESET_PASSWORD", code))
    )
    assert row is not None and row.consumed_at is None


async def test_the_attempt_cap_counts_unknown_addresses_too(client: AsyncClient) -> None:
    for attempt in range(5):
        assert (await verify(client, f"{attempt:06d}", "nobody@pamir.tj")).status_code == 422

    assert (await verify(client, "123456", "nobody@pamir.tj")).status_code == 429


async def test_concurrent_verifications_spend_the_code_once(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await make_account(session, EMAIL)
    code = await start(client, outbox)

    responses = await asyncio.gather(*(verify(client, code) for _ in range(4)))

    assert sorted(r.status_code for r in responses) == [200, 422, 422, 422]


@pytest.mark.parametrize(
    ("payload", "field", "code"),
    [
        ({"email": EMAIL}, "code", "missing"),
        ({"code": "123456"}, "email", "missing"),
        ({"email": EMAIL, "code": ""}, "code", "string_pattern_mismatch"),
        ({"email": EMAIL, "code": "12345"}, "code", "string_pattern_mismatch"),
        ({"email": EMAIL, "code": "1234567"}, "code", "string_pattern_mismatch"),
        ({"email": EMAIL, "code": "abcdef"}, "code", "string_pattern_mismatch"),
        ({"email": EMAIL, "code": "12a456"}, "code", "string_pattern_mismatch"),
        ({"email": EMAIL, "code": 123456}, "code", "string_type"),
        ({"email": EMAIL, "code": "123456", "token": "x"}, "token", "extra_forbidden"),
    ],
)
async def test_malformed_verify_requests_are_validation_errors(
    client: AsyncClient, payload: dict[str, object], field: str, code: str
) -> None:
    response = await client.post(VERIFY, json=payload)

    assert response.status_code == 422 and error(response) == "validation_error"
    fields = [{"field": f["field"], "code": f["code"]} for f in response.json()["error"]["details"]["fields"]]
    assert {"field": field, "code": code} in fields


async def test_the_code_never_reaches_logs_or_responses(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail], caplog: pytest.LogCaptureFixture
) -> None:
    await make_account(session, EMAIL)
    with caplog.at_level(logging.DEBUG):
        code = await start(client, outbox)
        wrong = await verify(client, other_code(code))
        right = await verify(client, code)
        again = await verify(client, code)

    assert code not in caplog.text
    for response in (wrong, right, again):
        assert code not in response.text


@pytest.mark.parametrize(
    ("language", "subject", "expiry"),
    [
        ("en", "Your TezFarmo password reset code", "expires in 30 minutes"),
        ("ru", "Код для восстановления пароля TezFarmo", "через 30 мин"),
        ("tg", "Рамзи барқарории пароли TezFarmo", "баъди 30 дақиқа"),
    ],
)
async def test_every_language_sends_the_code_and_no_link(
    client: AsyncClient,
    session: AsyncSession,
    outbox: list[OutgoingEmail],
    language: str,
    subject: str,
    expiry: str,
) -> None:
    await make_account(session, EMAIL, language=language)

    code = await start(client, outbox)

    [message] = outbox
    assert message.subject == subject and expiry in message.text
    assert re.fullmatch(r"[0-9]{6}", code) and code in message.html
    for part in (message.text, message.html):
        assert "http" not in part and "href" not in part and "token" not in part and "reset-password" not in part
    assert "<a " not in message.html
