from aiogram import Bot

from app.core.config import get_settings


async def set_webhook() -> None:
    settings = get_settings()
    path = settings.telegram_webhook_path_token.get_secret_value()
    secret = settings.telegram_webhook_secret.get_secret_value()
    if (
        not settings.telegram_configured
        or not path
        or not secret
        or not settings.telegram_webhook_base_url.startswith("https://")
    ):
        raise ValueError("Configure Telegram bot, webhook secrets and an HTTPS base URL first")
    async with Bot(token=settings.telegram_bot_token.get_secret_value()) as bot:
        await bot.set_webhook(
            url=f"{settings.telegram_webhook_base_url.rstrip('/')}/api/v1/telegram/webhook/{path}",
            secret_token=secret,
            allowed_updates=["message", "callback_query"],
            request_timeout=5,
        )
    print("Telegram webhook configured")
