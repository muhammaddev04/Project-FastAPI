"""P01 email verification with a 6-digit code (IAM-002 as changed by the owner: a code instead of a link):
single use, 15 minutes, purpose- and user-bound, 5 wrong codes per 15 minutes per email, auth_email_verify per IP,
email_token_* errors (CR-001)."""

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

from app.core.audit import AuditLog
from app.core.email import MemoryEmailProvider, OutgoingEmail, set_email_provider
from app.core.time import utcnow
from app.modules.auth.models import EmailToken
from app.modules.auth.tokens import hash_code, issue_email_code, issue_email_token
from app.modules.identity.models import User

REGISTER = "/api/v1/auth/register"
VERIFY = "/api/v1/auth/email/verify"
EMAIL = "nigina@example.tj"
CODE_IN_EMAIL = re.compile(r":\s*([0-9]{6})\s*$", re.M)


@pytest.fixture
def outbox() -> Iterator[list[OutgoingEmail]]:
    provider = MemoryEmailProvider()
    set_email_provider(provider)
    yield provider.outbox
    set_email_provider(None)


def email_code(message: OutgoingEmail) -> str:
    match = CODE_IN_EMAIL.search(message.text)
    assert match, "the verification email carries a 6-digit code"
    return match.group(1)


async def register(client: AsyncClient, outbox: list[OutgoingEmail], email: str = EMAIL) -> str:
    """Register through the real endpoint and return the 6-digit code from the email."""
    response = await client.post(
        REGISTER, json={"email": email, "password": "Dushanbe2026x", "full_name": "Nigina Karimova", "language": "en"}
    )
    assert response.status_code == 202
    return email_code(outbox[-1])


async def verify(client: AsyncClient, code: str, email: str = EMAIL) -> Response:
    return await client.post(VERIFY, json={"email": email, "code": code})


def other_code(code: str) -> str:
    return f"{(int(code) + 1) % 1_000_000:06d}"


async def the_user(session: AsyncSession, email: str = EMAIL) -> User:
    session.expire_all()
    user = await session.scalar(select(User).where(User.email == email))
    assert user is not None
    return user


async def code_row(session: AsyncSession, user_id: UUID, code: str) -> EmailToken:
    session.expire_all()
    row = await session.scalar(
        select(EmailToken).where(EmailToken.token_hash == hash_code(user_id, "VERIFY_EMAIL", code))
    )
    assert row is not None
    return row


def error_code(response: Response) -> object:
    return response.json()["error"]["code"]


async def test_iam_002_valid_code_confirms_the_email_and_answers_204(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    code = await register(client, outbox)
    before = await the_user(session)
    snapshot = (before.status, before.password_hash, before.token_version, before.full_name, before.language)
    user_id = before.id
    started = utcnow()

    response = await verify(client, code)

    assert response.status_code == 204
    assert response.content == b""
    user = await the_user(session)
    assert user.email_verified_at is not None
    assert started - timedelta(seconds=5) <= user.email_verified_at <= utcnow() + timedelta(seconds=5)
    # Nothing else about the user changes.
    assert (user.status, user.password_hash, user.token_version, user.full_name, user.language) == snapshot
    assert (await code_row(session, user_id, code)).consumed_at is not None


async def test_email_is_trimmed_and_lowercased_like_everywhere_else(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    code = await register(client, outbox)

    assert (await verify(client, code, "  Nigina@EXAMPLE.tj ")).status_code == 204
    assert (await the_user(session)).email_verified_at is not None


async def test_code_is_stored_as_user_bound_hmac_for_15_minutes(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    started = utcnow()
    code = await register(client, outbox)
    user_id = (await the_user(session)).id

    row = await code_row(session, user_id, code)

    assert re.fullmatch(r"[0-9]{6}", code)
    assert row.purpose == "VERIFY_EMAIL" and row.consumed_at is None
    assert code not in row.token_hash and len(row.token_hash) == 64
    lifetime = row.expires_at - started
    assert timedelta(minutes=14, seconds=55) <= lifetime <= timedelta(minutes=15, seconds=5)


async def test_codes_are_random(client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]) -> None:
    await register(client, outbox)
    user = await the_user(session)
    codes = {await issue_email_code(session, user.id, "VERIFY_EMAIL") for _ in range(30)}
    await session.rollback()

    assert all(re.fullmatch(r"[0-9]{6}", code) for code in codes)
    assert len(codes) >= 25  # 30 draws from a million values: repeats are very unlikely


async def test_iam_002_code_is_single_use(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    code = await register(client, outbox)
    assert (await verify(client, code)).status_code == 204
    first_confirmation = (await the_user(session)).email_verified_at

    again = await verify(client, code)

    assert again.status_code == 422 and error_code(again) == "email_token_invalid"
    assert (await the_user(session)).email_verified_at == first_confirmation


async def test_wrong_code_is_invalid_and_leaves_the_right_one_usable(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    code = await register(client, outbox)

    wrong = await verify(client, other_code(code))

    assert wrong.status_code == 422 and error_code(wrong) == "email_token_invalid"
    assert (await the_user(session)).email_verified_at is None
    assert (await verify(client, code)).status_code == 204


async def test_iam_002_expired_code_is_rejected_and_not_consumed(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    code = await register(client, outbox)
    user_id = (await the_user(session)).id
    await session.execute(
        update(EmailToken)
        .where(EmailToken.token_hash == hash_code(user_id, "VERIFY_EMAIL", code))
        .values(expires_at=utcnow() - timedelta(seconds=1))
    )
    await session.commit()

    response = await verify(client, code)

    assert response.status_code == 422 and error_code(response) == "email_token_expired"
    assert (await the_user(session)).email_verified_at is None
    assert (await code_row(session, user_id, code)).consumed_at is None


async def test_a_code_only_works_for_the_account_it_was_sent_to(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    code = await register(client, outbox)
    await register(client, outbox, "dilshod@pamir.tj")

    response = await verify(client, code, "dilshod@pamir.tj")

    assert response.status_code == 422 and error_code(response) == "email_token_invalid"
    assert (await the_user(session, "dilshod@pamir.tj")).email_verified_at is None
    assert (await verify(client, code)).status_code == 204


async def test_unknown_address_looks_exactly_like_a_wrong_code(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    code = await register(client, outbox)

    unknown = await verify(client, code, "nobody@example.tj")
    wrong = await verify(client, other_code(code))

    assert unknown.status_code == wrong.status_code == 422
    assert unknown.json()["error"]["code"] == wrong.json()["error"]["code"] == "email_token_invalid"
    assert unknown.json()["error"]["message"] == wrong.json()["error"]["message"]


async def test_iam_002_reset_token_is_not_a_verification_code(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    code = await register(client, outbox)
    user = await the_user(session)
    await issue_email_token(session, user.id, "RESET_PASSWORD")
    await session.commit()

    # The verification code keeps working for its own purpose.
    assert (await verify(client, code)).status_code == 204


async def test_newer_code_supersedes_the_older_one(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    old = await register(client, outbox)
    user = await the_user(session)
    new = await issue_email_code(session, user.id, "VERIFY_EMAIL")
    await session.commit()
    if new == old:  # one chance in a million; the test is about two different codes
        pytest.skip("the two random codes happened to be equal")

    stale = await verify(client, old)

    assert stale.status_code == 422 and error_code(stale) == "email_token_expired"
    assert (await the_user(session)).email_verified_at is None
    assert (await verify(client, new)).status_code == 204


async def test_already_verified_user_keeps_the_first_confirmation_time(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await register(client, outbox)
    user = await the_user(session)
    confirmed_at = utcnow() - timedelta(days=3)
    user.email_verified_at = confirmed_at
    code = await issue_email_code(session, user.id, "VERIFY_EMAIL")
    await session.commit()

    response = await verify(client, code)

    # The documented contract: a valid code answers 204 and is used up; the state is not rewritten.
    assert response.status_code == 204
    assert (await the_user(session)).email_verified_at == confirmed_at
    audit = (await session.scalars(select(AuditLog).where(AuditLog.action == "user.email_verified"))).all()
    assert audit == []


async def test_concurrent_requests_consume_the_code_once(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    code = await register(client, outbox)

    responses = await asyncio.gather(*(verify(client, code) for _ in range(4)))

    statuses = sorted(response.status_code for response in responses)
    assert statuses == [204, 422, 422, 422]
    assert {error_code(r) for r in responses if r.status_code == 422} == {"email_token_invalid"}
    audit = (await session.scalars(select(AuditLog).where(AuditLog.action == "user.email_verified"))).all()
    assert len(audit) == 1


async def test_five_wrong_codes_lock_verification_for_that_email(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    code = await register(client, outbox)
    guess = code
    for _ in range(5):
        guess = other_code(guess)
        assert (await verify(client, guess)).status_code == 422

    blocked = await verify(client, code)

    # Even the right code is refused until the window passes: guessing a million values stays impractical.
    assert blocked.status_code == 429 and error_code(blocked) == "rate_limited"
    assert int(blocked.headers["Retry-After"]) > 0
    user = await the_user(session)
    assert user.email_verified_at is None
    assert (await code_row(session, user.id, code)).consumed_at is None


async def test_the_attempt_cap_also_counts_unknown_addresses(client: AsyncClient) -> None:
    for attempt in range(5):
        assert (await verify(client, f"{attempt:06d}", "nobody@example.tj")).status_code == 422

    blocked = await verify(client, "123456", "nobody@example.tj")

    assert blocked.status_code == 429 and error_code(blocked) == "rate_limited"


async def test_rate_limit_auth_email_verify_10_per_hour_per_ip(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    code = await register(client, outbox)
    for attempt in range(10):
        # Spread over addresses, so the per-email cap is not what stops them.
        assert (await verify(client, f"{attempt:06d}", f"guess{attempt}@example.tj")).status_code == 422

    blocked = await verify(client, code)

    assert blocked.status_code == 429 and error_code(blocked) == "rate_limited"
    assert int(blocked.headers["Retry-After"]) > 0
    assert (await the_user(session)).email_verified_at is None


async def test_raw_code_is_never_stored_logged_or_audited(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail], caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        code = await register(client, outbox)
        response = await verify(client, code)
        again = await verify(client, code)  # the failing path shows nothing secret either

    assert response.status_code == 204
    assert code not in caplog.text and code not in again.text
    session.expire_all()
    for row in (await session.scalars(select(EmailToken))).all():
        assert code not in {row.token_hash, str(row.id), row.purpose}
    user = await the_user(session)
    [entry] = (await session.scalars(select(AuditLog).where(AuditLog.action == "user.email_verified"))).all()
    assert entry.entity_id == user.id and entry.actor_id == user.id
    assert entry.new_data == {"email_verified": True}
    assert code not in str(entry.old_data) + str(entry.new_data)


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
        ({"email": EMAIL, "code": " 123456"}, "code", "string_pattern_mismatch"),
        ({"email": EMAIL, "code": "１２３４５６"}, "code", "string_pattern_mismatch"),
        ({"email": EMAIL, "code": 123456}, "code", "string_type"),
        ({"email": "not-an-email", "code": "123456"}, "email", "value_error"),
        ({"email": EMAIL, "code": "123456", "token": "abc"}, "token", "extra_forbidden"),
    ],
)
async def test_malformed_requests_are_validation_errors(
    client: AsyncClient, payload: dict[str, object], field: str, code: str
) -> None:
    response = await client.post(VERIFY, json=payload)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert {"field": field, "code": code} in [
        {"field": f["field"], "code": f["code"]} for f in error["details"]["fields"]
    ]
