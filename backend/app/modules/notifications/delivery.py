"""NTF-001/004/007: external IO only in a separate worker transaction."""

from datetime import timedelta
from typing import Protocol

from aiogram import Bot
from aiogram.exceptions import TelegramForbiddenError, TelegramNetworkError, TelegramRetryAfter, TelegramServerError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.core.events import DomainEvent
from app.core.outbox import OutboxEvent
from app.core.time import utcnow
from app.modules.delivery import codes
from app.modules.delivery.models import Delivery
from app.modules.identity.models import User
from app.modules.notifications.models import Notification, NotificationDelivery, NotificationPreference, TelegramAccount
from app.modules.notifications.policy import POLICIES, channel_enabled
from app.modules.notifications.recipients import identifier, resolve
from app.modules.notifications.templates import local, text


class Sender(Protocol):
    async def send(self, chat_id: int, message: str) -> str: ...


class TelegramSender:
    async def send(self, chat_id: int, message: str) -> str:
        async with Bot(token=get_settings().telegram_bot_token.get_secret_value()) as bot:
            sent = await bot.send_message(chat_id=chat_id, text=message, request_timeout=5)
            return str(sent.message_id)


async def send_one(session: AsyncSession, row: NotificationDelivery, sender: Sender) -> None:
    notification = await session.get(Notification, row.notification_id)
    assert notification is not None
    outbox = await session.get(OutboxEvent, notification.event_id)
    assert outbox is not None
    event = DomainEvent(outbox.event_type, outbox.payload, outbox.org_id, outbox.id)
    user = await session.get(User, notification.user_id)
    account = await session.get(TelegramAccount, notification.user_id)
    preference = await session.get(
        NotificationPreference, (notification.user_id, POLICIES[event.event_type].group, "TELEGRAM")
    )
    # Re-check access immediately before sending, especially for a delivery code.
    recipients = await resolve(session, event)
    if (
        row.channel != "TELEGRAM"
        or not get_settings().telegram_configured
        or user is None
        or account is None
        or account.is_blocked_by_user
        or user.status != "ACTIVE"
        or not any(recipient.user_id == user.id for recipient in recipients)
        or not channel_enabled(POLICIES[event.event_type], "TELEGRAM", preference.enabled if preference else None)
    ):
        row.status = "SKIPPED"
        return
    message = text(notification.event_type, notification.params, user.language)
    if event.event_type == "DELIVERY_DISPATCHED":
        delivery_id = identifier(event, "delivery_id")
        delivery = await session.get(Delivery, delivery_id) if delivery_id else None
        if delivery and delivery.status in {"IN_TRANSIT", "ARRIVED"}:
            code = codes.decrypt(delivery.id, delivery.code_encrypted)
            label = local(("Коди расониш", "Код доставки", "Delivery code"), user.language)
            message += f"\n{label}: {code}"
    if notification.link:
        message += "\n" + get_settings().frontend_base_url.rstrip("/") + notification.link
    row.attempts += 1
    try:
        row.provider_message_id = await sender.send(account.chat_id, message)
    except TelegramForbiddenError:
        account.is_blocked_by_user = True
        row.last_error = "TelegramForbiddenError"
        row.status = "SKIPPED"
    except Exception as exc:
        # Never persist or log exception text: a provider exception may contain the code or bot token.
        row.last_error = type(exc).__name__
        retryable = isinstance(exc, TelegramNetworkError | TelegramServerError | TelegramRetryAfter | TimeoutError)
        row.status = "PENDING" if retryable and row.attempts < 3 else "FAILED"
        delay = (30, 120, 600)[row.attempts - 1]
        row.next_attempt_at = utcnow() + timedelta(seconds=delay)
    else:
        row.status = "SENT"
        row.sent_at = utcnow()
        row.last_error = None


async def send_pending(sender: Sender | None = None, *, limit: int = 100) -> int:
    count = 0
    for _ in range(limit):
        async with get_sessionmaker()() as session, session.begin():
            row = await session.scalar(
                select(NotificationDelivery)
                .where(NotificationDelivery.status == "PENDING", NotificationDelivery.next_attempt_at <= utcnow())
                .order_by(NotificationDelivery.next_attempt_at, NotificationDelivery.id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if row is None:
                break
            await send_one(session, row, sender or TelegramSender())
            count += 1
    return count
