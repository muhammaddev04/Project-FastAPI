from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.modules.identity.models import Membership
from tests.factories import add_member, auth, make_org, make_user

ROLE_MATRIX = [
    ("COMPANY", "OWNER", 200),
    ("COMPANY", "MANAGER", 200),
    ("COMPANY", "OPERATOR", 403),
    ("COMPANY", "WAREHOUSE", 403),
    ("COMPANY", "COURIER", 403),
    ("STORE", "OWNER", 200),
    ("STORE", "SELLER", 403),
]


async def test_iam_010_org_header_required(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    await make_org(session, owner)
    await session.commit()
    response = await client.get("/api/v1/members", headers=auth(owner))
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "org_context_required"


async def test_iam_010_foreign_org_404(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    outsider = await make_user(session)
    org = await make_org(session, owner)
    await make_org(session, outsider)
    await session.commit()
    response = await client.get("/api/v1/members", headers=auth(outsider, org))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


async def test_iam_010_malformed_org_id_404(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    await session.commit()
    response = await client.get("/api/v1/members", headers={**auth(owner), "X-Org-Id": "not-a-uuid"})
    assert response.status_code == 404


async def test_iam_010_blocked_org_403(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    org.status = "BLOCKED"
    await session.commit()
    response = await client.get("/api/v1/members", headers=auth(owner, org))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "organization_blocked"


@pytest.mark.parametrize("status", ["SUSPENDED", "REVOKED"])
async def test_iam_014_inactive_membership_immediate_403(
    client: AsyncClient, session: AsyncSession, status: str
) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    manager = await make_user(session)
    membership = await add_member(session, org, manager, "MANAGER")
    await session.commit()
    headers = auth(manager, org)
    assert (await client.get("/api/v1/members", headers=headers)).status_code == 200

    membership.status = status
    await session.commit()
    response = await client.get("/api/v1/members", headers=headers)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "membership_inactive"


@pytest.mark.parametrize(("org_type", "role", "expected"), ROLE_MATRIX)
async def test_permission_matrix_p01_members_view(
    client: AsyncClient, session: AsyncSession, org_type: str, role: str, expected: int
) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner, org_type)
    actor = owner if role == "OWNER" else await make_user(session)
    if role != "OWNER":
        await add_member(session, org, actor, role)
    await session.commit()
    response = await client.get("/api/v1/members", headers=auth(actor, org))
    assert response.status_code == expected
    if expected == 403:
        assert response.json()["error"]["code"] == "permission_denied"


async def test_members_list_filters_search_and_paginates(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session, full_name="Owner Person")
    org = await make_org(session, owner)
    await add_member(session, org, await make_user(session, full_name="Farrukh Operator"), "OPERATOR")
    await add_member(session, org, await make_user(session, full_name="Sitora Warehouse"), "WAREHOUSE")
    await add_member(session, org, await make_user(session, full_name="Rustam Courier"), "COURIER", status="SUSPENDED")
    await session.commit()
    headers = auth(owner, org)

    page = (await client.get("/api/v1/members", params={"limit": 2}, headers=headers)).json()
    assert page["count"] == 4 and page["limit"] == 2 and len(page["results"]) == 2
    assert set(page["results"][0]) == {"id", "user_id", "full_name", "phone", "role", "status", "joined_at"}

    by_role = (await client.get("/api/v1/members", params={"role": "WAREHOUSE"}, headers=headers)).json()
    assert [m["full_name"] for m in by_role["results"]] == ["Sitora Warehouse"]

    by_status = (await client.get("/api/v1/members", params={"status": "SUSPENDED"}, headers=headers)).json()
    assert [m["full_name"] for m in by_status["results"]] == ["Rustam Courier"]

    searched = (await client.get("/api/v1/members", params={"search": "farr"}, headers=headers)).json()
    assert [m["full_name"] for m in searched["results"]] == ["Farrukh Operator"]

    too_many = await client.get("/api/v1/members", params={"limit": 101}, headers=headers)
    assert too_many.status_code == 422


async def test_membership_single_owner_constraint(session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    session.add(
        Membership(user_id=(await make_user(session)).id, organization_id=org.id, role="OWNER", joined_at=utcnow())
    )
    with pytest.raises(IntegrityError):
        await session.flush()


@pytest.mark.parametrize(("org_type", "role"), [("STORE", "MANAGER"), ("STORE", "COURIER"), ("COMPANY", "SELLER")])
async def test_membership_role_matches_org_type(session: AsyncSession, org_type: str, role: str) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner, org_type)
    session.add(
        Membership(user_id=(await make_user(session)).id, organization_id=org.id, role=role, joined_at=utcnow())
    )
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_user_email_unique_case_insensitive(session: AsyncSession) -> None:
    await make_user(session, email="owner@example.tj")
    with pytest.raises(IntegrityError):
        await make_user(session, email="Owner@Example.tj")
