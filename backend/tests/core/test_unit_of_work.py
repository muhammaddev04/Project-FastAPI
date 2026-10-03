import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.db import UnitOfWork
from app.core.events import DomainEvent
from app.core.outbox import OutboxEvent


async def test_fnd_004_uow_commits_events_and_audit(session: AsyncSession) -> None:
    event = DomainEvent("TEST", {})
    async with UnitOfWork() as uow:
        await uow.audit.record("test.uow", "event", event.event_id)
        await uow.events.publish(event)
    assert await session.get(OutboxEvent, event.event_id) is not None
    assert await session.scalar(select(func.count()).select_from(AuditLog)) == 1


async def test_fnd_004_uow_exception_rolls_back(session: AsyncSession) -> None:
    event = DomainEvent("TEST", {})
    with pytest.raises(ValueError):
        async with UnitOfWork() as uow:
            await uow.audit.record("test.uow", "event", event.event_id)
            await uow.events.publish(event)
            raise ValueError("abort")
    assert await session.get(OutboxEvent, event.event_id) is None
    assert await session.scalar(select(func.count()).select_from(AuditLog)) == 0
