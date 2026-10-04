"""P02 trial starter contract; P03 installs the subscription implementation."""

from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import DomainEvent, event_bus


class SubscriptionStarterPort(Protocol):
    async def start_trial(self, session: AsyncSession, company_id: UUID) -> None: ...


class NoopSubscriptionStarter:
    async def start_trial(self, session: AsyncSession, company_id: UUID) -> None:
        return None


subscription_starter: SubscriptionStarterPort = NoopSubscriptionStarter()


async def start_company_trial(session: AsyncSession, event: DomainEvent) -> None:
    await subscription_starter.start_trial(session, UUID(event.payload["organization_id"]))


def install_handlers() -> None:
    event_bus.subscribe("COMPANY_CREATED", start_company_trial)
