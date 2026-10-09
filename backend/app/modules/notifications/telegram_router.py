import secrets
from typing import Annotated, Any

from aiogram.types import Update
from fastapi import APIRouter, Header, Response
from pydantic import ValidationError
from sqlalchemy.dialects.postgresql import insert

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.rate_limit import RateLimit, hit
from app.core.request_context import get_client_ip
from app.modules.identity.deps import CurrentUser, SessionDep
from app.modules.notifications import bot, telegram
from app.modules.notifications.models import TelegramAccount, TelegramUpdate
from app.modules.notifications.schemas import TelegramLinkOut, TelegramTokenOut

router = APIRouter(prefix="/api/v1/telegram", tags=["telegram"])
WEBHOOK_LIMIT = RateLimit("telegram_webhook", 60, 60)


@router.get("/link", response_model=TelegramLinkOut)
async def link_status(session: SessionDep, user: CurrentUser) -> TelegramLinkOut:
    account = await session.get(TelegramAccount, user.id)
    return TelegramLinkOut(
        configured=get_settings().telegram_configured,
        linked=account is not None,
        username=account.username if account else None,
        linked_at=account.linked_at if account else None,
        blocked=account.is_blocked_by_user if account else False,
    )


@router.post("/link-token", response_model=TelegramTokenOut)
async def link_token(session: SessionDep, user: CurrentUser) -> TelegramTokenOut:
    await hit(RateLimit("telegram_link", 10, 600), str(user.id))
    return await telegram.create_token(session, user)


@router.delete("/link", status_code=204)
async def unlink(session: SessionDep, user: CurrentUser) -> Response:
    account = await session.get(TelegramAccount, user.id)
    telegram_id = account.telegram_user_id if account else None
    await telegram.unlink(session, user.id)
    if telegram_id is not None:
        from app.core.redis import get_redis

        await get_redis().delete(bot.state_key(telegram_id))
    return Response(status_code=204)


@router.post("/webhook/{path_token}")
async def webhook(
    path_token: str,
    payload: dict[str, Any],
    session: SessionDep,
    secret: Annotated[str | None, Header(alias="X-Telegram-Bot-Api-Secret-Token")] = None,
) -> dict[str, Any]:
    settings = get_settings()
    expected_path = settings.telegram_webhook_path_token.get_secret_value()
    expected_secret = settings.telegram_webhook_secret.get_secret_value()
    if (
        not expected_path
        or not expected_secret
        or not secret
        or not secrets.compare_digest(path_token.encode(), expected_path.encode())
        or not secrets.compare_digest(secret.encode(), expected_secret.encode())
    ):
        raise AppError("webhook_unauthorized", 401)
    try:
        update = Update.model_validate(payload)
    except ValidationError:
        raise AppError("validation_error", 422) from None
    await hit(WEBHOOK_LIMIT, get_client_ip() or "unknown")
    claimed = await session.scalar(
        insert(TelegramUpdate)
        .values(update_id=update.update_id)
        .on_conflict_do_nothing(index_elements=["update_id"])
        .returning(TelegramUpdate.update_id)
    )
    if claimed is None:
        return {"ok": True}
    return await bot.handle(session, update)
