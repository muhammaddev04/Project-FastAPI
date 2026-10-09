import hashlib
import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.time import utcnow
from app.modules.identity.models import User
from app.modules.notifications.models import TelegramAccount, TelegramLinkToken
from app.modules.notifications.schemas import TelegramTokenOut


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


async def create_token(session: AsyncSession, user: User) -> TelegramTokenOut:
    settings = get_settings()
    if not settings.telegram_configured:
        raise AppError("service_unavailable", 503)
    # Serialize creation, unlinking and consumption for this user.
    await session.scalar(select(User.id).where(User.id == user.id).with_for_update())
    token = secrets.token_urlsafe(32)
    expires = utcnow() + timedelta(minutes=10)
    session.add(TelegramLinkToken(token_hash=token_hash(token), user_id=user.id, expires_at=expires))
    await session.flush()
    return TelegramTokenOut(
        deep_link=f"https://t.me/{settings.telegram_bot_username}?start={token}", expires_at=expires
    )


async def link_account(
    session: AsyncSession, token: str, telegram_user_id: int, chat_id: int, username: str | None, language: str | None
) -> User:
    if len(token) != 43 or not token.isascii():
        raise AppError("telegram_link_invalid", 422)
    hashed = token_hash(token)
    owner = await session.scalar(select(TelegramLinkToken.user_id).where(TelegramLinkToken.token_hash == hashed))
    if owner is None:
        raise AppError("telegram_link_invalid", 422)
    user = await session.scalar(select(User).where(User.id == owner).with_for_update())
    row = await session.scalar(
        select(TelegramLinkToken).where(TelegramLinkToken.token_hash == hashed).with_for_update()
    )
    if row is None or user is None or user.status != "ACTIVE" or row.used_at or row.expires_at <= utcnow():
        raise AppError("telegram_link_invalid", 422)
    # Lock the Telegram identity across different users, including when it has no row yet.
    from sqlalchemy import func

    await session.execute(select(func.pg_advisory_xact_lock(telegram_user_id)))
    existing = await session.scalar(select(TelegramAccount).where(TelegramAccount.telegram_user_id == telegram_user_id))
    if existing and existing.user_id != user.id:
        raise AppError("telegram_already_linked", 409)
    account = await session.get(TelegramAccount, user.id)
    if account is None:
        account = TelegramAccount(user_id=user.id)
        session.add(account)
    account.telegram_user_id = telegram_user_id
    account.chat_id = chat_id
    account.username = username
    account.language = language if language in {"tg", "ru", "en"} else None
    account.linked_at = utcnow()
    account.is_blocked_by_user = False
    row.used_at = utcnow()
    await audit.record(session, "telegram.linked", "user", user.id, actor_id=user.id)
    await session.flush()
    return user


async def unlink(session: AsyncSession, user_id: UUID) -> None:
    from sqlalchemy import delete, update

    await session.scalar(select(User.id).where(User.id == user_id).with_for_update())
    await session.execute(delete(TelegramAccount).where(TelegramAccount.user_id == user_id))
    await session.execute(
        update(TelegramLinkToken)
        .where(TelegramLinkToken.user_id == user_id, TelegramLinkToken.used_at.is_(None))
        .values(used_at=utcnow())
    )
    await audit.record(session, "telegram.unlinked", "user", user_id, actor_id=user_id)
