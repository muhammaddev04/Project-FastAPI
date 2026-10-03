"""FND-013: durable events, locked dispatch and bounded retry."""

import logging
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, Index, SmallInteger, String, Text, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin, get_sessionmaker
from app.core.events import DomainEvent, EventHandler
from app.core.time import utcnow

logger = logging.getLogger(__name__)


class OutboxEvent(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "outbox_events"
    __table_args__ = (
        CheckConstraint("status IN ('PENDING','PROCESSED','FAILED')", name="status"),
        CheckConstraint("attempts >= 0 AND attempts <= 8", name="attempts"),
        Index("ix_outbox_events_pending", "next_attempt_at", postgresql_where=text("status = 'PENDING'")),
    )

    event_type: Mapped[str] = mapped_column(String(64))
    org_id: Mapped[UUID | None]
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(16), default="PENDING", server_default="PENDING")
    attempts: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_error: Mapped[str | None] = mapped_column(Text)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ConsumerRegistry:
    """Consumers must deduplicate external side effects using DomainEvent.event_id."""

    def __init__(self) -> None:
        self.handlers: dict[str, list[EventHandler]] = {}

    def subscribe(self, event_type: str, handler: EventHandler) -> None:
        handlers = self.handlers.setdefault(event_type, [])
        if handler not in handlers:
            handlers.append(handler)


consumers = ConsumerRegistry()


async def dispatch_pending(registry: ConsumerRegistry = consumers, *, limit: int = 100) -> int:
    processed = 0
    # Each row commits independently. Concurrent workers skip locked rows.
    for _ in range(limit):
        async with get_sessionmaker()() as session, session.begin():
            row = await session.scalar(
                select(OutboxEvent)
                .where(OutboxEvent.status == "PENDING", OutboxEvent.next_attempt_at <= utcnow())
                .order_by(OutboxEvent.next_attempt_at, OutboxEvent.id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if row is None:
                break
            await _dispatch(session, row, registry)
            processed += 1
    return processed


async def _dispatch(session: AsyncSession, row: OutboxEvent, registry: ConsumerRegistry) -> None:
    row.attempts += 1
    try:
        async with session.begin_nested():
            if not registry.handlers.get(row.event_type):
                raise LookupError("No consumer registered")
            for handler in registry.handlers.get(row.event_type, []):
                await handler(session, DomainEvent(row.event_type, row.payload, row.org_id, row.id))
            await session.flush()
    except Exception as exc:
        # Persist only the exception class: provider messages may contain secrets or private payloads.
        row.last_error = type(exc).__name__
        row.status = "FAILED" if row.attempts >= 8 else "PENDING"
        row.next_attempt_at = utcnow() + timedelta(seconds=min(2**row.attempts * 5, 3600))
        logger.warning("outbox_consumer_failed event_id=%s error=%s", row.id, type(exc).__name__)
    else:
        row.status = "PROCESSED"
        row.processed_at = utcnow()
        row.last_error = None
