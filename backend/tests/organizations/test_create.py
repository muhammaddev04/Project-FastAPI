from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from tests.factories import auth, make_org, make_user


@pytest.mark.parametrize(("path", "org_type"), [("companies", "COMPANY"), ("stores", "STORE")])
async def test_org_001_002_create_makes_caller_owner(
    client: AsyncClient, session: AsyncSession, path: str, org_type: str
) -> None:
    user = await make_user(session)
    await session.commit()
    response = await client.post(f"/api/v1/organizations/{path}", json={"name": "  Pamir Trade  "}, headers=auth(user))
    assert response.status_code == 201
    body = response.json()
    assert body["organization"]["type"] == org_type
    assert body["organization"]["name"] == "Pamir Trade"
    assert body["organization"]["status"] == "ACTIVE"
    assert body["membership"]["role"] == "OWNER"
    assert body["membership"]["org_type"] == org_type
    assert "members.invite" in body["membership"]["permissions"]

    me = (await client.get("/api/v1/me", headers=auth(user))).json()
    assert [m["org_name"] for m in me["memberships"]] == ["Pamir Trade"]

    actions = (await session.execute(select(AuditLog.action).order_by(AuditLog.created_at))).scalars().all()
    assert actions == ["organization.created", "membership.created"]


async def test_org_003_owner_org_limit_5(client: AsyncClient, session: AsyncSession) -> None:
    user = await make_user(session)
    for index in range(5):
        await make_org(session, user, name=f"Org {index}")
    await session.commit()
    response = await client.post("/api/v1/organizations/stores", json={"name": "Sixth"}, headers=auth(user))
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "organization_limit_reached"
    assert error["details"] == {"max": 5, "current": 5}


async def test_create_organization_requires_authentication(client: AsyncClient) -> None:
    response = await client.post("/api/v1/organizations/companies", json={"name": "Nope"})
    assert response.status_code == 401


@pytest.mark.parametrize("payload", [{}, {"name": "A"}, {"name": "x" * 201}, {"name": "Ok", "type": "STORE"}])
async def test_create_organization_validates_payload(
    client: AsyncClient, session: AsyncSession, payload: dict[str, object]
) -> None:
    user = await make_user(session)
    await session.commit()
    response = await client.post("/api/v1/organizations/companies", json=payload, headers=auth(user))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
