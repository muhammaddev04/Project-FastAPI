import asyncio
from datetime import timedelta

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.audit import AuditLog
from app.core.events import DomainEvent, EventBus
from app.core.outbox import ConsumerRegistry, OutboxEvent, dispatch_pending
from app.core.time import utcnow


async def test_fnd_012_publish_is_transactional(session: AsyncSession) -> None:
    bus = EventBus()
    event = DomainEvent("TEST", {"value": 1})

    async def handler(db: AsyncSession, message: DomainEvent) -> None:
        await audit.record(db, "test.event", "event", message.event_id)

    bus.subscribe("TEST", handler)
    await bus.publish(session, event)
    assert await session.scalar(select(func.count()).select_from(AuditLog)) == 1
    assert await session.get(OutboxEvent, event.event_id) is not None
    await session.rollback()
    assert await session.scalar(select(func.count()).select_from(OutboxEvent)) == 0
    assert await session.scalar(select(func.count()).select_from(AuditLog)) == 0


async def test_fnd_012_handler_failure_rolls_back(session: AsyncSession) -> None:
    bus = EventBus()

    async def failing(db: AsyncSession, message: DomainEvent) -> None:
        await audit.record(db, "test.event", "event", message.event_id)
        await db.flush()
        raise ValueError("failure")

    bus.subscribe("TEST", failing)
    with pytest.raises(ValueError):
        await bus.publish(session, DomainEvent("TEST", {}))
    await session.commit()
    assert await session.scalar(select(func.count()).select_from(AuditLog)) == 0
    assert await session.scalar(select(func.count()).select_from(OutboxEvent)) == 0


async def test_fnd_010_outbox_immutable(session: AsyncSession) -> None:
    await EventBus().publish(session, DomainEvent("TEST", {}))
    await session.commit()
    for statement in (
        "DELETE FROM outbox_events",
        "UPDATE outbox_events SET payload = jsonb_build_object('x', 1)",
    ):
        with pytest.raises(DBAPIError, match="append-only"):
            await session.execute(text(statement))
        await session.rollback()


async def test_fnd_013_dispatch_once(session: AsyncSession) -> None:
    event = DomainEvent("TEST", {})
    await EventBus().publish(session, event)
    await session.commit()
    registry = ConsumerRegistry()

    async def consumer(db: AsyncSession, message: DomainEvent) -> None:
        await audit.record(db, "test.consume", "event", message.event_id)

    registry.subscribe("TEST", consumer)
    assert await dispatch_pending(registry) == 1
    assert await dispatch_pending(registry) == 0
    await session.refresh(await session.get(OutboxEvent, event.event_id))
    row = await session.get(OutboxEvent, event.event_id)
    assert row.status == "PROCESSED"
    assert row.processed_at is not None
    assert await session.scalar(select(func.count()).select_from(AuditLog)) == 1


async def test_fnd_013_retry_and_failed_after_eight(session: AsyncSession) -> None:
    event = DomainEvent("TEST", {})
    await EventBus().publish(session, event)
    await session.commit()
    registry = ConsumerRegistry()

    async def failing(db: AsyncSession, message: DomainEvent) -> None:
        await audit.record(db, "test.consume", "event", message.event_id)
        await db.flush()
        raise ValueError("secret must not be persisted")

    registry.subscribe("TEST", failing)
    for attempt in range(1, 9):
        before = utcnow()
        assert await dispatch_pending(registry) == 1
        row = await session.get(OutboxEvent, event.event_id)
        await session.refresh(row)
        assert row.attempts == attempt
        assert row.next_attempt_at >= before + timedelta(seconds=min(2**attempt * 5, 3600))
        assert row.status == ("FAILED" if attempt == 8 else "PENDING")
        assert row.last_error == "ValueError"
        assert await session.scalar(select(func.count()).select_from(AuditLog)) == 0
        assert await dispatch_pending(registry) == 0
        row.next_attempt_at = utcnow() - timedelta(seconds=1)
        await session.commit()
    assert await dispatch_pending(registry) == 0


async def test_fnd_013_missing_consumer_retries(session: AsyncSession) -> None:
    event = DomainEvent("UNKNOWN", {})
    await EventBus().publish(session, event)
    await session.commit()
    assert await dispatch_pending(ConsumerRegistry()) == 1
    row = await session.get(OutboxEvent, event.event_id)
    await session.refresh(row)
    assert row.status == "PENDING"
    assert row.last_error == "LookupError"


async def test_fnd_013_concurrent_workers_do_not_duplicate(session: AsyncSession) -> None:
    for _ in range(5):
        await EventBus().publish(session, DomainEvent("TEST", {}))
    await session.commit()
    registry = ConsumerRegistry()

    async def consumer(db: AsyncSession, message: DomainEvent) -> None:
        await audit.record(db, "test.consume", "event", message.event_id)
        await asyncio.sleep(0.01)

    registry.subscribe("TEST", consumer)
    results = await asyncio.gather(dispatch_pending(registry), dispatch_pending(registry))
    assert sum(results) == 5
    assert await session.scalar(select(func.count()).select_from(AuditLog)) == 5
