from __future__ import annotations

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

SECRET_LINK = "https://app.tezfarmo.tj/verify-email?token=SECRET-ONE-TIME-VALUE"


@pytest.mark.parametrize(
    ("language", "subject"),
    [
        ("en", "Confirm your email for TezFarmo"),
        ("ru", "Подтвердите email для TezFarmo"),
        ("tg", "Почтаи худро барои TezFarmo тасдиқ кунед"),
    ],
)
def test_verification_email_is_localized(language: str, subject: str) -> None:
    message = render(
        "verification", language, to="nigina@example.tj", name="Nigina", action_url=SECRET_LINK, minutes=24 * 60
    )
    assert message.subject == subject
    # P01 §2.2: the verification link lives 24 hours, stated in hours in every language.
    assert "Nigina" in message.text and "24" in message.text
    assert SECRET_LINK in message.text
    assert f'href="{SECRET_LINK}"' in message.html
    assert message.template == "verification"


def test_password_reset_email_mentions_single_use_and_sign_out() -> None:
    message = render("password_reset", "en", to="a@example.tj", name="Ali", action_url=SECRET_LINK, minutes=15)
    assert message.subject == "Reset your TezFarmo password"
    assert "expires in 15 minutes" in message.text and "signed out of all devices" in message.text


def test_email_templates_escape_user_controlled_values() -> None:
    message = render(
        "verification",
        "en",
        to="a@example.tj",
        name="<script>alert(1)</script>",
        action_url='https://x.tj/?a="b"',
        minutes=5,
    )
    assert "<script>" not in message.html and "&lt;script&gt;" in message.html
    assert 'href="https://x.tj/?a=&quot;b&quot;"' in message.html


def test_unknown_language_falls_back_to_tajik() -> None:
    message = render("verification", "de", to="a@example.tj", name="A", action_url=SECRET_LINK, minutes=5)
    assert message.subject == "Почтаи худро барои TezFarmo тасдиқ кунед"


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
    return Settings(**values)


def _message() -> OutgoingEmail:
    return render("password_reset", "en", to="ali@example.tj", name="Ali", action_url=SECRET_LINK, minutes=15)


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
    assert sent["Subject"] == "Reset your TezFarmo password"
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
    assert "app-password-value" not in logged and "SECRET-ONE-TIME-VALUE" not in logged
    assert "a***@example.tj" in logged and "SMTPAuthenticationError" in logged


async def test_memory_provider_records_but_never_logs_content(caplog: pytest.LogCaptureFixture) -> None:
    provider = MemoryEmailProvider()
    caplog.set_level(logging.INFO, logger="tezfarmo.email")
    await provider.send(_message())
    assert provider.outbox[0].to == "ali@example.tj"
    assert "SECRET-ONE-TIME-VALUE" not in caplog.text and "ali@example.tj" not in caplog.text


def test_provider_is_replaceable() -> None:
    replacement = MemoryEmailProvider()
    set_email_provider(replacement)
    try:
        assert get_email() is replacement
    finally:
        set_email_provider(None)
    assert isinstance(email_module._configured(), MemoryEmailProvider)  # testing settings use the memory provider


def test_smtp_password_is_never_rendered() -> None:
    settings = _smtp_settings()
    assert "app-password-value" not in repr(settings) and "app-password-value" not in str(settings.model_dump())


def test_production_requires_smtp_delivery() -> None:
    strong = "s" * 40
    with pytest.raises(ValueError, match="EMAIL_PROVIDER=smtp"):
        Settings(app_env="production", app_secret_key=strong, jwt_access_secret=strong, jwt_refresh_secret=strong)
    Settings(
        app_env="production",
        app_secret_key=strong,
        jwt_access_secret=strong,
        jwt_refresh_secret=strong,
        email_provider="smtp",
        smtp_host="smtp.gmail.com",
        from_email="a@b.tj",
    )
