"""FND-012: transactional domain handlers and durable publication."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import new_id


@dataclass(frozen=True)
class DomainEvent:
    event_type: str
    payload: dict[str, Any]
    org_id: UUID | None = None
    event_id: UUID = field(default_factory=new_id)


EventHandler = Callable[[AsyncSession, DomainEvent], Awaitable[None]]


class EventBus:
    def __init__(self) -> None:
        self.handlers: dict[str, list[EventHandler]] = {}

    def subscribe(self, event_type: str, handler: EventHandler) -> None:
        handlers = self.handlers.setdefault(event_type, [])
        if handler not in handlers:
            handlers.append(handler)

    async def publish(self, session: AsyncSession, event: DomainEvent) -> None:
        from app.core.outbox import OutboxEvent

        # A handler failure rolls back its changes and the event together, even if caught by the caller.
        async with session.begin_nested():
            for handler in self.handlers.get(event.event_type, []):
                await handler(session, event)
            session.add(
                OutboxEvent(
                    id=event.event_id,
                    event_type=event.event_type,
                    org_id=event.org_id,
                    payload=event.payload,
                )
            )
            await session.flush()


event_bus = EventBus()
