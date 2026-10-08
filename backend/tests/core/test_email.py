from __future__ import annotations

import asyncio
import logging
import smtplib
from typing import Any

import pytest

from app.core import email as email_module
from app.core.config import Settings
from app.core.email import (
    EmailDeliveryError,
    MemoryEmailProvider,
    OutgoingEmail,
    SmtpEmailProvider,
    get_email,
    mask_email,
    set_email_provider,
)
from app.core.email_templates import render

SECRET_LINK = "https://app.tezfarmo.tj/login?token=SECRET-ONE-TIME-VALUE"
CODE = "482913"


async def test_iam_016_direct_delivery_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    class SlowProvider:
        async def send(self, email: OutgoingEmail) -> None:
            await asyncio.Event().wait()

    timeout = asyncio.timeout
    requested: list[float] = []

    def short_timeout(seconds: float) -> asyncio.Timeout:
        requested.append(seconds)
        return timeout(0.001)

    monkeypatch.setattr(email_module.asyncio, "timeout", short_timeout)
    set_email_provider(SlowProvider())
    try:
        with pytest.raises(EmailDeliveryError):
            await email_module.send_email(OutgoingEmail("a@example.tj", "Subject", "Text", "<p>Text</p>", "test"))
        assert requested == [5]
    finally:
        set_email_provider(None)


@pytest.mark.parametrize(
    ("language", "subject", "expiry"),
    [
        ("en", "Your TezFarmo verification code", "expires in 15 minutes"),
        ("ru", "Ваш код подтверждения TezFarmo", "через 15 мин"),
        ("tg", "Рамзи тасдиқи TezFarmo-и шумо", "баъди 15 дақиқа"),
    ],
)
def test_verification_email_carries_only_a_code(language: str, subject: str, expiry: str) -> None:
    message = render("verification", language, to="nigina@example.tj", name="Nigina", code=CODE, minutes=15)

    assert message.subject == subject and message.template == "verification"
    assert "Nigina" in message.text and CODE in message.text and CODE in message.html
    assert expiry in message.text
    # No link to click: no URL, no anchor, no button.
    for part in (message.text, message.html):
        assert "http" not in part and "href" not in part and "token" not in part
    assert "<a " not in message.html


def test_verification_email_needs_a_code() -> None:
    with pytest.raises(ValueError, match="needs a code"):
        render("verification", "en", to="a@example.tj", name="A", action_url=SECRET_LINK, minutes=15)


def test_password_reset_email_carries_only_a_code_and_mentions_sign_out() -> None:
    message = render("password_reset", "en", to="a@example.tj", name="Ali", code=CODE, minutes=30)
    assert message.subject == "Your TezFarmo password reset code"
    assert CODE in message.text and CODE in message.html
    assert "expires in 30 minutes" in message.text and "signed out of all devices" in message.text
    for part in (message.text, message.html):
        assert "http" not in part and "href" not in part
    with pytest.raises(ValueError, match="needs a code"):
        render("password_reset", "en", to="a@example.tj", name="Ali", action_url=SECRET_LINK, minutes=30)


def test_email_templates_escape_user_controlled_values() -> None:
    message = render(
        "account_exists",
        "en",
        to="a@example.tj",
        name="<script>alert(1)</script>",
        action_url='https://x.tj/?a="b"',
        minutes=5,
    )
    assert "<script>" not in message.html and "&lt;script&gt;" in message.html
    assert 'href="https://x.tj/?a=&quot;b&quot;"' in message.html
    code_message = render("verification", "en", to="a@example.tj", name="<b>x</b>", code=CODE, minutes=5)
    assert "<b>x</b>" not in code_message.html and "&lt;b&gt;x&lt;/b&gt;" in code_message.html


def test_unknown_language_falls_back_to_tajik() -> None:
    message = render("verification", "de", to="a@example.tj", name="A", code=CODE, minutes=5)
    assert message.subject == "Рамзи тасдиқи TezFarmo-и шумо"


def test_mask_email_keeps_only_first_character_and_domain() -> None:
    assert mask_email("nigina@example.tj") == "n***@example.tj"
    assert mask_email("broken") == "***"


class FakeSmtp:
    instances: list[FakeSmtp] = []

    def __init__(self, host: str, port: int, timeout: int, **_: Any) -> None:
        self.host, self.port, self.timeout = host, port, timeout
        self.calls: list[str] = []
        self.login_args: tuple[str, str] | None = None
        self.sent: list[Any] = []
        FakeSmtp.instances.append(self)

    def __enter__(self) -> FakeSmtp:
        return self

    def __exit__(self, *_: object) -> None:
        self.calls.append("quit")

    def starttls(self, context: Any) -> None:
        self.calls.append("starttls")

    def login(self, username: str, password: str) -> None:
        self.calls.append("login")
        self.login_args = (username, password)

    def send_message(self, message: Any) -> None:
        self.calls.append("send")
        self.sent.append(message)


def _smtp_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "email_provider": "smtp",
        "smtp_host": "smtp.gmail.com",
        "smtp_port": 587,
        "smtp_username": "noreply@tezfarmo.tj",
        "smtp_password": "app-password-value",
        "from_email": "noreply@tezfarmo.tj",
    }
    values.update(overrides)
    return Settings(**values, _env_file=None)


def _message() -> OutgoingEmail:
    return render("password_reset", "en", to="ali@example.tj", name="Ali", code=CODE, minutes=30)


async def test_smtp_provider_uses_starttls_login_and_multipart_message(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeSmtp.instances.clear()
    monkeypatch.setattr(smtplib, "SMTP", FakeSmtp)
    await SmtpEmailProvider(_smtp_settings()).send(_message())
    smtp = FakeSmtp.instances[0]
    assert (smtp.host, smtp.port) == ("smtp.gmail.com", 587)
    assert smtp.calls == ["starttls", "login", "send", "quit"]
    assert smtp.login_args == ("noreply@tezfarmo.tj", "app-password-value")
    sent = smtp.sent[0]
    assert sent["To"] == "ali@example.tj" and "noreply@tezfarmo.tj" in sent["From"]
    assert sent["Subject"] == "Your TezFarmo password reset code"
    assert [part.get_content_type() for part in sent.iter_parts()] == ["text/plain", "text/html"]


async def test_smtp_failure_raises_delivery_error_without_leaking(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    class FailingSmtp(FakeSmtp):
        def login(self, username: str, password: str) -> None:
            raise smtplib.SMTPAuthenticationError(535, f"bad credentials for {password}".encode())

    monkeypatch.setattr(smtplib, "SMTP", FailingSmtp)
    caplog.set_level(logging.INFO, logger="tezfarmo.email")
    with pytest.raises(EmailDeliveryError):
        await SmtpEmailProvider(_smtp_settings()).send(_message())
    logged = caplog.text
    assert "app-password-value" not in logged and CODE not in logged
    assert "a***@example.tj" in logged and "SMTPAuthenticationError" in logged


async def test_memory_provider_records_but_never_logs_content(caplog: pytest.LogCaptureFixture) -> None:
    provider = MemoryEmailProvider()
    caplog.set_level(logging.INFO, logger="tezfarmo.email")
    await provider.send(_message())
    assert provider.outbox[0].to == "ali@example.tj"
    assert CODE not in caplog.text and "ali@example.tj" not in caplog.text


def test_provider_is_replaceable() -> None:
    replacement = MemoryEmailProvider()
    set_email_provider(replacement)
    try:
        assert get_email() is replacement
    finally:
        set_email_provider(None)
    assert isinstance(email_module._configured(), MemoryEmailProvider)  # testing settings use the memory provider


def test_testing_never_delivers_real_mail_even_with_smtp_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    # backend/.env may say EMAIL_PROVIDER=smtp (e.g. Gmail); the test suite reads it too and must stay offline.
    monkeypatch.setattr(
        email_module, "get_settings", lambda: _smtp_settings().model_copy(update={"app_env": "testing"})
    )
    email_module._configured.cache_clear()
    try:
        assert isinstance(email_module._configured(), MemoryEmailProvider)
        monkeypatch.setattr(
            email_module, "get_settings", lambda: _smtp_settings().model_copy(update={"app_env": "development"})
        )
        email_module._configured.cache_clear()
        assert isinstance(email_module._configured(), email_module.SmtpEmailProvider)
    finally:
        email_module._configured.cache_clear()


def test_smtp_password_is_never_rendered() -> None:
    settings = _smtp_settings()
    assert "app-password-value" not in repr(settings) and "app-password-value" not in str(settings.model_dump())


def test_production_requires_smtp_delivery() -> None:
    strong = "s" * 40
    with pytest.raises(ValueError, match="EMAIL_PROVIDER=smtp"):
        Settings(
            _env_file=None,
            app_env="production",
            app_secret_key=strong,
            jwt_access_secret=strong,
            jwt_refresh_secret=strong,
            delivery_code_hmac_secret=strong,
            delivery_code_encryption_key=strong,
        )
    Settings(
        _env_file=None,
        app_env="production",
        app_secret_key=strong,
        jwt_access_secret=strong,
        jwt_refresh_secret=strong,
        delivery_code_hmac_secret=strong,
        delivery_code_encryption_key=strong,
        email_provider="smtp",
        smtp_host="smtp.gmail.com",
        from_email="a@b.tj",
    )
