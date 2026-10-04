import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from tests.factories import add_member, auth, make_org, make_user
from tests.verification.test_verification import PDF, request_id, setup

ROLES = [("COMPANY", role) for role in ("OWNER", "MANAGER", "OPERATOR", "WAREHOUSE", "COURIER")] + [
    ("STORE", "OWNER"),
    ("STORE", "SELLER"),
]


@pytest.mark.parametrize("org_type,role", ROLES)
@pytest.mark.parametrize("operation", ["view", "contacts", "legal", "verification_view", "submit", "review"])
async def test_permission_matrix_p02_all_cells(
    client: AsyncClient, session: AsyncSession, org_type: str, role: str, operation: str
) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner, org_type)
    actor = owner
    if role != "OWNER":
        actor = await make_user(session)
        await add_member(session, org, actor, role)
    await session.commit()
    headers = auth(actor, org)
    if operation == "view":
        response = await client.get("/api/v1/organization", headers=headers)
        expected = 200
    elif operation in ("contacts", "legal"):
        response = await client.patch(
            "/api/v1/organization",
            headers=headers,
            json={"version": 1, "city" if operation == "contacts" else "legal_name": "New value"},
        )
        expected = 200 if role == "OWNER" or (operation == "contacts" and role == "MANAGER") else 403
    elif operation == "verification_view":
        response = await client.get("/api/v1/verification", headers=headers)
        expected = 200 if role in ("OWNER", "MANAGER") else 403
    elif operation == "submit":
        response = await client.post("/api/v1/verification", headers=headers, json={"documents": []})
        expected = 422 if role == "OWNER" else 403
    else:
        response = await client.get("/api/v1/admin/verifications", headers=headers)
        expected = 403
    assert response.status_code == expected, response.text


async def test_suspended_org_reads_but_cannot_upload(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, _ = await setup(session)
    org.status = "SUSPENDED"
    await session.commit()
    assert (await client.get("/api/v1/organization", headers=auth(owner, org))).status_code == 200
    result = await client.post(
        "/api/v1/files",
        headers=auth(owner, org),
        data={"category": "VERIFICATION"},
        files={"file": ("reg.pdf", PDF, "application/pdf")},
    )
    assert result.status_code == 403
    assert result.json()["error"]["code"] == "organization_blocked"
    team = await client.post(
        "/api/v1/members/invitations",
        headers=auth(owner, org),
        json={"email": "recipient@example.tj", "role": "MANAGER"},
    )
    assert team.status_code == 403
    assert team.json()["error"]["code"] == "organization_blocked"


@pytest.mark.parametrize("table", ["verification_requests", "verification_documents", "stored_files"])
async def test_ver_005_database_preserves_documents_and_requests(
    client: AsyncClient, session: AsyncSession, table: str
) -> None:
    owner, org, _ = await setup(session)
    await request_id(client, owner, org)
    with pytest.raises(DBAPIError):
        async with session.begin_nested():
            await session.execute(text(f"DELETE FROM {table}"))
