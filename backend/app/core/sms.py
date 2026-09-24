from __future__ import annotations

import logging
from typing import Protocol

from app.core.config import get_settings

logger = logging.getLogger("tezfarmo.sms")


class SmsPort(Protocol):
    async def send(self, phone: str, text: str) -> None: ...


def mask_phone(phone: str) -> str:
    """SEC-011: +992*****1234."""
    return f"{phone[:4]}*****{phone[-4:]}" if len(phone) > 8 else "***"


class ConsoleSmsProvider:
    """IAM-016 default provider for development/testing. Real delivery arrives with P11."""

    def __init__(self) -> None:
        self.outbox: list[tuple[str, str]] = []

    async def send(self, phone: str, text: str) -> None:
        self.outbox.append((phone, text))
        if get_settings().app_env in ("development", "testing"):
            # Development only: the message body contains the code so a developer can complete the flow.
            logger.warning("SMS to %s: %s", mask_phone(phone), text)
        else:
            logger.info("SMS queued to %s", mask_phone(phone))


_provider: SmsPort = ConsoleSmsProvider()


def get_sms() -> SmsPort:
    return _provider


def set_sms_provider(provider: SmsPort) -> None:
    global _provider
    _provider = provider
