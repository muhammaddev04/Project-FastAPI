from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.time import new_id


async def test_fnd_010_audit_logs_update_and_delete_forbidden(session: AsyncSession) -> None:
    await audit.record(session, "test.action", "thing", new_id())
    await session.commit()
    for statement in ("UPDATE audit_logs SET action = 'x'", "DELETE FROM audit_logs"):
        with pytest.raises(DBAPIError, match="append-only"):
            await session.execute(text(statement))
        await session.rollback()


async def test_fnd_015_audit_redacts_sensitive_fields(session: AsyncSession) -> None:
    entity = new_id()
    await audit.record(session, "test.action", "thing", entity, new={"password": "secret", "language": "ru"})
    await session.commit()
    row = (await session.execute(text("SELECT new_data FROM audit_logs WHERE entity_id = :id"), {"id": entity})).one()
    assert row.new_data == {"password": "[REDACTED]", "language": "ru"}
