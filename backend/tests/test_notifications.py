"""P11 durable pipeline, channel isolation and personal API boundaries on PostgreSQL."""

import pytest
from httpx import AsyncClient
from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.events import DomainEvent, EventBus
from app.core.outbox import OutboxEvent
from app.core.time import utcnow
from app.modules.identity.models import Membership
from app.modules.notifications import delivery, policy, recipients, service, templates
from app.modules.notifications.models import Notification, NotificationDelivery, NotificationPreference, TelegramAccount
from app.modules.partnerships.models import Partnership
from tests.factories import add_member, auth, make_org, make_user


async def scenario(session):
    company_owner = await make_user(session, language="en")
    store_owner = await make_user(session, language="ru")
    company = await make_org(session, company_owner)
    store = await make_org(session, store_owner, "STORE")
    roles = {"C.OWNER": company_owner, "S.OWNER": store_owner}
    for role in ("MANAGER", "OPERATOR", "WAREHOUSE", "COURIER"):
        user = await make_user(session)
        await add_member(session, company, user, role)
        roles[f"C.{role}"] = user
    seller = await make_user(session)
    await add_member(session, store, seller, "SELLER")
    roles["S.SELLER"] = seller
    admin = await make_user(session, is_superadmin=True)
    roles["ADMIN"] = admin
    partner = Partnership(
        company_id=company.id,
        store_id=store.id,
        status="ACTIVE",
        initiated_by_side="COMPANY",
        initiated_by=company_owner.id,
        activated_at=utcnow(),
    )
    session.add(partner)
    await session.flush()
    return company, store, partner, roles


MATRIX = [
    ("VERIFICATION_SUBMITTED", {"ADMIN"}),
    ("VERIFICATION_APPROVED", {"C.OWNER"}),
    ("VERIFICATION_REJECTED", {"C.OWNER"}),
    ("SUBSCRIPTION_EXPIRING", {"C.OWNER"}),
    ("SUBSCRIPTION_STATUS_CHANGED", {"C.OWNER"}),
    ("PLAN_CHANGE_REQUESTED", {"ADMIN"}),
    ("IMPORT_COMPLETED", {"C.OWNER"}),
    ("IMPORT_FAILED", {"C.OWNER"}),
    ("LOW_STOCK", {"C.OWNER", "C.MANAGER", "C.WAREHOUSE"}),
    ("STOCK_RECONCILIATION_MISMATCH", {"ADMIN"}),
    ("FINANCE_RECONCILIATION_MISMATCH", {"ADMIN"}),
    ("PARTNERSHIP_INVITED", {"S.OWNER"}),
    ("PARTNERSHIP_REQUESTED", {"S.OWNER"}),
    *[
        (name, {"C.OWNER", "C.MANAGER", "S.OWNER"})
        for name in ("PARTNERSHIP_ACTIVATED", "PARTNERSHIP_SUSPENDED", "PARTNERSHIP_TERMINATED", "TERMS_CHANGED")
    ],
    ("ORDER_CREATED", {"C.OWNER", "C.MANAGER", "C.OPERATOR"}),
    *[(name, {"S.OWNER"}) for name in ("ORDER_CONFIRMED", "ORDER_REJECTED", "ORDER_CANCELLED")],
    ("ORDER_READY", {"C.OWNER", "C.MANAGER"}),
    ("DELIVERY_ASSIGNED", {"C.COURIER"}),
    ("DELIVERY_DISPATCHED", {"S.OWNER", "S.SELLER"}),
    ("DELIVERY_COMPLETED", {"S.OWNER", "C.MANAGER"}),
    ("DELIVERY_FAILED", {"S.OWNER", "C.MANAGER"}),
    ("DELIVERY_CODE_LOCKED", {"C.OWNER", "C.MANAGER"}),
    ("DELIVERY_MANUAL_CONFIRMED", {"C.OWNER", "C.MANAGER", "S.OWNER"}),
    ("PAYMENT_RECORDED", {"C.OWNER", "C.MANAGER"}),
    *[
        (name, {"S.OWNER"})
        for name in ("PAYMENT_CONFIRMED", "PAYMENT_REJECTED", "ADJUSTMENT_APPROVED", "DEBT_DUE_SOON")
    ],
    ("ADJUSTMENT_PENDING_APPROVAL", {"C.OWNER"}),
    ("DEBT_OVERDUE", {"S.OWNER", "C.MANAGER"}),
    *[
        (name, {"C.OWNER", "C.MANAGER"})
        for name in (
            "RETURN_REQUESTED",
            "RETURN_APPROVED",
            "RETURN_REJECTED",
            "RETURN_CANCELLED",
            "RETURN_COMPLETED",
            "DISPUTE_OPENED",
            "DISPUTE_UNDER_REVIEW",
            "DISPUTE_MESSAGE",
            "DISPUTE_RESOLVED",
            "DISPUTE_REJECTED",
            "DISPUTE_WITHDRAWN",
        )
    ],
    ("RETURN_RECEIVED", {"C.OWNER", "C.MANAGER", "C.WAREHOUSE"}),
    ("DISPUTE_SLA_WARNING", {"C.OWNER", "C.MANAGER"}),
]


@pytest.mark.parametrize("name,expected", MATRIX)
async def test_recipient_matrix(session, name, expected):
    company, store, partner, roles = await scenario(session)
    event = DomainEvent(
        name,
        {
            "company_id": str(company.id),
            "store_id": str(store.id),
            "partnership_id": str(partner.id),
            "created_by": str(roles["C.OWNER"].id),
            "courier_id": str(roles["C.COURIER"].id),
        },
        company.id,
    )
    found = await recipients.resolve(session, event)
    assert {row.user_id for row in found} == {roles[role].id for role in expected}


async def event_notification(session):
    owner = await make_user(session, language="en")
    company = await make_org(session, owner)
    event = DomainEvent("VERIFICATION_APPROVED", {}, company.id)
    await EventBus().publish(session, event)
    await service.consume(session, event)
    row = (await session.scalars(select(Notification).where(Notification.event_id == event.event_id))).one()
    return owner, company, event, row


async def test_ntf_001_no_send_inside_business_tx(session):
    owner = await make_user(session)
    org = await make_org(session, owner)
    await EventBus().publish(session, DomainEvent("VERIFICATION_APPROVED", {}, org.id))
    assert await session.scalar(select(func.count()).select_from(Notification)) == 0
    assert await session.scalar(select(func.count()).select_from(NotificationDelivery)) == 0


async def test_ntf_002_duplicate_event_single_notification(session):
    owner, company, event, row = await event_notification(session)
    await service.consume(session, event)
    assert await session.scalar(select(func.count()).select_from(Notification)) == 1
    assert await session.scalar(select(func.count()).select_from(NotificationDelivery)) == 1


async def test_ntf_003_in_app_always_and_sms_never(session):
    owner = await make_user(session)
    org = await make_org(session, owner)
    session.add(NotificationPreference(user_id=owner.id, event_group="account", channel="TELEGRAM", enabled=False))
    await session.flush()
    event = DomainEvent("VERIFICATION_APPROVED", {}, org.id)
    await EventBus().publish(session, event)
    await service.consume(session, event)
    assert await session.scalar(select(func.count()).select_from(Notification)) == 1
    assert await session.scalar(select(func.count()).select_from(NotificationDelivery)) == 0
    assert not policy.channel_enabled(policy.POLICIES[event.event_type], "SMS", True)


@pytest.mark.parametrize("status", ["SUSPENDED", "REVOKED"])
async def test_ntf_005_revoked_member_not_notified(session, status):
    owner = await make_user(session)
    org = await make_org(session, owner)
    membership = await session.scalar(select(Membership).where(Membership.organization_id == org.id))
    membership.status = status
    await session.flush()
    assert not await recipients.resolve(session, DomainEvent("VERIFICATION_APPROVED", {}, org.id))


def test_ntf_006_language_and_money():
    for name in policy.POLICIES:
        assert templates.title(name, "tg") != templates.title(name, "en")
        assert templates.title(name, "ru") != templates.title(name, "en")
    assert templates.money("1234.50", "en") == "1,234.50 TJS"
    assert templates.money("1234.50", "ru") == "1 234,50 TJS"
    for language in ("tg", "ru", "en"):
        message = templates.text("DEBT_DUE_SOON", {"due_date": "2026-10-09", "amount": "12.34"}, language)
        assert "09.10.2026" in message and "2026-10-09" not in message
        assert templates.money("12.34", language) in message


def test_ntf_007_params_allowlist():
    event = DomainEvent(
        "DELIVERY_DISPATCHED",
        {
            "order_number": "ORD-1",
            "code": "123456",
            "code_encrypted": "secret",
            "email": "private@example.com",
            "note": "private",
            "total": "10.00",
        },
    )
    assert service.safe_params(event) == {"order_number": "ORD-1", "total": "10.00"}
    transition = DomainEvent("SUBSCRIPTION_STATUS_CHANGED", {"to_status": "FULL_BLOCK", "reason": "private"})
    assert service.safe_params(transition) == {"status": "FULL_BLOCK"}


class FakeSender:
    def __init__(self, error=None):
        self.error = error
        self.messages = []

    async def send(self, chat_id, message):
        self.messages.append((chat_id, message))
        if self.error:
            raise self.error
        return "123"


async def test_ntf_004_channel_failure_does_not_affect_business_failed_after_3(session, monkeypatch):
    monkeypatch.setattr(get_settings(), "telegram_bot_token", SecretStr("123:test"))
    monkeypatch.setattr(get_settings(), "telegram_bot_username", "testbot")
    owner, org, event, notification = await event_notification(session)
    session.add(TelegramAccount(user_id=owner.id, telegram_user_id=123, chat_id=123))
    await session.flush()
    row = await session.scalar(
        select(NotificationDelivery).where(NotificationDelivery.notification_id == notification.id)
    )
    sender = FakeSender(TimeoutError("private provider error"))
    for _ in range(3):
        await delivery.send_one(session, row, sender)
    assert row.attempts == 3 and row.status == "FAILED"
    assert row.last_error == "TimeoutError"
    assert await session.get(OutboxEvent, event.event_id) is not None
    assert await session.get(Notification, notification.id) is not None


async def test_send_without_telegram_is_skipped(session):
    owner, org, event, notification = await event_notification(session)
    row = await session.scalar(
        select(NotificationDelivery).where(NotificationDelivery.notification_id == notification.id)
    )
    sender = FakeSender()
    await delivery.send_one(session, row, sender)
    assert row.status == "SKIPPED" and row.attempts == 0 and not sender.messages


async def test_notifications_user_scoped_read_and_filter(client: AsyncClient, session: AsyncSession):
    owner, org, event, notification = await event_notification(session)
    stranger = await make_user(session)
    await session.commit()
    response = await client.get("/api/v1/notifications", headers=auth(stranger))
    assert response.json()["results"] == []
    response = await client.post(f"/api/v1/notifications/{notification.id}/read", headers=auth(stranger))
    assert response.status_code == 404
    assert (await client.get("/api/v1/notifications/unread-count", headers=auth(owner))).json()["count"] == 1
    response = await client.get("/api/v1/notifications?unread=true&limit=10", headers=auth(owner))
    assert response.json()["count"] == 1 and response.json()["results"][0]["id"] == str(notification.id)
    assert (await client.post(f"/api/v1/notifications/{notification.id}/read", headers=auth(owner))).status_code == 200
    assert (await client.get("/api/v1/notifications?unread=true", headers=auth(owner))).json()["count"] == 0
    assert (await client.post("/api/v1/notifications/read-all", headers=auth(owner))).status_code == 204


async def test_preferences_no_sms_and_in_app_locked(client, session):
    owner = await make_user(session)
    await session.commit()
    saved = await client.put(
        "/api/v1/notifications/preferences",
        headers=auth(owner),
        json=[{"event_group": "orders", "channel": "TELEGRAM", "enabled": False}],
    )
    assert saved.status_code == 200
    assert all(row["enabled"] and row["locked"] for row in saved.json() if row["channel"] == "IN_APP")
    assert not next(
        row["enabled"] for row in saved.json() if row["event_group"] == "orders" and row["channel"] == "TELEGRAM"
    )
    for channel in ("IN_APP", "SMS"):
        refused = await client.put(
            "/api/v1/notifications/preferences",
            headers=auth(owner),
            json=[{"event_group": "orders", "channel": channel, "enabled": False}],
        )
        assert refused.status_code == 422


async def test_subscription_block_notifies_manager(session):
    company, store, partner, roles = await scenario(session)
    found = await recipients.resolve(
        session, DomainEvent("SUBSCRIPTION_STATUS_CHANGED", {"to_status": "FULL_BLOCK"}, company.id)
    )
    assert {row.user_id for row in found} == {roles["C.OWNER"].id, roles["C.MANAGER"].id}


async def test_ntf_007_delivery_code_only_in_telegram_payload(client, session, monkeypatch):
    from app.modules.delivery import codes
    from tests.test_delivery import dispatched

    monkeypatch.setattr(get_settings(), "telegram_bot_token", SecretStr("123:test"))
    monkeypatch.setattr(get_settings(), "telegram_bot_username", "testbot")
    ctx, store, order, record, courier = await dispatched(client, session)
    outbox = await session.scalar(select(OutboxEvent).where(OutboxEvent.event_type == "DELIVERY_DISPATCHED"))
    event = DomainEvent(outbox.event_type, outbox.payload, outbox.org_id, outbox.id)
    await service.consume(session, event)
    notification = await session.scalar(select(Notification).where(Notification.event_id == outbox.id))
    assert notification.organization_id == store.id
    session.add(TelegramAccount(user_id=ctx.user.id, telegram_user_id=123, chat_id=123))
    await session.flush()
    row = await session.scalar(
        select(NotificationDelivery).where(NotificationDelivery.notification_id == notification.id)
    )
    sender = FakeSender()
    await delivery.send_one(session, row, sender)
    code = codes.decrypt(record.id, record.code_encrypted)
    assert code in sender.messages[0][1]
    assert "code" not in notification.params and code not in str(notification.params)
    assert code not in str(outbox.payload)
    assert row.status == "SENT"


async def test_delivery_rechecks_revocation_after_consume(session, monkeypatch):
    monkeypatch.setattr(get_settings(), "telegram_bot_token", SecretStr("123:test"))
    monkeypatch.setattr(get_settings(), "telegram_bot_username", "testbot")
    user, org, event, notification = await event_notification(session)
    session.add(TelegramAccount(user_id=user.id, telegram_user_id=123, chat_id=123))
    member = await session.scalar(select(Membership).where(Membership.organization_id == org.id))
    member.status = "REVOKED"
    await session.flush()
    row = await session.scalar(
        select(NotificationDelivery).where(NotificationDelivery.notification_id == notification.id)
    )
    sender = FakeSender()
    await delivery.send_one(session, row, sender)
    assert row.status == "SKIPPED" and not sender.messages


async def test_registered_outbox_pipeline_delivers_once(session, monkeypatch):
    from app.core.outbox import dispatch_pending

    monkeypatch.setattr(get_settings(), "telegram_bot_token", SecretStr("123:test"))
    monkeypatch.setattr(get_settings(), "telegram_bot_username", "testbot")
    owner = await make_user(session, language="ru")
    org = await make_org(session, owner)
    session.add(TelegramAccount(user_id=owner.id, telegram_user_id=123, chat_id=123))
    event = DomainEvent("LOW_STOCK", {}, org.id)
    session.add(NotificationPreference(user_id=owner.id, event_group="stock", channel="TELEGRAM", enabled=True))
    await EventBus().publish(session, event)
    await session.commit()
    service.install()
    assert await dispatch_pending() >= 1
    notification = await session.scalar(select(Notification).where(Notification.event_id == event.event_id))
    assert notification is not None
    sender = FakeSender()
    assert await delivery.send_pending(sender) >= 1
    matches = [
        message
        for chat_id, message in sender.messages
        if chat_id == 123 and message.startswith(templates.title("LOW_STOCK", "ru"))
    ]
    assert len(matches) == 1
    delivered = len(sender.messages)
    assert await delivery.send_pending(sender) == 0
    assert len(sender.messages) == delivered


async def test_telegram_block_and_retryable_provider_failure(session, monkeypatch):
    from aiogram.exceptions import TelegramForbiddenError
    from aiogram.methods import SendMessage

    monkeypatch.setattr(get_settings(), "telegram_bot_token", SecretStr("123:test"))
    monkeypatch.setattr(get_settings(), "telegram_bot_username", "testbot")
    user, org, event, notification = await event_notification(session)
    account = TelegramAccount(user_id=user.id, telegram_user_id=123, chat_id=123)
    session.add(account)
    await session.flush()
    row = await session.scalar(
        select(NotificationDelivery).where(NotificationDelivery.notification_id == notification.id)
    )
    sender = FakeSender(TimeoutError("private"))
    await delivery.send_one(session, row, sender)
    assert row.status == "PENDING" and row.attempts == 1 and row.next_attempt_at > utcnow()
    blocked = FakeSender(TelegramForbiddenError(method=SendMessage(chat_id=123, text="private"), message="blocked"))
    await delivery.send_one(session, row, blocked)
    assert row.status == "SKIPPED" and account.is_blocked_by_user
    assert row.last_error == "TelegramForbiddenError"
