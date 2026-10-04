"""P01 extension point: P03 installs subscription limits without coupling identity to plans."""

from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession


class SubscriptionGuardPort(Protocol):
    async def check_limit(self, session: AsyncSession, org_id: UUID, kind: str, adding: int = 1) -> None: ...


class AllowSubscriptionGuard:
    async def check_limit(self, session: AsyncSession, org_id: UUID, kind: str, adding: int = 1) -> None:
        return None


subscription_guard: SubscriptionGuardPort = AllowSubscriptionGuard()
