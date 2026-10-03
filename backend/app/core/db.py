from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import datetime
from functools import lru_cache
from types import TracebackType
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.config import get_settings
from app.core.time import new_id, utcnow

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class IdMixin:
    id: Mapped[UUID] = mapped_column(primary_key=True, default=new_id)


class CreatedAtMixin:
    # Python-side default too, so async sessions never need a lazy refresh after flush.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )


class TimestampMixin(CreatedAtMixin):
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=utcnow)


@lru_cache(maxsize=1)
def get_engine() -> AsyncEngine:
    """FND-004: async engine (pool 10 / overflow 20, pre-ping), created lazily after settings are final."""
    return create_async_engine(get_settings().database_url, pool_pre_ping=True, pool_size=10, max_overflow=20)


@lru_cache(maxsize=1)
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False, autoflush=False)


class TransactionEvents:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def publish(self, event: Any) -> None:
        from app.core.events import event_bus

        await event_bus.publish(self.session, event)


class TransactionAudit:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def record(self, action: str, entity_type: str, entity_id: UUID, **kwargs: Any) -> None:
        from app.core.audit import record

        await record(self.session, action, entity_type, entity_id, **kwargs)


class UnitOfWork:
    """FND-004: owns one session and commits business changes, events and audit together."""

    session: AsyncSession
    events: TransactionEvents
    audit: TransactionAudit

    async def __aenter__(self) -> UnitOfWork:
        self.session = get_sessionmaker()()
        self.events = TransactionEvents(self.session)
        self.audit = TransactionAudit(self.session)
        return self

    async def __aexit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, traceback: TracebackType | None
    ) -> None:
        try:
            if exc_type is not None:
                await self.session.rollback()
            else:
                try:
                    await self.session.commit()
                except BaseException:
                    await self.session.rollback()
                    raise
        finally:
            await self.session.close()


async def get_session() -> AsyncIterator[AsyncSession]:
    """Request-scoped transaction (01_GLOBAL §9.1)."""
    async with UnitOfWork() as uow:
        yield uow.session
