"""P01 `POST /auth/email/resend`: new VERIFY_EMAIL link for unverified accounts only, 60 s cooldown
(`email_resend_too_early`), auth_email_send hourly limit, and no account enumeration (CR-001)."""

from __future__ import annotations

import logging
import re
from collections.abc import Iterator
from datetime import timedelta

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.email import EmailDeliveryError, MemoryEmailProvider, OutgoingEmail, set_email_provider
from app.core.redis import get_redis
from app.core.time import utcnow
from app.modules.auth.models import EmailToken
from app.modules.auth.tokens import hash_token
from app.modules.identity.models import User

REGISTER = "/api/v1/auth/register"
RESEND = "/api/v1/auth/email/resend"
VERIFY = "/api/v1/auth/email/verify"
EMAIL = "nigina@example.tj"
TOKEN_IN_LINK = re.compile(r"/verify-email\?token=([A-Za-z0-9_-]+)")


@pytest.fixture
def outbox() -> Iterator[list[OutgoingEmail]]:
    provider = MemoryEmailProvider()
    set_email_provider(provider)
    yield provider.outbox
    set_email_provider(None)


async def register(client: AsyncClient, outbox: list[OutgoingEmail], language: str = "en") -> str:
    response = await client.post(
        REGISTER,
        json={"email": EMAIL, "password": "Dushanbe2026x", "full_name": "Nigina Karimova", "language": language},
    )
    assert response.status_code == 202
    return link_token(outbox[-1])


def link_token(message: OutgoingEmail) -> str:
    match = TOKEN_IN_LINK.search(message.text)
    assert match, "a verification email carries a /verify-email?token=… link"
    return match.group(1)


async def cooldown_passes() -> None:
    """Simulate the 60 s cooldown elapsing (other limits, like the hourly one, keep their counts)."""
    redis = get_redis()
    for key in await redis.keys("rl:auth_email_resend:*"):
        await redis.delete(key)


async def tokens(session: AsyncSession) -> list[EmailToken]:
    session.expire_all()
    return list((await session.scalars(select(EmailToken).order_by(EmailToken.created_at))).all())


async def the_user(session: AsyncSession) -> User:
    session.expire_all()
    user = await session.scalar(select(User).where(User.email == EMAIL))
    assert user is not None
    return user


def visible(response: Response) -> tuple[int, bytes]:
    return response.status_code, response.content


async def test_unverified_account_gets_a_new_working_link_and_the_old_one_stops_working(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    old_raw = await register(client, outbox)
    await cooldown_passes()
    before = utcnow()

    response = await client.post(RESEND, json={"email": EMAIL})

    assert visible(response) == (202, b"")
    old, new = await tokens(session)
    new_raw = link_token(outbox[-1])
    assert outbox[-1].template == "verification" and outbox[-1].to == EMAIL
    # Same token system: VERIFY_EMAIL, HMAC only, 24 hours.
    assert new.purpose == "VERIFY_EMAIL" and new.consumed_at is None
    assert new.token_hash == hash_token(new_raw) and new_raw not in new.token_hash
    assert timedelta(hours=24) - timedelta(minutes=1) <= new.expires_at - before <= timedelta(hours=24, minutes=1)
    assert old.token_hash == hash_token(old_raw)
    assert old.expires_at <= utcnow() and old.consumed_at is None

    stale = await client.post(VERIFY, json={"token": old_raw})
    assert stale.status_code == 422 and stale.json()["error"]["code"] == "email_token_expired"
    assert (await client.post(VERIFY, json={"token": new_raw})).status_code == 204
    assert (await the_user(session)).email_verified_at is not None


@pytest.mark.parametrize(
    ("language", "subject"),
    [
        ("tg", "Почтаи худро барои TezFarmo тасдиқ кунед"),
        ("ru", "Подтвердите email для TezFarmo"),
        ("en", "Confirm your email for TezFarmo"),
    ],
)
async def test_resend_uses_the_accounts_language(
    client: AsyncClient, outbox: list[OutgoingEmail], language: str, subject: str
) -> None:
    await register(client, outbox, language=language)
    await cooldown_passes()

    await client.post(RESEND, json={"email": EMAIL})

    message = outbox[-1]
    assert message.template == "verification"
    assert message.subject == subject
    assert "http://localhost:5174/verify-email?token=" in message.text


async def test_email_is_trimmed_and_lowercased(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await register(client, outbox)
    await cooldown_passes()

    response = await client.post(RESEND, json={"email": "  NIGINA@Example.TJ  "})

    assert visible(response) == (202, b"")
    assert len(outbox) == 2 and outbox[-1].to == EMAIL
    assert len(await tokens(session)) == 2


async def test_unknown_and_verified_addresses_get_the_same_answer_and_nothing_else(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    raw = await register(client, outbox)
    await cooldown_passes()
    unverified = await client.post(RESEND, json={"email": EMAIL})
    await cooldown_passes()
    assert (await client.post(VERIFY, json={"token": link_token(outbox[-1])})).status_code == 204
    verified_at = (await the_user(session)).email_verified_at
    sent, token_count = len(outbox), len(await tokens(session))
    audit_count = await session.scalar(select(func.count()).select_from(AuditLog))

    verified = await client.post(RESEND, json={"email": EMAIL})
    unknown = await client.post(RESEND, json={"email": "nobody@example.tj"})

    # Indistinguishable from outside: same status, same empty body.
    assert visible(unknown) == visible(verified) == visible(unverified) == (202, b"")
    for response in (unknown, verified):
        assert EMAIL not in response.text and "nobody" not in response.text
    # Nothing happens for them: no email, no token, no user, no audit, verification state unchanged.
    assert len(outbox) == sent
    assert len(await tokens(session)) == token_count
    assert await session.scalar(select(func.count()).select_from(User)) == 1
    assert await session.scalar(select(func.count()).select_from(AuditLog)) == audit_count
    assert (await the_user(session)).email_verified_at == verified_at
    assert raw  # the first link was issued (and superseded) as usual


async def test_cooldown_blocks_an_immediate_second_email(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    await register(client, outbox)

    # Registration just sent a link, so the cooldown is already running.
    right_after_register = await client.post(RESEND, json={"email": EMAIL})
    assert right_after_register.status_code == 429
    await cooldown_passes()
    first = await client.post(RESEND, json={"email": EMAIL})
    second = await client.post(RESEND, json={"email": EMAIL})
    by_case = await client.post(RESEND, json={"email": "  Nigina@EXAMPLE.tj "})

    assert first.status_code == 202
    for blocked in (right_after_register, second, by_case):
        assert blocked.status_code == 429
        error = blocked.json()["error"]
        assert error["code"] == "email_resend_too_early"
        assert 0 < int(blocked.headers["Retry-After"]) <= 61
        assert error["details"]["retry_after"] == int(blocked.headers["Retry-After"])
    # Only the registration email and the one allowed resend went out.
    assert len(outbox) == 2


async def test_cooldown_applies_to_unknown_addresses_too(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    """Otherwise a quick second request would reveal which addresses have unverified accounts."""
    first = await client.post(RESEND, json={"email": "nobody@example.tj"})
    second = await client.post(RESEND, json={"email": "nobody@example.tj"})

    assert first.status_code == 202
    assert second.status_code == 429 and second.json()["error"]["code"] == "email_resend_too_early"
    assert outbox == []


async def test_hourly_auth_email_send_limit_counts_registration_and_resends(
    client: AsyncClient, outbox: list[OutgoingEmail]
) -> None:
    await register(client, outbox)  # 1 of 5
    for _ in range(4):  # 2..5 of 5
        await cooldown_passes()
        assert (await client.post(RESEND, json={"email": EMAIL})).status_code == 202
    await cooldown_passes()

    blocked = await client.post(RESEND, json={"email": EMAIL})

    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "rate_limited"
    assert int(blocked.headers["Retry-After"]) > 0
    assert len(outbox) == 5


class _FailingEmail:
    async def send(self, email: OutgoingEmail) -> None:
        raise EmailDeliveryError(email.template)


async def test_delivery_failure_answers_503_and_keeps_the_previous_link_valid(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    old_raw = await register(client, outbox)
    await cooldown_passes()
    set_email_provider(_FailingEmail())
    try:
        response = await client.post(RESEND, json={"email": EMAIL})
    finally:
        set_email_provider(None)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"
    assert "smtp" not in response.text.lower()
    # Rolled back: no new token, and the earlier link was not expired by the failed attempt.
    [only] = await tokens(session)
    assert only.token_hash == hash_token(old_raw) and only.expires_at > utcnow()
    assert (await client.post(VERIFY, json={"token": old_raw})).status_code == 204


async def test_raw_token_and_address_stay_out_of_logs_and_audit(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail], caplog: pytest.LogCaptureFixture
) -> None:
    await register(client, outbox)
    await cooldown_passes()
    audit_before = await session.scalar(select(func.count()).select_from(AuditLog))

    with caplog.at_level(logging.DEBUG):
        response = await client.post(RESEND, json={"email": EMAIL})

    raw = link_token(outbox[-1])
    assert "email recorded (not sent): verification" in caplog.text  # the capture sees the email logger
    assert raw not in caplog.text and EMAIL not in caplog.text
    assert raw not in response.text
    # TZ defines no audit event for resend; none is written.
    assert await session.scalar(select(func.count()).select_from(AuditLog)) == audit_before
    for entry in (await session.scalars(select(AuditLog))).all():
        assert raw not in str(entry.old_data) + str(entry.new_data)


@pytest.mark.parametrize(
    ("payload", "field", "code"),
    [
        ({}, "email", "missing"),
        ({"email": ""}, "email", "value_error"),
        ({"email": "   "}, "email", "value_error"),
        ({"email": "not-an-email"}, "email", "value_error"),
        ({"email": EMAIL, "token": "abc"}, "token", "extra_forbidden"),
        ({"email": EMAIL, "password": "Dushanbe2026x"}, "password", "extra_forbidden"),
        ({"email": EMAIL, "phone": "+992900000000"}, "phone", "extra_forbidden"),
        ({"email": EMAIL, "user_id": "00000000-0000-0000-0000-000000000000"}, "user_id", "extra_forbidden"),
    ],
)
async def test_malformed_requests_are_validation_errors_without_side_effects(
    client: AsyncClient,
    session: AsyncSession,
    outbox: list[OutgoingEmail],
    payload: dict[str, object],
    field: str,
    code: str,
) -> None:
    response = await client.post(RESEND, json=payload)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert {"field": field, "code": code} in [
        {"field": f["field"], "code": f["code"]} for f in error["details"]["fields"]
    ]
    assert outbox == [] and await tokens(session) == []
