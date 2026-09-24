from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.security import hash_password
from app.core.time import new_id, utcnow
from app.modules.identity.models import Membership, Organization, User


async def _user(session: AsyncSession, phone: str = "+992900000001") -> User:
    user = User(
        phone=phone, full_name="Test User", password_hash=hash_password("Tezfarmo2026"), phone_verified_at=utcnow()
    )
    session.add(user)
    await session.flush()
    return user


async def _org(session: AsyncSession, owner: User, org_type: str = "COMPANY") -> Organization:
    org = Organization(type=org_type, name="Org", created_by=owner.id)
    session.add(org)
    await session.flush()
    return org


async def test_users_phone_must_be_e164(session: AsyncSession) -> None:
    session.add(User(phone="992900", full_name="X", password_hash="h", phone_verified_at=utcnow()))
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_membership_single_owner_constraint(session: AsyncSession) -> None:
    first = await _user(session)
    second = await _user(session, "+992900000002")
    org = await _org(session, first)
    session.add(Membership(user_id=first.id, organization_id=org.id, role="OWNER", joined_at=utcnow()))
    await session.flush()
    session.add(Membership(user_id=second.id, organization_id=org.id, role="OWNER", joined_at=utcnow()))
    with pytest.raises(IntegrityError):
        await session.flush()


@pytest.mark.parametrize(("org_type", "role"), [("STORE", "MANAGER"), ("STORE", "COURIER"), ("COMPANY", "SELLER")])
async def test_membership_role_matches_org_type(session: AsyncSession, org_type: str, role: str) -> None:
    owner = await _user(session)
    org = await _org(session, owner, org_type)
    session.add(Membership(user_id=owner.id, organization_id=org.id, role=role, joined_at=utcnow()))
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_fnd_010_audit_logs_update_and_delete_forbidden(session: AsyncSession) -> None:
    await audit.record(session, "auth.login", "user", new_id())
    await session.commit()
    for statement in ("UPDATE audit_logs SET action = 'x'", "DELETE FROM audit_logs"):
        with pytest.raises(DBAPIError, match="append-only"):
            await session.execute(text(statement))
        await session.rollback()


async def test_fnd_015_audit_redacts_sensitive_fields(session: AsyncSession) -> None:
    entity = new_id()
    await audit.record(session, "auth.password_changed", "user", entity, new={"password": "secret", "language": "ru"})
    await session.commit()
    row = (await session.execute(text("SELECT new_data FROM audit_logs WHERE entity_id = :id"), {"id": entity})).one()
    assert row.new_data == {"password": "[REDACTED]", "language": "ru"}
