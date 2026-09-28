"""P00 §3.1 / FND-024: `sequences` table and `SequenceService.next`."""

from __future__ import annotations

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_sessionmaker
from app.core.sequences import SequenceService


async def _next_committed(scope: str, key: str) -> int:
    """One caller with its own session and transaction, as concurrent requests would have."""
    async with get_sessionmaker()() as session:
        value = await SequenceService(session).next(scope, key)
        await session.commit()
        return value


async def test_fnd_024_first_value_is_one_then_increments(session: AsyncSession) -> None:
    sequences = SequenceService(session)
    assert [await sequences.next("order_number", "company-a:2026") for _ in range(3)] == [1, 2, 3]
    await session.commit()
    row = (
        await session.execute(
            text("SELECT last_value FROM sequences WHERE scope = 'order_number' AND key = 'company-a:2026'")
        )
    ).scalar_one()
    assert row == 3


async def test_fnd_024_scopes_and_keys_are_independent(session: AsyncSession) -> None:
    sequences = SequenceService(session)
    assert await sequences.next("order_number", "company-a:2026") == 1
    assert await sequences.next("order_number", "company-b:2026") == 1
    assert await sequences.next("order_number", "company-a:2027") == 1
    assert await sequences.next("return_number", "company-a:2026") == 1
    assert await sequences.next("order_number", "company-a:2026") == 2


async def test_fnd_024_sequence_concurrent_unique() -> None:
    """P00 §8: 100 parallel callers -> 100 unique numbers, with no gaps."""
    values = await asyncio.gather(*(_next_committed("order_number", "company-c:2026") for _ in range(100)))
    assert sorted(values) == list(range(1, 101))


async def test_fnd_024_value_is_used_only_when_the_callers_transaction_commits(session: AsyncSession) -> None:
    """The counter moves inside the caller's transaction: a rollback returns the value to the counter."""
    sequences = SequenceService(session)
    assert await sequences.next("order_number", "company-d:2026") == 1
    await session.rollback()
    assert await sequences.next("order_number", "company-d:2026") == 1
    await session.commit()
    assert await _next_committed("order_number", "company-d:2026") == 2


async def test_sequences_table_matches_p00_data_model(session: AsyncSession) -> None:
    columns = (
        await session.execute(
            text(
                "SELECT column_name, data_type, character_maximum_length, is_nullable, column_default "
                "FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sequences' "
                "ORDER BY ordinal_position"
            )
        )
    ).all()
    assert [tuple(c) for c in columns] == [
        ("scope", "character varying", 64, "NO", None),
        ("key", "character varying", 128, "NO", None),
        ("last_value", "bigint", None, "NO", "0"),
    ]
    primary_key = (
        await session.execute(
            text("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'pk_sequences'")
        )
    ).scalar_one()
    assert primary_key == "PRIMARY KEY (scope, key)"
