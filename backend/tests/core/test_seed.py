import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.identity.models import Membership, Organization, User
from app.seed import seed


async def test_fnd_001_seed_refuses_non_development(session: AsyncSession) -> None:
    with pytest.raises(RuntimeError, match="only in development"):
        await seed()
    assert await session.scalar(select(func.count()).select_from(User)) == 0


async def test_fnd_001_seed_is_repeatable(session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "app_env", "development")
    await seed()
    await seed()
    assert await session.scalar(select(func.count()).select_from(User)) == 4
    assert await session.scalar(select(func.count()).select_from(Organization)) == 2
    assert await session.scalar(select(func.count()).select_from(Membership)) == 3
