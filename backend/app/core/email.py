"""Email delivery layer (CR-001). Business code depends only on `EmailPort`; providers are swappable.

- `SmtpEmailProvider`: real delivery over SMTP (STARTTLS on 587, implicit TLS on 465), e.g. Gmail.
- `MemoryEmailProvider`: development/testing; keeps messages in memory and logs only a masked recipient and
  the template name, never the content (which may hold one-time secrets).
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from functools import lru_cache
from typing import Protocol

from app.core.config import Settings, get_settings

logger = logging.getLogger("tezfarmo.email")


class EmailDeliveryError(Exception):
    """Delivery failed; callers answer 503 service_unavailable (same contract as IAM-016 had for SMS)."""


@dataclass(frozen=True)
class OutgoingEmail:
    to: str
    subject: str
    text: str
    html: str
    #: Template identifier for logs and metrics (never the content).
    template: str


class EmailPort(Protocol):
    async def send(self, email: OutgoingEmail) -> None: ...


def mask_email(address: str) -> str:
    """SEC-011 for email: keep the first character and the domain."""
    local, _, domain = address.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


def build_message(email: OutgoingEmail, sender: str, sender_name: str = "TezFarmo") -> EmailMessage:
    message = EmailMessage()
    message["From"] = formataddr((sender_name, sender))
    message["To"] = email.to
    message["Subject"] = email.subject
    message["Message-ID"] = make_msgid(domain=sender.partition("@")[2] or None)
    message.set_content(email.text)
    message.add_alternative(email.html, subtype="html")
    return message


class SmtpEmailProvider:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def _deliver(self, message: EmailMessage) -> None:
        settings = self._settings
        context = ssl.create_default_context()
        timeout = settings.smtp_timeout_seconds
        if settings.smtp_port == 465:
            smtp: smtplib.SMTP = smtplib.SMTP_SSL(
                settings.smtp_host, settings.smtp_port, timeout=timeout, context=context
            )
        else:
            smtp = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=timeout)
        with smtp:
            if settings.smtp_port != 465 and settings.smtp_starttls:
                smtp.starttls(context=context)
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password.get_secret_value())
            smtp.send_message(message)

    async def send(self, email: OutgoingEmail) -> None:
        message = build_message(email, self._settings.from_email)
        try:
            await asyncio.to_thread(self._deliver, message)
        except (smtplib.SMTPException, OSError) as exc:
            # Log the failure class only: SMTP errors can echo credentials or message content.
            logger.error(
                "email delivery failed: %s to %s (%s)", email.template, mask_email(email.to), type(exc).__name__
            )
            raise EmailDeliveryError(email.template) from exc
        logger.info("email sent: %s to %s", email.template, mask_email(email.to))


class MemoryEmailProvider:
    def __init__(self) -> None:
        self.outbox: list[OutgoingEmail] = []

    async def send(self, email: OutgoingEmail) -> None:
        self.outbox.append(email)
        logger.info("email recorded (not sent): %s to %s", email.template, mask_email(email.to))


_override: EmailPort | None = None


@lru_cache(maxsize=1)
def _configured() -> EmailPort:
    settings = get_settings()
    return SmtpEmailProvider(settings) if settings.email_provider == "smtp" else MemoryEmailProvider()


def get_email() -> EmailPort:
    return _override or _configured()


def set_email_provider(provider: EmailPort | None) -> None:
    """Tests (and future providers) swap the implementation without touching business code."""
    global _override
    _override = provider
