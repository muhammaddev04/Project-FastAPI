"""P01 registration: IAM-001 (no enumeration), IAM-003 (password policy), P01 §2.2 tokens, IAM-016 delivery."""

from __future__ import annotations

import logging
import re
from collections.abc import Iterator
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.email import EmailDeliveryError, MemoryEmailProvider, OutgoingEmail, set_email_provider
from app.core.security import verify_password
from app.core.time import utcnow
from app.modules.auth.models import EmailToken
from app.modules.auth.password_policy import common_passwords
from app.modules.auth.tokens import hash_token
from app.modules.identity.models import User

URL = "/api/v1/auth/register"
PASSWORD = "Dushanbe2026x"
TOKEN_IN_LINK = re.compile(r"/verify-email\?token=([A-Za-z0-9_-]+)")


def body(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "email": "nigina@example.tj",
        "password": PASSWORD,
        "full_name": "Nigina Karimova",
        "language": "en",
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def outbox() -> Iterator[list[OutgoingEmail]]:
    provider = MemoryEmailProvider()
    set_email_provider(provider)
    yield provider.outbox
    set_email_provider(None)


async def users(session: AsyncSession) -> list[User]:
    return list((await session.scalars(select(User))).all())


async def tokens(session: AsyncSession) -> list[EmailToken]:
    return list((await session.scalars(select(EmailToken))).all())


def link_token(message: OutgoingEmail) -> str:
    match = TOKEN_IN_LINK.search(message.text)
    assert match, "the verification email carries a /verify-email?token=… link"
    return match.group(1)


async def test_iam_001_register_creates_unverified_user_and_answers_202(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    response = await client.post(URL, json=body())

    assert response.status_code == 202
    assert response.content == b""
    [user] = await users(session)
    assert user.email == "nigina@example.tj"
    assert user.full_name == "Nigina Karimova"
    assert user.language == "en"
    assert user.status == "ACTIVE"
    assert user.email_verified_at is None
    assert user.phone is None and user.phone_verified_at is None
    assert user.is_superadmin is False
    # Argon2id hash of the submitted password; the plaintext is never stored.
    assert user.password_hash.startswith("$argon2id$")
    assert verify_password(PASSWORD, user.password_hash)
    # Registration never creates an organization (ORG-001 runs later from /welcome).
    assert (await session.scalar(select(func.count()).select_from(User))) == 1


async def test_email_is_trimmed_and_lowercased(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    response = await client.post(URL, json=body(email="  Nigina.Karimova@Example.TJ "))

    assert response.status_code == 202
    [user] = await users(session)
    assert user.email == "nigina.karimova@example.tj"
    assert [message.to for message in outbox] == ["nigina.karimova@example.tj"]


@pytest.mark.parametrize("second_email", ["nigina@example.tj", "NIGINA@Example.tj"])
async def test_iam_001_known_email_gets_the_same_answer_and_no_second_account(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail], second_email: str
) -> None:
    first = await client.post(URL, json=body())
    second = await client.post(URL, json=body(email=second_email, password="Another2026pass", full_name="Someone Else"))

    # Same status and body: the response does not reveal that the address is taken.
    assert (second.status_code, second.content) == (first.status_code, first.content) == (202, b"")
    [user] = await users(session)
    assert user.full_name == "Nigina Karimova"
    assert verify_password(PASSWORD, user.password_hash)
    assert len(await tokens(session)) == 1
    # The owner of the address is told instead (IAM-001), in their own language, with no secret link.
    assert [message.template for message in outbox] == ["verification", "account_exists"]
    notice = outbox[1]
    assert notice.to == "nigina@example.tj"
    assert "token=" not in notice.text
    assert "/login" in notice.text


async def test_verification_token_is_stored_hashed_for_24_hours(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    before = utcnow()
    await client.post(URL, json=body())

    [user] = await users(session)
    [token] = await tokens(session)
    raw = link_token(outbox[0])
    assert len(raw) >= 43  # 256 random bits
    assert token.user_id == user.id
    assert token.purpose == "VERIFY_EMAIL"
    assert token.consumed_at is None
    assert token.token_hash == hash_token(raw)
    assert raw not in token.token_hash
    lifetime = token.expires_at - before
    assert timedelta(hours=24) - timedelta(minutes=1) <= lifetime <= timedelta(hours=24) + timedelta(minutes=1)


@pytest.mark.parametrize(
    ("language", "subject"), [("tg", "TezFarmo"), ("ru", "TezFarmo"), ("en", "Confirm your email")]
)
async def test_iam_016_verification_email_is_sent_through_the_email_port(
    client: AsyncClient, outbox: list[OutgoingEmail], language: str, subject: str
) -> None:
    await client.post(URL, json=body(language=language))

    [message] = outbox
    assert message.template == "verification"
    assert message.to == "nigina@example.tj"
    assert subject in message.subject
    assert "Nigina Karimova" in message.text
    assert "http://localhost:5174/verify-email?token=" in message.text
    if language == "en":
        assert "expires in 24 hours" in message.text


@pytest.mark.parametrize(
    ("password", "codes"),
    [
        ("short1", ["password_too_short"]),
        ("onlyletters", ["password_needs_letter_and_digit"]),
        ("12345678", ["password_needs_letter_and_digit", "password_too_common"]),
        ("x" * 129 + "1", ["password_too_long"]),
    ],
)
async def test_iam_003_weak_password_rejected(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail], password: str, codes: list[str]
) -> None:
    response = await client.post(URL, json=body(password=password))

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "weak_password"
    assert [field["code"] for field in error["details"]["fields"]] == codes
    assert all(field["field"] == "password" for field in error["details"]["fields"])
    assert await users(session) == [] and outbox == []


async def test_iam_003_common_password_rejected(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    common = "password1"
    assert common in common_passwords()
    response = await client.post(URL, json=body(password=common))

    assert response.status_code == 422
    assert [f["code"] for f in response.json()["error"]["details"]["fields"]] == ["password_too_common"]
    assert await users(session) == [] and outbox == []


@pytest.mark.parametrize(
    ("overrides", "field", "code"),
    [
        ({"email": "not-an-email"}, "email", "value_error"),
        ({"email": ""}, "email", "value_error"),
        ({"full_name": "A"}, "full_name", "string_too_short"),
        ({"full_name": "   "}, "full_name", "value_error"),
        ({"language": "de"}, "language", "literal_error"),
        ({"phone": "+992900000000"}, "phone", "extra_forbidden"),
    ],
)
async def test_invalid_input_is_rejected_without_side_effects(
    client: AsyncClient,
    session: AsyncSession,
    outbox: list[OutgoingEmail],
    overrides: dict[str, object],
    field: str,
    code: str,
) -> None:
    response = await client.post(URL, json=body(**overrides))

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert {"field": field, "code": code} in [
        {"field": f["field"], "code": f["code"]} for f in error["details"]["fields"]
    ]
    assert await users(session) == [] and outbox == []


@pytest.mark.parametrize("missing", ["email", "password", "full_name", "language"])
async def test_contract_fields_are_required(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail], missing: str
) -> None:
    payload = body()
    del payload[missing]
    response = await client.post(URL, json=payload)

    assert response.status_code == 422
    assert {"field": missing, "code": "missing"} in [
        {"field": f["field"], "code": f["code"]} for f in response.json()["error"]["details"]["fields"]
    ]
    assert await users(session) == []


async def test_rate_limit_auth_email_send_5_per_hour_per_email(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    statuses = [(await client.post(URL, json=body())).status_code for _ in range(5)]
    blocked = await client.post(URL, json=body(email="NIGINA@example.tj"))

    assert statuses == [202] * 5
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "rate_limited"
    assert int(blocked.headers["Retry-After"]) > 0
    assert len(outbox) == 5
    # Another address is not affected.
    assert (await client.post(URL, json=body(email="other@example.tj"))).status_code == 202


async def test_secrets_never_reach_response_logs_or_audit(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail], caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        response = await client.post(URL, json=body())

    raw = link_token(outbox[0])
    logs = caplog.text
    assert "email recorded (not sent): verification" in logs  # proves the capture sees the email logger
    assert PASSWORD not in logs and raw not in logs and "nigina@example.tj" not in logs
    assert PASSWORD not in response.text and raw not in response.text

    [entry] = (await session.scalars(select(AuditLog).where(AuditLog.action == "user.registered"))).all()
    [user] = await users(session)
    assert entry.entity_id == user.id and entry.actor_id == user.id
    assert entry.new_data == {"language": "en", "email_verified": False}
    stored = str(entry.old_data) + str(entry.new_data)
    assert PASSWORD not in stored and raw not in stored and user.password_hash not in stored


class _FailingEmail:
    async def send(self, email: OutgoingEmail) -> None:
        raise EmailDeliveryError(email.template)


async def test_iam_016_delivery_failure_answers_503_and_creates_nothing(
    client: AsyncClient, session: AsyncSession
) -> None:
    set_email_provider(_FailingEmail())
    try:
        response = await client.post(URL, json=body())
    finally:
        set_email_provider(None)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"
    assert await users(session) == []
    assert await tokens(session) == []
    assert (await session.scalar(select(func.count()).select_from(AuditLog))) == 0
