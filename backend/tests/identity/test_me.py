from __future__ import annotations

from datetime import timedelta

import jwt
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.config import get_settings
from tests.factories import add_member, auth, make_org, make_user, token_for


async def test_me_requires_authentication(client: AsyncClient) -> None:
    response = await client.get("/api/v1/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"


async def test_me_returns_user_and_memberships_with_permissions(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session, full_name="Dilshod Rahimov")
    company = await make_org(session, owner, "COMPANY", "Pamir Distribution")
    store_owner = await make_user(session)
    store = await make_org(session, store_owner, "STORE", "Corner Market")
    await add_member(session, store, owner, "SELLER")
    await session.commit()

    response = await client.get("/api/v1/me", headers=auth(owner))
    assert response.status_code == 200
    body = response.json()
    assert body["full_name"] == "Dilshod Rahimov"
    # CR-001: email is the identifier and always present; phone is an optional contact.
    assert body["email"].endswith("@example.tj") and body["email_verified"] is True
    assert "password_hash" not in body and "token_version" not in body
    memberships = {m["org_name"]: m for m in body["memberships"]}
    assert memberships["Pamir Distribution"]["org_type"] == "COMPANY"
    assert memberships["Pamir Distribution"]["role"] == "OWNER"
    assert memberships["Pamir Distribution"]["permissions"] == [
        "members.change_role",
        "members.invite",
        "members.revoke",
        "members.suspend",
        "members.view",
        "org.edit_contacts",
        "org.edit_legal",
        "org.view",
        "verification.submit",
        "verification.view",
    ]
    assert memberships["Corner Market"]["org_type"] == "STORE"
    assert memberships["Corner Market"]["role"] == "SELLER"
    assert memberships["Corner Market"]["permissions"] == ["org.view"]
    assert company.id and store.id


async def test_me_hides_revoked_and_strips_permissions_from_suspended(
    client: AsyncClient, session: AsyncSession
) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner, "COMPANY", "Org A")
    other_org = await make_org(session, owner, "COMPANY", "Org B")
    manager = await make_user(session)
    await add_member(session, org, manager, "MANAGER", status="SUSPENDED")
    await add_member(session, other_org, manager, "MANAGER", status="REVOKED")
    await session.commit()

    memberships = (await client.get("/api/v1/me", headers=auth(manager))).json()["memberships"]
    assert [(m["org_name"], m["status"], m["permissions"]) for m in memberships] == [("Org A", "SUSPENDED", [])]


async def test_iam_005_expired_token_rejected(client: AsyncClient, session: AsyncSession) -> None:
    user = await make_user(session)
    await session.commit()
    response = await client.get(
        "/api/v1/me", headers={"Authorization": f"Bearer {token_for(user, ttl=timedelta(seconds=-5))}"}
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "token_expired"


async def test_iam_005_access_token_rejected_after_token_version_bump(
    client: AsyncClient, session: AsyncSession
) -> None:
    user = await make_user(session)
    await session.commit()
    stale = token_for(user)
    user.token_version += 1
    await session.commit()
    response = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {stale}"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "token_invalid"


@pytest.mark.parametrize(
    "token",
    [
        "not-a-jwt",
        jwt.encode({"sub": "x", "typ": "access", "exp": 9999999999}, "wrong-secret-wrong-secret-wrong-secret", "HS256"),
    ],
)
async def test_iam_005_malformed_or_forged_token_rejected(client: AsyncClient, token: str) -> None:
    response = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "token_invalid"


async def test_iam_005_non_access_token_type_rejected(client: AsyncClient, session: AsyncSession) -> None:
    user = await make_user(session)
    await session.commit()
    forged = jwt.encode(
        {"sub": str(user.id), "typ": "registration", "tv": 1, "exp": 9999999999},
        get_settings().jwt_access_secret,
        "HS256",
    )
    response = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {forged}"})
    assert response.status_code == 401


async def test_iam_009_blocked_user_rejected(client: AsyncClient, session: AsyncSession) -> None:
    user = await make_user(session, status="BLOCKED")
    await session.commit()
    response = await client.get("/api/v1/me", headers=auth(user))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "user_blocked"


async def test_patch_me_updates_name_and_language_with_audit(client: AsyncClient, session: AsyncSession) -> None:
    user = await make_user(session)
    await session.commit()
    response = await client.patch(
        "/api/v1/me", json={"full_name": "  Nigina Karimova ", "language": "ru"}, headers=auth(user)
    )
    assert response.status_code == 200
    assert response.json()["full_name"] == "Nigina Karimova"
    assert response.json()["language"] == "ru"
    audit_row = (await session.execute(select(AuditLog).where(AuditLog.entity_id == user.id))).scalar_one()
    assert audit_row.action == "user.updated" and audit_row.actor_id == user.id


@pytest.mark.parametrize(
    "payload",
    [{"language": "de"}, {"full_name": "A"}, {"phone": "+992900000000"}, {"is_superadmin": True}],
)
async def test_patch_me_rejects_invalid_or_protected_fields(
    client: AsyncClient, session: AsyncSession, payload: dict[str, object]
) -> None:
    user = await make_user(session)
    await session.commit()
    response = await client.patch("/api/v1/me", json=payload, headers=auth(user))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
