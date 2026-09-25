"""P01 email verification: IAM-002 (single use, 24 h, purpose), 02_ERROR_CODES email_token_*, auth_email_verify."""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Iterator
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.email import MemoryEmailProvider, OutgoingEmail, set_email_provider
from app.core.time import utcnow
from app.modules.auth.models import EmailToken
from app.modules.auth.tokens import hash_token, issue_email_token
from app.modules.identity.models import User

REGISTER = "/api/v1/auth/register"
VERIFY = "/api/v1/auth/email/verify"
TOKEN_IN_LINK = re.compile(r"/verify-email\?token=([A-Za-z0-9_-]+)")


@pytest.fixture
def outbox() -> Iterator[list[OutgoingEmail]]:
    provider = MemoryEmailProvider()
    set_email_provider(provider)
    yield provider.outbox
    set_email_provider(None)


async def register(client: AsyncClient, outbox: list[OutgoingEmail], email: str = "nigina@example.tj") -> str:
    """Register through the real endpoint and return the raw token from the emailed link."""
    response = await client.post(
        REGISTER, json={"email": email, "password": "Dushanbe2026x", "full_name": "Nigina Karimova", "language": "en"}
    )
    assert response.status_code == 202
    match = TOKEN_IN_LINK.search(outbox[-1].text)
    assert match
    return match.group(1)


async def the_user(session: AsyncSession, email: str = "nigina@example.tj") -> User:
    session.expire_all()
    user = await session.scalar(select(User).where(User.email == email))
    assert user is not None
    return user


async def token_row(session: AsyncSession, raw: str) -> EmailToken:
    session.expire_all()
    row = await session.scalar(select(EmailToken).where(EmailToken.token_hash == hash_token(raw)))
    assert row is not None
    return row


def error_code(response_json: dict[str, object]) -> object:
    return response_json["error"]["code"]  # type: ignore[index]


async def test_iam_002_valid_token_confirms_the_email_and_answers_204(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    raw = await register(client, outbox)
    before = await the_user(session)
    snapshot = (before.status, before.password_hash, before.token_version, before.full_name, before.language)
    started = utcnow()

    response = await client.post(VERIFY, json={"token": raw})

    assert response.status_code == 204
    assert response.content == b""
    user = await the_user(session)
    assert user.email_verified_at is not None
    assert started - timedelta(seconds=5) <= user.email_verified_at <= utcnow() + timedelta(seconds=5)
    # Nothing else about the user changes.
    assert (user.status, user.password_hash, user.token_version, user.full_name, user.language) == snapshot
    assert user.phone is None and user.phone_verified_at is None
    token = await token_row(session, raw)
    assert token.consumed_at is not None


async def test_iam_002_token_is_single_use(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    raw = await register(client, outbox)
    assert (await client.post(VERIFY, json={"token": raw})).status_code == 204
    first_confirmation = (await the_user(session)).email_verified_at

    again = await client.post(VERIFY, json={"token": raw})

    assert again.status_code == 422
    assert error_code(again.json()) == "email_token_invalid"
    assert (await the_user(session)).email_verified_at == first_confirmation


async def test_iam_002_expired_token_is_rejected_and_not_consumed(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    raw = await register(client, outbox)
    await session.execute(
        update(EmailToken)
        .where(EmailToken.token_hash == hash_token(raw))
        .values(expires_at=utcnow() - timedelta(seconds=1))
    )
    await session.commit()

    response = await client.post(VERIFY, json={"token": raw})

    assert response.status_code == 422
    assert error_code(response.json()) == "email_token_expired"
    assert (await the_user(session)).email_verified_at is None
    assert (await token_row(session, raw)).consumed_at is None


@pytest.mark.parametrize("token", ["x", "not-a-real-token-" + "a" * 26, "A" * 512])
async def test_iam_002_unknown_token_is_invalid(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail], token: str
) -> None:
    await register(client, outbox)

    response = await client.post(VERIFY, json={"token": token})

    assert response.status_code == 422
    assert error_code(response.json()) == "email_token_invalid"
    assert (await the_user(session)).email_verified_at is None


async def test_iam_002_wrong_purpose_token_is_invalid(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await register(client, outbox)
    user = await the_user(session)
    reset_raw = await issue_email_token(session, user.id, "RESET_PASSWORD")
    await session.commit()

    response = await client.post(VERIFY, json={"token": reset_raw})

    assert response.status_code == 422
    assert error_code(response.json()) == "email_token_invalid"
    assert (await the_user(session)).email_verified_at is None
    # The reset token stays usable for its own purpose.
    assert (await token_row(session, reset_raw)).consumed_at is None


async def test_newer_token_supersedes_the_older_one(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    old_raw = await register(client, outbox)
    user = await the_user(session)
    new_raw = await issue_email_token(session, user.id, "VERIFY_EMAIL")
    await session.commit()

    old = await client.post(VERIFY, json={"token": old_raw})
    assert old.status_code == 422
    assert error_code(old.json()) == "email_token_expired"
    assert (await the_user(session)).email_verified_at is None

    assert (await client.post(VERIFY, json={"token": new_raw})).status_code == 204
    assert (await the_user(session)).email_verified_at is not None


async def test_already_verified_user_keeps_the_first_confirmation_time(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await register(client, outbox)
    user = await the_user(session)
    confirmed_at = utcnow() - timedelta(days=3)
    user.email_verified_at = confirmed_at
    raw = await issue_email_token(session, user.id, "VERIFY_EMAIL")
    await session.commit()

    response = await client.post(VERIFY, json={"token": raw})

    # The documented contract: a valid token answers 204 and is used up; the state is not rewritten.
    assert response.status_code == 204
    assert (await the_user(session)).email_verified_at == confirmed_at
    assert (await token_row(session, raw)).consumed_at is not None
    audit = (await session.scalars(select(AuditLog).where(AuditLog.action == "user.email_verified"))).all()
    assert audit == []


async def test_concurrent_requests_consume_the_token_once(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    raw = await register(client, outbox)

    responses = await asyncio.gather(*(client.post(VERIFY, json={"token": raw}) for _ in range(4)))

    statuses = sorted(response.status_code for response in responses)
    assert statuses == [204, 422, 422, 422]
    assert {error_code(r.json()) for r in responses if r.status_code == 422} == {"email_token_invalid"}
    audit = (await session.scalars(select(AuditLog).where(AuditLog.action == "user.email_verified"))).all()
    assert len(audit) == 1


async def test_raw_token_is_never_stored_logged_or_audited(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail], caplog: pytest.LogCaptureFixture
) -> None:
    raw = await register(client, outbox)
    with caplog.at_level(logging.DEBUG):
        response = await client.post(VERIFY, json={"token": raw})
        await client.post(VERIFY, json={"token": raw})  # the failing path logs nothing secret either

    assert response.status_code == 204
    assert raw not in caplog.text
    session.expire_all()
    for row in (await session.scalars(select(EmailToken))).all():
        assert raw not in {row.token_hash, str(row.id), row.purpose}
    user = await the_user(session)
    [entry] = (await session.scalars(select(AuditLog).where(AuditLog.action == "user.email_verified"))).all()
    assert entry.entity_id == user.id and entry.actor_id == user.id
    assert entry.new_data == {"email_verified": True}
    assert raw not in str(entry.old_data) + str(entry.new_data)


async def test_rate_limit_auth_email_verify_10_per_hour_per_ip(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    raw = await register(client, outbox)
    for attempt in range(10):
        assert (await client.post(VERIFY, json={"token": f"guess-{attempt}"})).status_code == 422

    blocked = await client.post(VERIFY, json={"token": raw})

    assert blocked.status_code == 429
    assert error_code(blocked.json()) == "rate_limited"
    assert int(blocked.headers["Retry-After"]) > 0
    # A blocked attempt does not consume the token.
    assert (await token_row(session, raw)).consumed_at is None
    assert (await the_user(session)).email_verified_at is None


@pytest.mark.parametrize(
    ("payload", "field", "code"),
    [
        ({}, "token", "missing"),
        ({"token": ""}, "token", "string_too_short"),
        ({"token": "A" * 513}, "token", "string_too_long"),
        ({"token": "abc", "email": "nigina@example.tj"}, "email", "extra_forbidden"),
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
