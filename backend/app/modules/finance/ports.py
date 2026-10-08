"""Synchronous P07/P08 finance wiring: posting shares the delivery transaction."""

from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.events import DomainEvent, event_bus
from app.modules.finance.service import SystemActor, finance_service
from app.modules.orders import ports as order_ports
from app.modules.orders.models import Order


class FinanceCredit:
    async def check(self, session: AsyncSession, partnership_id: UUID, amount: Decimal) -> order_ports.CreditCheck:
        result = await finance_service.credit_check(session, partnership_id, amount)
        return order_ports.CreditCheck(
            result.allowed, result.limit, result.outstanding, result.unapplied, result.balance, result.available
        )


async def order_delivered(session: AsyncSession, event: DomainEvent) -> None:
    order = await session.get(Order, UUID(event.payload["order_id"]))
    if order is None:
        raise AppError("not_found", 404)
    await finance_service.create_order_charge(session, SystemActor("ORDER_DELIVERED"), order)


async def partnership_activated(session: AsyncSession, event: DomainEvent) -> None:
    await finance_service._lock(session, UUID(event.payload["partnership_id"]))


def install() -> None:
    event_bus.subscribe("ORDER_DELIVERED", order_delivered)
    event_bus.subscribe("PARTNERSHIP_ACTIVATED", partnership_activated)
    order_ports.credit = FinanceCredit()
