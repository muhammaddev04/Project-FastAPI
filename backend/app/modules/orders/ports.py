from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.partnerships.service import terms_service


@dataclass(frozen=True)
class CreditCheck:
    allowed: bool
    limit: Decimal
    outstanding: Decimal = Decimal("0")
    unapplied: Decimal = Decimal("0")
    balance: Decimal = Decimal("0")
    available: Decimal = Decimal("0")


class CreditPort(Protocol):
    async def check(self, session: AsyncSession, partnership_id: UUID, amount: Decimal) -> CreditCheck: ...


class InitialCredit:
    async def check(self, session: AsyncSession, partnership_id: UUID, amount: Decimal) -> CreditCheck:
        terms = await terms_service.current(session, partnership_id)
        limit = terms.credit_limit if terms else Decimal("0")
        return CreditCheck(amount <= limit, limit)


class DeliveryCancellationPort(Protocol):
    async def cancel_for_order(self, session: AsyncSession, order_id: UUID) -> None: ...


class FutureDelivery:
    async def cancel_for_order(self, session: AsyncSession, order_id: UUID) -> None:
        """P08 installs transactional delivery cancellation."""


class OpenDisputePort(Protocol):
    async def has_open(self, session: AsyncSession, order_id: UUID) -> bool: ...


class FutureDispute:
    async def has_open(self, session: AsyncSession, order_id: UUID) -> bool:
        return False


credit: CreditPort = InitialCredit()
delivery_cancellation: DeliveryCancellationPort = FutureDelivery()
open_dispute: OpenDisputePort = FutureDispute()
