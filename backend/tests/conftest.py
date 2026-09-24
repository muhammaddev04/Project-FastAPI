"""Shared fixtures. Tests use real PostgreSQL and Redis (01_GLOBAL §14 - SQLite is not accepted):

docker compose -f docker-compose.test.yml up -d
"""

from __future__ import annotations

import os

os.environ["APP_ENV"] = "testing"
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://tezfarmo:tezfarmo@localhost:5434/tezfarmo_test"
)
os.environ["REDIS_URL"] = os.environ.get("TEST_REDIS_URL", "redis://localhost:6381/15")
os.environ["GOOGLE_CLIENT_ID"] = ""
os.environ["GOOGLE_CLIENT_SECRET"] = ""

from collections.abc import AsyncIterator  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core.db import Base, get_engine, get_sessionmaker  # noqa: E402
from app.core.redis import get_redis  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session", autouse=True)
def _migrated_database() -> None:
    """Every test session exercises the real migrations: downgrade to base, then upgrade to head."""
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    command.downgrade(config, "base")
    command.upgrade(config, "head")


@pytest.fixture(autouse=True)
async def _clean_state() -> AsyncIterator[None]:
    yield
    import app.model_registry  # noqa: F401 - make sure every table is known

    tables = ", ".join(table.name for table in Base.metadata.sorted_tables)
    async with get_engine().begin() as connection:
        # TRUNCATE is the only reset that bypasses the append-only row triggers; used by tests only.
        await connection.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    await get_redis().flushdb()


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://testserver") as http:
        yield http


@pytest.fixture
async def session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as db:
        yield db
