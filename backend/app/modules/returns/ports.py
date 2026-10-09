"""P10 wiring: the real open-dispute port and the owner's decision on a dispute credit."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import event_bus
from app.modules.orders import ports as order_ports
from app.modules.returns.service import dispute_service


class OpenDispute:
    """DSP-004: the P07 port becomes real, so an open dispute holds the order open."""

    async def has_open(self, session: AsyncSession, order_id: UUID) -> bool:
        return await dispute_service.has_open(session, order_id)


def install() -> None:
    # DSP-021: a manager's dispute credit is finished by whatever the owner decides.
    event_bus.subscribe("ADJUSTMENT_APPROVED", dispute_service.adjustment_decided)
    event_bus.subscribe("ADJUSTMENT_REJECTED", dispute_service.adjustment_decided)
    order_ports.open_dispute = OpenDispute()
