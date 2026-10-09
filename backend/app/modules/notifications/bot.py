"""DEC-23: private-chat commands reuse tenant-scoped application reads."""

from typing import Any, Literal, cast
from uuid import UUID

from aiogram.methods import AnswerCallbackQuery, SendMessage
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Update
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.redis import get_redis
from app.modules.delivery import router as deliveries
from app.modules.finance.service import finance_service
from app.modules.identity.deps import OrgContext
from app.modules.identity.models import Membership, User
from app.modules.identity.schemas import MeUpdateRequest
from app.modules.identity.service import update_me
from app.modules.notifications import telegram
from app.modules.notifications.models import TelegramAccount
from app.modules.notifications.templates import local, money
from app.modules.orders import router as orders
from app.modules.orders import service as order_service
from app.modules.orders.schemas import OrderOut

HELP = (
    "Аввал ҳисобро аз профили барнома пайваст кунед. /org /orders /order /debt /code /today /lang /unlink",
    "Сначала подключите аккаунт из профиля приложения. /org /orders /order /debt /code /today /lang /unlink",
    "First link your account from your app profile. /org /orders /order /debt /code /today /lang /unlink",
)


def state_key(telegram_id: int) -> str:
    return f"telegram:org:{telegram_id}"


async def context(session: AsyncSession, user: User, telegram_id: int) -> OrgContext:
    value = await get_redis().get(state_key(telegram_id))
    try:
        org_id = UUID(str(value))
    except (ValueError, TypeError) as exc:
        raise AppError("org_context_required", 400) from exc
    member = await session.scalar(
        select(Membership).where(
            Membership.user_id == user.id, Membership.organization_id == org_id, Membership.status == "ACTIVE"
        )
    )
    if member is None or member.organization.status == "BLOCKED":
        raise AppError("permission_denied", 403)
    return OrgContext(user, member, member.organization)


def require(ctx: OrgContext, permission: str) -> None:
    if permission not in ctx.permissions:
        raise AppError("permission_denied", 403)


async def command(
    session: AsyncSession, user: User, telegram_id: int, chat_id: int, name: str, argument: str
) -> SendMessage:
    language = user.language
    if name == "/unlink":
        await telegram.unlink(session, user.id)
        await get_redis().delete(state_key(telegram_id))
        return SendMessage(
            chat_id=chat_id, text=local(("Ҳисоб ҷудо шуд", "Аккаунт отключён", "Account unlinked"), language)
        )
    if name == "/lang":
        if argument in {"tg", "ru", "en"}:
            await update_me(session, user, MeUpdateRequest(language=cast(Literal["tg", "ru", "en"], argument)))
        return SendMessage(chat_id=chat_id, text="/lang tg · /lang ru · /lang en")
    if name == "/org":
        members = await session.scalars(
            select(Membership).where(Membership.user_id == user.id, Membership.status == "ACTIVE")
        )
        keyboard = [
            [InlineKeyboardButton(text=member.organization.name, callback_data=f"org:{member.organization_id}")]
            for member in members
            if member.organization.status != "BLOCKED"
        ]
        return SendMessage(
            chat_id=chat_id,
            text=local(("Ташкилотро интихоб кунед", "Выберите организацию", "Choose an organization"), language),
            reply_markup=InlineKeyboardMarkup(inline_keyboard=keyboard),
        )
    if name == "/start":
        return SendMessage(chat_id=chat_id, text=local(HELP, language))
    ctx = await context(session, user, telegram_id)
    area = "company" if ctx.organization.type == "COMPANY" else "store"
    base_url = get_settings().frontend_base_url.rstrip("/")
    lines: list[str] = []
    buttons: list[list[InlineKeyboardButton]] = []
    if name in {"/orders", "/order"}:
        require(ctx, "orders.view")
        result = await orders.listing(session, ctx, orders.OrderQuery(limit=5, offset=0, search=argument or None))
        rows = result.results
        if name == "/order":
            rows = [row for row in rows if row.order_number == argument]
            if not rows:
                raise AppError("not_found", 404)
            # Detail goes through the existing service and its warehouse visibility checks.
            record = await order_service.get(session, ctx, rows[0].id)
            rows = [await orders.output(session, ctx, record)]
        for row in rows:
            line = f"{row.order_number} · {row.status}"
            if isinstance(row, OrderOut):
                line += " · " + money(row.total if row.total is not None else row.requested_subtotal, language)
            lines.append(line)
            if name == "/order":
                lines.extend(
                    f"{item.product_name_snapshot} · "
                    f"{item.confirmed_quantity if item.confirmed_quantity is not None else item.requested_quantity} "
                    f"{item.unit_code_snapshot}"
                    for item in row.items
                )
            buttons.append([InlineKeyboardButton(text=row.order_number, url=f"{base_url}/{area}/orders/{row.id}")])
    elif name == "/debt":
        require(ctx, "finance.view")
        if ctx.membership.role not in {"OWNER", "MANAGER"}:
            raise AppError("permission_denied", 403)
        if ctx.organization.type == "COMPANY":
            summary = await finance_service.summary(session, ctx)
            lines = [
                money(summary["balance"], language),
                local(("Муҳлатгузашта", "Просрочено", "Overdue"), language)
                + ": "
                + money(summary["overdue"], language),
            ]
        else:
            balances = await session.execute(finance_service.balances_query(ctx))
            lines = [f"{row['partner_name']}: {money(row['balance'], language)}" for row in balances.mappings()]
    elif name == "/today":
        require(ctx, "delivery.act_own")
        result_today = await deliveries.courier_today(session, ctx)
        lines = [f"{stop.order_number} · {stop.store_name} · {stop.status}" for stop in result_today.stops]
    elif name == "/code":
        require(ctx, "delivery.view_store")
        result = await orders.listing(session, ctx, orders.OrderQuery(limit=100, offset=0, status=["IN_TRANSIT"]))
        for order in result.results:
            delivery = await deliveries.store_delivery(session, ctx, order.id)
            if delivery.code:
                lines.append(f"{order.order_number}: {delivery.code}")
    else:
        return SendMessage(chat_id=chat_id, text=local(HELP, language))
    return SendMessage(
        chat_id=chat_id,
        text="\n".join(lines)[:4000] or local(("Маълумот нест", "Нет данных", "No data"), language),
        reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons) if buttons else None,
    )


async def handle(session: AsyncSession, update: Update) -> dict[str, Any]:
    message = update.message
    callback = update.callback_query
    sender = message.from_user if message else callback.from_user if callback else None
    if sender is None:
        return {"ok": True}
    # Tokens and delivery codes must never be exposed in groups or channels.
    if message and (message.chat.type != "private" or message.chat.id != sender.id):
        return {"ok": True}
    if callback and (
        callback.message is None or callback.message.chat.type != "private" or callback.message.chat.id != sender.id
    ):
        return {"ok": True}
    account = await session.scalar(select(TelegramAccount).where(TelegramAccount.telegram_user_id == sender.id))
    user = await session.get(User, account.user_id) if account else None
    language = user.language if user else sender.language_code or "tg"
    name, _, argument = (message.text or "").partition(" ") if message else ("", "", "")
    name = name.split("@", 1)[0]
    reply: SendMessage | AnswerCallbackQuery
    try:
        if name == "/start" and argument:
            async with session.begin_nested():
                user = await telegram.link_account(
                    session, argument.strip(), sender.id, sender.id, sender.username, sender.language_code
                )
            reply = SendMessage(
                chat_id=sender.id,
                text=local(
                    ("Ҳисоб пайваст шуд. /org", "Аккаунт подключён. /org", "Account linked. /org"), user.language
                ),
            )
        elif user is None or user.status != "ACTIVE":
            reply = SendMessage(chat_id=sender.id, text=local(HELP, language))
        elif callback:
            org_id = UUID((callback.data or "").removeprefix("org:"))
            member = await session.scalar(
                select(Membership).where(
                    Membership.organization_id == org_id, Membership.user_id == user.id, Membership.status == "ACTIVE"
                )
            )
            if member is None or member.organization.status == "BLOCKED":
                raise AppError("permission_denied", 403)
            await get_redis().set(state_key(sender.id), str(org_id), ex=86400)
            reply = AnswerCallbackQuery(callback_query_id=callback.id, text=member.organization.name[:200])
        else:
            reply = await command(session, user, sender.id, sender.id, name, argument.strip())
    except (AppError, ValueError) as exc:
        error = exc.code if isinstance(exc, AppError) else "validation_error"
        messages = {
            "telegram_link_invalid": (
                "Пайванд истифода шуд ё мӯҳлаташ гузашт",
                "Ссылка использована или истекла",
                "Link used or expired",
            ),
            "telegram_already_linked": (
                "Telegram аллакай пайваст аст",
                "Telegram уже подключён",
                "Telegram already linked",
            ),
            "org_context_required": ("Аввал /org", "Сначала /org", "Choose /org first"),
        }
        body = local(messages.get(error, ("Дастрасӣ нест", "Доступ запрещён", "Access denied")), language)
        reply = SendMessage(chat_id=sender.id, text=body)
    return {"method": reply.__api_method__, **reply.model_dump(mode="json", exclude_none=True, exclude_defaults=True)}
