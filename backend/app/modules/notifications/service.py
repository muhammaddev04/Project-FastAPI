from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import DomainEvent
from app.core.outbox import consumers
from app.core.time import new_id, utcnow
from app.modules.identity.models import Organization
from app.modules.notifications.models import Notification, NotificationDelivery, NotificationPreference
from app.modules.notifications.policy import POLICIES, channel_enabled
from app.modules.notifications.recipients import resolve

# Strict allowlist: do not copy an outbox payload, import errors, notes or contact data.
SAFE_PARAMS = frozenset({"order_number", "status", "total", "amount", "due_date", "partial"})


def safe_params(event: DomainEvent) -> dict[str, Any]:
    params = {
        key: value
        for key, value in event.payload.items()
        if key in SAFE_PARAMS and (value is None or isinstance(value, str | int | bool))
    }
    if event.event_type == "SUBSCRIPTION_STATUS_CHANGED" and isinstance(event.payload.get("to_status"), str):
        params["status"] = event.payload["to_status"]
    return params


async def consume(session: AsyncSession, event: DomainEvent) -> None:
    policy = POLICIES[event.event_type]
    for recipient in await resolve(session, event):
        org = await session.get(Organization, recipient.organization_id) if recipient.organization_id else None
        area = "company" if org and org.type == "COMPANY" else "store"
        link = "/notifications"
        if event.event_type == "DELIVERY_ASSIGNED":
            link = "/courier"
        if event.payload.get("order_id") and event.event_type != "DELIVERY_ASSIGNED":
            try:
                order_id = UUID(str(event.payload["order_id"]))
                link = f"/{area}/orders/{order_id}"
            except ValueError:
                pass
        notification_id = await session.scalar(
            insert(Notification)
            .values(
                id=new_id(),
                user_id=recipient.user_id,
                organization_id=recipient.organization_id,
                event_id=event.event_id,
                event_type=event.event_type,
                title_key=f"notifications.events.{event.event_type}",
                body_key="notifications.eventBody",
                params=safe_params(event),
                link=link,
                created_at=utcnow(),
            )
            .on_conflict_do_nothing(index_elements=["event_id", "user_id"])
            .returning(Notification.id)
        )
        if notification_id is None:
            continue
        preference = await session.scalar(
            select(NotificationPreference.enabled).where(
                NotificationPreference.user_id == recipient.user_id,
                NotificationPreference.event_group == policy.group,
                NotificationPreference.channel == "TELEGRAM",
            )
        )
        if channel_enabled(policy, "TELEGRAM", preference):
            session.add(NotificationDelivery(notification_id=notification_id, channel="TELEGRAM"))
    await session.flush()


def install() -> None:
    for event_type in POLICIES:
        consumers.subscribe(event_type, consume)
