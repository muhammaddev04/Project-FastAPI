import asyncio

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.identity.models import Membership
from app.modules.organizations import ports, service
from app.modules.organizations.models import Company
from tests.factories import auth, make_org, make_user
from tests.organizations.test_create import COMPANY, STORE


async def test_org_003_parallel_creation_cannot_exceed_five(client: AsyncClient, session: AsyncSession) -> None:
    user = await make_user(session)
    for _ in range(4):
        await make_org(session, user, "STORE")
    await session.commit()
    responses = await asyncio.gather(
        *[
            client.post("/api/v1/organizations/stores", json={**STORE, "name": f"Parallel {index}"}, headers=auth(user))
            for index in range(2)
        ]
    )
    assert sorted(response.status_code for response in responses) == [201, 409]
    assert await session.scalar(select(func.count()).select_from(Membership).where(Membership.user_id == user.id)) == 5


async def test_org_001_retries_insert_time_public_code_collision(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = await make_org(session, await make_user(session))
    existing = await session.get(Company, first.id)
    assert existing is not None
    codes = iter([existing.public_code, "ZZZZZZZ9"])

    async def collision(_session: AsyncSession) -> str:
        return next(codes)

    monkeypatch.setattr(service, "_unique_public_code", collision)
    owner = await make_user(session)
    await session.commit()
    result = await client.post("/api/v1/organizations/companies", json=COMPANY, headers=auth(owner))
    assert result.status_code == 201, result.text
    assert result.json()["organization"]["public_code"] == "ZZZZZZZ9"


async def test_org_update_parallel_versions_allow_one_writer(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    await session.commit()
    responses = await asyncio.gather(
        *[
            client.patch("/api/v1/organization", json={"version": 1, "city": city}, headers=auth(owner, org))
            for city in ("Dushanbe", "Khujand")
        ]
    )
    assert sorted(response.status_code for response in responses) == [200, 409]


async def test_org_001_trial_starter_is_transactional_and_replay_safe(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []

    class Starter:
        async def start_trial(self, db: AsyncSession, company_id: object) -> None:
            assert db.in_transaction()
            calls.append(str(company_id))

    monkeypatch.setattr(ports, "subscription_starter", Starter())
    owner = await make_user(session)
    await session.commit()
    headers = auth(owner)
    first = await client.post("/api/v1/organizations/companies", json=COMPANY, headers=headers)
    replay = await client.post("/api/v1/organizations/companies", json=COMPANY, headers=headers)
    assert first.status_code == replay.status_code == 201
    assert calls == [first.json()["organization"]["id"]]


@pytest.mark.parametrize("field", ["name", "legal_name", "phone", "city", "address"])
async def test_required_profile_fields_cannot_be_null(client: AsyncClient, session: AsyncSession, field: str) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    await session.commit()
    result = await client.patch("/api/v1/organization", headers=auth(owner, org), json={"version": 1, field: None})
    assert result.status_code == 422
    assert result.json()["error"]["code"] == "validation_error"
