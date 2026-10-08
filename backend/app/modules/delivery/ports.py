"""P08 wiring: the stubs P07 left behind become the real delivery module.

Both of these are synchronous, same-transaction handlers on purpose. An order that reaches
READY_FOR_DELIVERY without its delivery row, or one that is cancelled while a delivery is still
live, would be a split brain between the two modules, so neither is allowed to land on its own.
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import DomainEvent, event_bus
from app.modules.delivery.service import delivery_service
from app.modules.orders import ports as order_ports
from app.modules.orders.models import Order


async def order_ready(session: AsyncSession, event: DomainEvent) -> None:
    """DEL-001: READY_FOR_DELIVERY, from the first pass or a reattempt, plans the next delivery."""
    order = await session.get(Order, UUID(event.payload["order_id"]))
    if order is not None:
        await delivery_service.plan_for_order(session, order)


def install() -> None:
    event_bus.subscribe("ORDER_READY", order_ready)
    # DEL-002: cancelling an order now really cancels its delivery, and refuses once it is on the road.
    order_ports.delivery_cancellation = delivery_service
