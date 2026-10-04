import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import DomainEvent, event_bus
from app.core.outbox import OutboxEvent
from app.core.time import new_id
from app.modules.identity.models import Membership, Organization
from tests.factories import auth, make_user
from tests.organizations.test_create import COMPANY


async def test_org_idempotent_replay_does_not_publish_again(client: AsyncClient, session: AsyncSession) -> None:
    user = await make_user(session)
    await session.commit()
    headers = {**auth(user), "Idempotency-Key": str(new_id())}
    first = await client.post("/api/v1/organizations/companies", json=COMPANY, headers=headers)
    second = await client.post("/api/v1/organizations/companies", json=COMPANY, headers=headers)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json() == second.json()
    rows = (await session.scalars(select(OutboxEvent).order_by(OutboxEvent.created_at))).all()
    assert sorted(row.event_type for row in rows) == [
        "COMPANY_CREATED",
        "MEMBERSHIP_CREATED",
        "SUBSCRIPTION_STATUS_CHANGED",
    ]
    assert all(str(row.org_id) == first.json()["organization"]["id"] for row in rows)
    assert next(row for row in rows if row.event_type == "COMPANY_CREATED").payload["owner_id"] == str(user.id)


async def test_org_failed_handler_rolls_back_business_and_events(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await make_user(session)
    await session.commit()

    async def fail(db: AsyncSession, event: DomainEvent) -> None:
        raise RuntimeError("trial handler failed")

    monkeypatch.setattr(event_bus, "handlers", {"COMPANY_CREATED": [fail]})
    with pytest.raises(RuntimeError, match="trial handler failed"):
        await client.post("/api/v1/organizations/companies", json=COMPANY, headers=auth(user))
    assert await session.scalar(select(func.count()).select_from(Organization)) == 0
    assert await session.scalar(select(func.count()).select_from(Membership)) == 0
    assert await session.scalar(select(func.count()).select_from(OutboxEvent)) == 0


async def test_org_requires_key_and_rejects_changed_payload(client: AsyncClient, session: AsyncSession) -> None:
    user = await make_user(session)
    await session.commit()
    headers = auth(user)
    headers.pop("Idempotency-Key")
    missing = await client.post("/api/v1/organizations/companies", json=COMPANY, headers=headers)
    assert missing.status_code == 400
    assert missing.json()["error"]["code"] == "idempotency_key_required"
    headers["Idempotency-Key"] = str(new_id())
    assert (await client.post("/api/v1/organizations/companies", json=COMPANY, headers=headers)).status_code == 201
    changed = await client.post("/api/v1/organizations/companies", json={**COMPANY, "name": "Changed"}, headers=headers)
    assert changed.status_code == 409
    assert changed.json()["error"]["code"] == "idempotency_key_reused"
