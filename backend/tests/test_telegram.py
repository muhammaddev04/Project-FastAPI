from datetime import timedelta

import pytest
from aiogram.types import Update
from pydantic import SecretStr
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.redis import get_redis
from app.core.time import utcnow
from app.modules.notifications import bot, telegram
from app.modules.notifications.models import TelegramAccount, TelegramLinkToken, TelegramUpdate
from tests.factories import add_member, auth, make_org, make_user


@pytest.fixture
def telegram_config(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "telegram_bot_token", SecretStr("123456:testtoken"))
    monkeypatch.setattr(settings, "telegram_bot_username", "testbot")
    monkeypatch.setattr(settings, "telegram_webhook_path_token", SecretStr("testpath"))
    monkeypatch.setattr(settings, "telegram_webhook_secret", SecretStr("testsecret"))


def update(text="/start", *, update_id=1, telegram_id=123, chat_type="private"):
    return Update.model_validate(
        {
            "update_id": update_id,
            "message": {
                "message_id": 1,
                "date": int(utcnow().timestamp()),
                "chat": {"id": telegram_id, "type": chat_type},
                "from": {"id": telegram_id, "is_bot": False, "first_name": "Tester", "language_code": "en"},
                "text": text,
            },
        }
    )


async def test_tg_010_link_token_single_use_expiry(session, telegram_config):
    user = await make_user(session)
    result = await telegram.create_token(session, user)
    raw = result.deep_link.split("start=")[1]
    assert len(raw) == 43
    row = await session.get(TelegramLinkToken, telegram.token_hash(raw))
    assert row is not None and row.token_hash != raw
    linked = await telegram.link_account(session, raw, 123, 123, "tester", "en")
    assert linked.id == user.id and row.used_at is not None
    with pytest.raises(AppError, match="telegram_link_invalid"):
        await telegram.link_account(session, raw, 123, 123, None, None)
    expired = await telegram.create_token(session, user)
    raw_expired = expired.deep_link.split("start=")[1]
    row_expired = await session.get(TelegramLinkToken, telegram.token_hash(raw_expired))
    row_expired.expires_at = utcnow() - timedelta(seconds=1)
    await session.flush()
    with pytest.raises(AppError, match="telegram_link_invalid"):
        await telegram.link_account(session, raw_expired, 123, 123, None, None)


async def test_tg_011_telegram_already_linked(session, telegram_config):
    first = await make_user(session)
    second = await make_user(session)
    for user in (first, second):
        result = await telegram.create_token(session, user)
        raw = result.deep_link.split("start=")[1]
        if user == first:
            await telegram.link_account(session, raw, 123, 123, None, None)
        else:
            with pytest.raises(AppError, match="telegram_already_linked"):
                await telegram.link_account(session, raw, 123, 123, None, None)


async def test_tg_012_unlink_invalidates_unused_tokens(client, session, telegram_config):
    user = await make_user(session)
    result = await telegram.create_token(session, user)
    await session.commit()
    response = await client.delete("/api/v1/telegram/link", headers=auth(user))
    assert response.status_code == 204
    row = await session.get(TelegramLinkToken, telegram.token_hash(result.deep_link.split("start=")[1]))
    await session.refresh(row)
    assert row.used_at is not None


async def test_tg_001_secret_required_and_tg_003_duplicate_update(client, session, telegram_config):
    payload = update().model_dump(mode="json", exclude_none=True)
    for path, headers in [
        ("testpath", {}),
        ("wrongpath", {"X-Telegram-Bot-Api-Secret-Token": "testsecret"}),
        ("testpath", {"X-Telegram-Bot-Api-Secret-Token": "wrong"}),
    ]:
        response = await client.post(f"/api/v1/telegram/webhook/{path}", headers=headers, json=payload)
        assert response.status_code == 401
    headers = {"X-Telegram-Bot-Api-Secret-Token": "testsecret"}
    response = await client.post("/api/v1/telegram/webhook/testpath", headers=headers, json=payload)
    assert response.status_code == 200 and response.json()["method"] == "sendMessage"
    repeated = await client.post("/api/v1/telegram/webhook/testpath", headers=headers, json=payload)
    assert repeated.json() == {"ok": True}
    assert await session.scalar(select(func.count()).select_from(TelegramUpdate)) == 1


async def test_tg_013_unlinked_blocked_and_group_private(session):
    assert "First link" in (await bot.handle(session, update("/orders")))["text"]
    user = await make_user(session, status="BLOCKED", language="en")
    session.add(TelegramAccount(user_id=user.id, telegram_user_id=123, chat_id=123))
    await session.flush()
    assert "First link" in (await bot.handle(session, update("/orders")))["text"]
    assert await bot.handle(session, update("/code", chat_type="group")) == {"ok": True}


async def test_bot_orders_respects_permissions(session):
    owner = await make_user(session)
    org = await make_org(session, owner)
    courier = await make_user(session, language="en")
    await add_member(session, org, courier, "COURIER")
    session.add(TelegramAccount(user_id=courier.id, telegram_user_id=123, chat_id=123))
    await session.flush()
    await get_redis().set(bot.state_key(123), str(org.id), ex=86400)
    assert (await bot.handle(session, update("/orders")))["text"] == "Access denied"
    assert (await bot.handle(session, update("/debt")))["text"] == "Access denied"
    assert (await bot.handle(session, update("/code")))["text"] == "Access denied"


async def test_telegram_optional_unconfigured(client, session, monkeypatch):
    monkeypatch.setattr(get_settings(), "telegram_bot_token", SecretStr(""))
    user = await make_user(session)
    await session.commit()
    assert (await client.get("/api/v1/telegram/link", headers=auth(user))).json() == {
        "configured": False,
        "linked": False,
        "username": None,
        "linked_at": None,
        "blocked": False,
    }
    response = await client.post("/api/v1/telegram/link-token", headers=auth(user))
    assert response.status_code == 503 and response.json()["error"]["code"] == "service_unavailable"


async def test_bot_warehouse_no_prices_and_code_store_only(client, session):
    from tests.test_delivery import dispatched

    ctx, store, order, delivery, courier = await dispatched(client, session)
    warehouse = await make_user(session, language="en")
    await add_member(session, ctx.organization, warehouse, "WAREHOUSE")
    await get_redis().set(bot.state_key(123), str(ctx.organization.id), ex=86400)
    # The existing order service allows warehouse reads in transit, but strips every price.
    response = await bot.command(session, warehouse, 123, 123, "/orders", "")
    assert order["order_number"] in response.text
    assert "TJS" not in response.text
    detail = await bot.command(session, warehouse, 123, 123, "/order", order["order_number"])
    assert order["order_number"] in detail.text and "TJS" not in detail.text
    with pytest.raises(AppError, match="permission_denied"):
        await bot.command(session, warehouse, 123, 123, "/code", "")
    await get_redis().set(bot.state_key(123), str(store.id), ex=86400)
    response = await bot.command(session, ctx.user, 123, 123, "/code", "")
    from app.modules.delivery import codes

    assert codes.decrypt(delivery.id, delivery.code_encrypted) in response.text


async def test_bot_debt_store_vs_company_and_today(client, session):
    from tests.test_delivery import dispatched

    ctx, store, order, delivery, courier = await dispatched(client, session)
    confirmed = await client.post(
        f"/api/v1/deliveries/{delivery.id}/manual-confirm",
        headers=auth(ctx.user, ctx.organization),
        json={"reason": "Checked handover by owner"},
    )
    assert confirmed.status_code == 200
    await get_redis().set(bot.state_key(123), str(ctx.organization.id), ex=86400)
    company_debt = await bot.command(session, ctx.user, 123, 123, "/debt", "")
    assert "TJS" in company_debt.text
    await get_redis().set(bot.state_key(123), str(store.id), ex=86400)
    store_debt = await bot.command(session, ctx.user, 123, 123, "/debt", "")
    assert ctx.organization.name in store_debt.text and "TJS" in store_debt.text
    await get_redis().set(bot.state_key(456), str(ctx.organization.id), ex=86400)
    stops = await bot.command(session, courier, 456, 456, "/today", "")
    assert stops.text


async def test_tg_004_webhook_rate_limit(client, telegram_config):
    payload = update().model_dump(mode="json", exclude_none=True)
    headers = {"X-Telegram-Bot-Api-Secret-Token": "testsecret"}
    for _ in range(60):
        response = await client.post("/api/v1/telegram/webhook/testpath", headers=headers, json=payload)
        assert response.status_code == 200
    response = await client.post("/api/v1/telegram/webhook/testpath", headers=headers, json=payload)
    assert response.status_code == 429 and response.headers.get("Retry-After")


async def test_tg_005_webhook_cli_requires_https(telegram_config, monkeypatch):
    from app.modules.notifications.webhook_cli import set_webhook

    monkeypatch.setattr(get_settings(), "telegram_webhook_base_url", "http://localhost")
    with pytest.raises(ValueError, match="HTTPS"):
        await set_webhook()


async def test_private_update_recovers_an_unblocked_bot(session):
    user = await make_user(session, language="en")
    account = TelegramAccount(user_id=user.id, telegram_user_id=123, chat_id=123, is_blocked_by_user=True)
    session.add(account)
    await session.flush()
    assert await bot.handle(session, update("/start", chat_type="group")) == {"ok": True}
    assert account.is_blocked_by_user
    reply = await bot.handle(session, update("/start"))
    assert reply["method"] == "sendMessage"
    await session.flush()
    assert not account.is_blocked_by_user
