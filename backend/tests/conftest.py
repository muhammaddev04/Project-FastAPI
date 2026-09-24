"""Shared fixtures. Tests run against real PostgreSQL + Redis (TZ 01_GLOBAL §14):

docker compose -f docker-compose.test.yml up -d
"""

from __future__ import annotations

import os

os.environ.setdefault("APP_ENV", "testing")
os.environ.setdefault("TEST_DATABASE_URL", "postgresql+asyncpg://tezfarmo:tezfarmo@localhost:5433/tezfarmo_test")
os.environ.setdefault("TEST_REDIS_URL", "redis://localhost:6380/15")
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
os.environ["REDIS_URL"] = os.environ["TEST_REDIS_URL"]
os.environ["GOOGLE_CLIENT_ID"] = ""
os.environ["GOOGLE_CLIENT_SECRET"] = ""

from collections.abc import AsyncIterator  # noqa: E402
from typing import TYPE_CHECKING  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core.db import get_engine, get_sessionmaker  # noqa: E402
from app.core.redis import get_redis  # noqa: E402

if TYPE_CHECKING:
    from app.core.sms import ConsoleSmsProvider

TABLES = "oauth_identities, refresh_tokens, otp_codes, memberships, organizations, users"


@pytest.fixture(scope="session", autouse=True)
def _migrated_database() -> None:
    config = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    config.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "migrations"))
    command.downgrade(config, "base")
    command.upgrade(config, "head")


@pytest.fixture(autouse=True)
async def _clean_state() -> AsyncIterator[None]:
    yield
    async with get_engine().begin() as connection:
        # audit_logs is append-only (trigger); TRUNCATE is the only allowed reset and only in tests.
        await connection.execute(text(f"TRUNCATE {TABLES}, audit_logs RESTART IDENTITY CASCADE"))
    await get_redis().flushdb()


@pytest.fixture
def sms() -> ConsoleSmsProvider:
    from app.core.sms import ConsoleSmsProvider, set_sms_provider

    provider = ConsoleSmsProvider()
    set_sms_provider(provider)
    return provider


@pytest.fixture
async def client(sms: ConsoleSmsProvider) -> AsyncIterator[AsyncClient]:
    from app.main import app

    # https base URL so Secure cookies (SEC-004) are sent back by the client.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://testserver") as http:
        yield http


@pytest.fixture
async def session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as db:
        yield db
