from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from tests.factories import add_member, auth, make_org, make_user

COMPANY = {
    "name": "Pamir Trade",
    "legal_name": "Pamir Trade LLC",
    "tax_identifier": "510012345",
    "phone": "+992 90 123 4567",
    "city": "Dushanbe",
    "address": "Rudaki Ave 12",
}
STORE = {
    "name": "Corner Market",
    "legal_name": "IE Karimova N.",
    "phone": "+992901112233",
    "city": "Khujand",
    "address": "Lenin St 4",
}


async def test_org_001_create_company_creates_owner_membership_and_code(
    client: AsyncClient, session: AsyncSession
) -> None:
    user = await make_user(session)
    await session.commit()
    response = await client.post("/api/v1/organizations/companies", json=COMPANY, headers=auth(user))
    assert response.status_code == 201, response.text
    body = response.json()
    org = body["organization"]
    assert org["type"] == "COMPANY" and org["name"] == "Pamir Trade" and org["legal_name"] == "Pamir Trade LLC"
    assert org["phone"] == "+992901234567"
    assert org["verification_status"] == "NOT_SUBMITTED" and org["legal_locked"] is False
    assert len(org["public_code"]) == 8 and not set(org["public_code"]) & set("0O1I")
    assert body["membership"]["role"] == "OWNER"
    assert "verification.submit" in body["membership"]["permissions"]
    actions = (await session.execute(select(AuditLog.action).order_by(AuditLog.created_at))).scalars().all()
    assert actions == ["organization.created", "membership.created"]


async def test_org_002_create_store_with_optional_tax_id_and_coordinates(
    client: AsyncClient, session: AsyncSession
) -> None:
    user = await make_user(session)
    await session.commit()
    payload = {**STORE, "latitude": "38.559772", "longitude": "68.787038"}
    response = await client.post("/api/v1/organizations/stores", json=payload, headers=auth(user))
    assert response.status_code == 201, response.text
    org = response.json()["organization"]
    assert org["type"] == "STORE" and org["tax_identifier"] is None and org["public_code"] is None
    assert org["latitude"] == "38.559772" and org["longitude"] == "68.787038"


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({**COMPANY, "tax_identifier": "12345"}, "tax_identifier"),
        ({**COMPANY, "tax_identifier": "12345678901234"}, "tax_identifier"),
        ({**COMPANY, "phone": "+99290123"}, "phone"),
        ({k: v for k, v in COMPANY.items() if k != "tax_identifier"}, "tax_identifier"),
        ({**COMPANY, "email": "not-an-email"}, "email"),
        ({**COMPANY, "revenue": "1000000"}, "revenue"),
    ],
)
async def test_org_004_company_payload_validated_server_side(
    client: AsyncClient, session: AsyncSession, payload: dict[str, Any], field: str
) -> None:
    user = await make_user(session)
    await session.commit()
    response = await client.post("/api/v1/organizations/companies", json=payload, headers=auth(user))
    assert response.status_code == 422
    assert field in [item["field"] for item in response.json()["error"]["details"]["fields"]]


async def test_org_004_tax_identifier_unique(client: AsyncClient, session: AsyncSession) -> None:
    first, second = await make_user(session), await make_user(session)
    await session.commit()
    assert (await client.post("/api/v1/organizations/companies", json=COMPANY, headers=auth(first))).status_code == 201
    response = await client.post(
        "/api/v1/organizations/companies", json={**COMPANY, "name": "Copy"}, headers=auth(second)
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "tax_identifier_taken"


async def test_store_coordinates_both_or_none(client: AsyncClient, session: AsyncSession) -> None:
    user = await make_user(session)
    await session.commit()
    response = await client.post("/api/v1/organizations/stores", json={**STORE, "latitude": "38.5"}, headers=auth(user))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_coordinates"
    out_of_range = await client.post(
        "/api/v1/organizations/stores", json={**STORE, "latitude": "91", "longitude": "10"}, headers=auth(user)
    )
    assert out_of_range.status_code == 422


async def test_org_003_owner_org_limit_5(client: AsyncClient, session: AsyncSession) -> None:
    user = await make_user(session)
    for index in range(5):
        await make_org(session, user, name=f"Org {index}")
    await session.commit()
    response = await client.post("/api/v1/organizations/stores", json=STORE, headers=auth(user))
    assert response.status_code == 409
    assert response.json()["error"] == {
        "code": "organization_limit_reached",
        "message": response.json()["error"]["message"],
        "details": {"max": 5, "current": 5},
        "request_id": response.json()["error"]["request_id"],
    }


async def test_create_organization_requires_authentication(client: AsyncClient) -> None:
    assert (await client.post("/api/v1/organizations/companies", json=COMPANY)).status_code == 401


async def test_get_organization_profile_for_every_member(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner, "COMPANY", "Pamir")
    courier = await make_user(session)
    await add_member(session, org, courier, "COURIER")
    await session.commit()
    response = await client.get("/api/v1/organization", headers=auth(courier, org))
    assert response.status_code == 200
    assert response.json()["verification_status"] == "NOT_SUBMITTED"


async def test_org_005_legal_fields_locked_after_approval(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner, "COMPANY", "Pamir", verification_status="APPROVED")
    await session.commit()
    headers = auth(owner, org)
    profile = (await client.get("/api/v1/organization", headers=headers)).json()
    assert profile["legal_locked"] is True
    locked = await client.patch(
        "/api/v1/organization", json={"version": 1, "legal_name": "New Name LLC"}, headers=headers
    )
    assert locked.status_code == 409 and locked.json()["error"]["code"] == "verification_not_editable"
    contacts = await client.patch(
        "/api/v1/organization", json={"version": 1, "address": "New street 5"}, headers=headers
    )
    assert contacts.status_code == 200 and contacts.json()["address"] == "New street 5"
    audit_row = (await session.execute(select(AuditLog).where(AuditLog.action == "organization.updated"))).scalar_one()
    assert audit_row.new_data == {"address": "New street 5"}


async def test_org_006_manager_cannot_edit_legal(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner, "COMPANY", "Pamir")
    manager = await make_user(session)
    await add_member(session, org, manager, "MANAGER")
    await session.commit()
    headers = auth(manager, org)
    legal = await client.patch("/api/v1/organization", json={"version": 1, "legal_name": "X LLC"}, headers=headers)
    assert legal.status_code == 403 and legal.json()["error"]["code"] == "permission_denied"
    contacts = await client.patch(
        "/api/v1/organization", json={"version": 1, "phone": "+992900009999"}, headers=headers
    )
    assert contacts.status_code == 200


async def test_organization_update_version_conflict(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner, "STORE", "Corner")
    await session.commit()
    headers = auth(owner, org)
    assert (
        await client.patch("/api/v1/organization", json={"version": 1, "city": "Bokhtar"}, headers=headers)
    ).status_code == 200
    stale = await client.patch("/api/v1/organization", json={"version": 1, "city": "Kulob"}, headers=headers)
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "version_conflict"


@pytest.mark.parametrize(
    ("org_type", "role", "field", "expected"),
    [
        ("COMPANY", "OPERATOR", "address", 403),
        ("COMPANY", "WAREHOUSE", "address", 403),
        ("COMPANY", "COURIER", "address", 403),
        ("COMPANY", "MANAGER", "address", 200),
        ("STORE", "SELLER", "address", 403),
    ],
)
async def test_permission_matrix_p02_edit_contacts(
    client: AsyncClient, session: AsyncSession, org_type: str, role: str, field: str, expected: int
) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner, org_type)
    member = await make_user(session)
    await add_member(session, org, member, role)
    await session.commit()
    response = await client.patch(
        "/api/v1/organization", json={"version": 1, field: "Somewhere 1"}, headers=auth(member, org)
    )
    assert response.status_code == expected
