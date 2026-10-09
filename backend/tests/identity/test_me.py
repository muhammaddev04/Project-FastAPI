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
    assert memberships["Pamir Distribution"]["permissions"] == sorted(
        [
            "adjustments.approve",
            "adjustments.create",
            "catalog.manage",
            "catalog.view",
            "delivery.act_any",
            "delivery.act_own",
            "delivery.manual_confirm",
            "delivery.plan",
            "delivery.regenerate_code",
            "delivery.view_all",
            "disputes.message",
            "disputes.resolve",
            "disputes.review",
            "disputes.view",
            "finance.view",
            "import.run",
            "members.change_role",
            "members.invite",
            "members.revoke",
            "members.suspend",
            "members.view",
            "org.edit_branding",
            "org.edit_contacts",
            "org.edit_legal",
            "org.view",
            "orders.assemble",
            "orders.cancel",
            "orders.confirm",
            "orders.create",
            "orders.discount",
            "orders.override",
            "orders.reattempt",
            "orders.reject",
            "orders.view",
            "partners.manage",
            "partners.terminate",
            "partners.view",
            "payments.confirm",
            "payments.record",
            "payments.reject",
            "pricing.manage",
            "pricing.view",
            # P12 §1.2: a company owner reads every report family.
            "reports.delivery",
            "reports.finance",
            "reports.funnel",
            "reports.inventory",
            "reports.returns",
            "reports.sales",
            "returns.approve",
            "returns.complete",
            "returns.receive",
            "returns.view",
            "stock.adjust",
            "stock.receive",
            "stock.settings",
            "stock.view",
            "stock.write_off",
            "subscription.manage",
            "subscription.view",
            "terms.manage",
            "terms.manage_credit",
            "terms.view",
            "verification.submit",
            "verification.view",
        ]
    )
    assert memberships["Corner Market"]["org_type"] == "STORE"
    assert memberships["Corner Market"]["role"] == "SELLER"
    assert memberships["Corner Market"]["permissions"] == sorted(
        [
            "cart.manage",
            "delivery.view_store",
            "disputes.view",
            "org.view",
            "orders.cancel",
            "orders.create",
            "orders.view",
            "partners.view",
            "returns.view",
            "store_catalog.view",
            "terms.view",
        ]
    )
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


async def test_patch_me_without_phone_keeps_existing_phone(client: AsyncClient, session: AsyncSession) -> None:
    user = await make_user(session, phone="+992900000001")
    await session.commit()
    response = await client.patch("/api/v1/me", json={"language": "en"}, headers=auth(user))
    assert response.status_code == 200
    assert response.json()["phone"] == "+992900000001"
    await session.refresh(user)
    assert user.phone == "+992900000001"


async def test_patch_me_sets_contact_phone_without_verification(client: AsyncClient, session: AsyncSession) -> None:
    """CR-003: phone is an editable contact (normalised to E.164); CR-001: it never becomes a login identifier."""
    user = await make_user(session, phone=None)
    await session.commit()
    response = await client.patch("/api/v1/me", json={"phone": "+992 (90) 000-00-00"}, headers=auth(user))
    assert response.status_code == 200
    assert response.json()["phone"] == "+992900000000"
    assert response.json()["phone_verified_at"] is None
    await session.refresh(user)
    assert user.phone == "+992900000000" and user.phone_verified_at is None
    audit_row = (await session.execute(select(AuditLog).where(AuditLog.entity_id == user.id))).scalar_one()
    assert audit_row.action == "user.updated" and audit_row.new_data == {"phone": "+992900000000"}

    login = await client.post("/api/v1/auth/login", json={"phone": "+992900000000", "password": "Tezfarmo2026"})
    assert login.status_code == 422
    assert login.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("cleared", [None, "", "   "])
async def test_patch_me_clears_phone(client: AsyncClient, session: AsyncSession, cleared: str | None) -> None:
    user = await make_user(session, phone="+992900000002")
    await session.commit()
    response = await client.patch("/api/v1/me", json={"phone": cleared}, headers=auth(user))
    assert response.status_code == 200
    assert response.json()["phone"] is None and response.json()["phone_verified_at"] is None
    await session.refresh(user)
    assert user.phone is None and user.phone_verified_at is None
    audit_row = (await session.execute(select(AuditLog).where(AuditLog.entity_id == user.id))).scalar_one()
    assert audit_row.old_data == {"phone": "+992900000002"} and audit_row.new_data == {"phone": None}


async def test_patch_me_rejects_phone_of_another_user(client: AsyncClient, session: AsyncSession) -> None:
    await make_user(session, phone="+992900000003")
    user = await make_user(session, phone="+992900000004")
    await session.commit()
    response = await client.patch("/api/v1/me", json={"phone": "+992 900 000 003"}, headers=auth(user))
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "phone_taken" and error["message"] != "errors.phone_taken"
    assert set(error) == {"code", "message", "details", "request_id"}
    await session.refresh(user)
    assert user.phone == "+992900000004"

    # Re-submitting one's own number is not a conflict.
    own = await client.patch("/api/v1/me", json={"phone": "+992900000004"}, headers=auth(user))
    assert own.status_code == 200


async def test_patch_me_phone_race_lost_on_unique_constraint_is_409(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A concurrent request that takes the phone after the pre-check still ends in 409, not a 500."""

    async def _no_precheck(*_args: object) -> None:
        return None

    monkeypatch.setattr("app.modules.identity.service._ensure_phone_free", _no_precheck)
    await make_user(session, phone="+992900000005")
    user = await make_user(session, phone="+992900000006")
    await session.commit()
    response = await client.patch("/api/v1/me", json={"phone": "+992900000005", "language": "ru"}, headers=auth(user))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "phone_taken"
    assert "uq_users_phone" not in response.text
    await session.refresh(user)
    assert user.phone == "+992900000006" and user.language == "tg"


@pytest.mark.parametrize(
    "payload",
    [
        {"language": "de"},
        {"full_name": "A"},
        {"phone": "992900000000"},
        {"phone": "+0123456789"},
        {"phone": 992900000000},
        {"phone_verified_at": "2026-09-27T00:00:00Z"},
        {"email": "other@example.tj"},
        {"is_superadmin": True},
    ],
)
async def test_patch_me_rejects_invalid_or_protected_fields(
    client: AsyncClient, session: AsyncSession, payload: dict[str, object]
) -> None:
    user = await make_user(session)
    await session.commit()
    response = await client.patch("/api/v1/me", json=payload, headers=auth(user))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
