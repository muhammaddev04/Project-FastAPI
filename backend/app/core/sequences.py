"""P00 §3.1 / FND-024: named counters for human-visible numbers (e.g. `ORD-2026-000123`).

A counter is addressed by `(scope, key)`, e.g. `("order_number", "<company_id>:2026")`. `next()` is the TZ's single
atomic statement `INSERT … ON CONFLICT DO UPDATE SET last_value = last_value + 1 RETURNING last_value`: the first call
for a pair returns 1, every further call the next integer.

The statement runs in the caller's transaction and keeps the counter row locked until that transaction ends, so
concurrent callers get distinct values and a value is only used if the caller's transaction commits (a rollback
returns it to the counter).
"""

from __future__ import annotations

from sqlalchemy import BigInteger, String, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class NumberSequence(Base):
    """P00 §3.1 `sequences`: one row per `(scope, key)` counter."""

    __tablename__ = "sequences"

    scope: Mapped[str] = mapped_column(String(64), primary_key=True)
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    last_value: Mapped[int] = mapped_column(BigInteger, default=0, server_default=text("0"))


class SequenceService:
    """FND-024 `SequenceService.next(scope, key) -> int` within the given session's transaction."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def next(self, scope: str, key: str) -> int:
        statement = (
            insert(NumberSequence)
            .values(scope=scope, key=key, last_value=1)
            .on_conflict_do_update(
                index_elements=[NumberSequence.scope, NumberSequence.key],
                set_={"last_value": NumberSequence.last_value + 1},
            )
            .returning(NumberSequence.last_value)
        )
        value: int = (await self._session.execute(statement)).scalar_one()
        return value
