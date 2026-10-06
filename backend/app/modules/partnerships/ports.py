from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession


class OrderCancellationPort(Protocol):
    async def cancel_open_orders(self, session: AsyncSession, partnership_id: UUID, reason: str) -> None: ...


class FutureOrders:
    async def cancel_open_orders(self, session: AsyncSession, partnership_id: UUID, reason: str) -> None:
        """P07 installs cancellation of NEW/VIEWED orders in this transaction."""


order_cancellation: OrderCancellationPort = FutureOrders()
