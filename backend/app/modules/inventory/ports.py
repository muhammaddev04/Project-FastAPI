"""P07 installs the tenant-scoped order-number lookup once order records exist."""

from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession


class OrderNumbers(Protocol):
    async def resolve(self, session: AsyncSession, company_id: UUID, source_ids: list[UUID]) -> dict[UUID, str]: ...


class FutureOrders:
    async def resolve(self, session: AsyncSession, company_id: UUID, source_ids: list[UUID]) -> dict[UUID, str]:
        return {}


order_numbers: OrderNumbers = FutureOrders()
