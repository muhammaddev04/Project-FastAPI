import asyncio
from datetime import timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_sessionmaker
from app.core.outbox import OutboxEvent
from app.core.permissions import permissions_for
from app.core.time import utcnow
from app.modules.catalog.models import PriceList
from app.modules.organizations.models import Company, Store
from app.modules.partnerships import ports, service
from app.modules.partnerships.models import Partnership, PartnershipTerms
from app.modules.subscriptions.models import Plan, Subscription
from tests.factories import add_member, auth, make_org, make_user


async def prepared(session: AsyncSession):
    owner = await make_user(session)
    company = await make_org(session, owner, verification_status="APPROVED")
    store = await make_org(session, owner, "STORE", "Shop", verification_status="APPROVED")
    price_list = PriceList(company_id=company.id, code="DEFAULT", name="Default", is_default=True)
    session.add(price_list)
    await session.commit()
    terms = {
        "price_list_id": str(price_list.id),
        "payment_methods": ["CASH"],
        "credit_limit": "100.00",
        "credit_days": 14,
    }
    return owner, company, store, terms


async def invited(client: AsyncClient, session: AsyncSession):
    owner, company, store, terms = await prepared(session)
    result = await client.post(
        "/api/v1/partnerships/invite", headers=auth(owner, company), json={"store_id": str(store.id), "terms": terms}
    )
    assert result.status_code == 201, result.text
    return owner, company, store, terms, result.json()["id"]


async def activated(client: AsyncClient, session: AsyncSession):
    data = await invited(client, session)
    owner, _, store, _, pid = data
    result = await client.post(f"/api/v1/partnerships/{pid}/accept", headers=auth(owner, store), json={})
    assert result.status_code == 200, result.text
    return data


async def test_prt_002_open_partnership_unique_constraint_and_service(client: AsyncClient, session: AsyncSession):
    owner, company, store, terms, pid = await invited(client, session)
    result = await client.post(
        "/api/v1/partnerships/invite", headers=auth(owner, company), json={"store_id": str(store.id), "terms": terms}
    )
    assert result.status_code == 409 and result.json()["error"]["code"] == "partnership_exists"
    async with session.begin_nested():
        session.add(
            Partnership(company_id=company.id, store_id=store.id, initiated_by_side="COMPANY", initiated_by=owner.id)
        )
        with pytest.raises(IntegrityError):
            await session.flush()
    assert await session.scalar(select(func.count()).select_from(Partnership)) == 1
    assert pid


async def test_prt_002_new_partnership_allowed_after_terminated(client: AsyncClient, session: AsyncSession):
    owner, company, store, terms, pid = await activated(client, session)
    assert (
        await client.post(
            f"/api/v1/partnerships/{pid}/terminate", headers=auth(owner, store), json={"reason": "Changed supplier"}
        )
    ).status_code == 200
    result = await client.post(
        "/api/v1/partnerships/invite", headers=auth(owner, company), json={"store_id": str(store.id), "terms": terms}
    )
    assert result.status_code == 201 and result.json()["id"] != pid
    assert await session.scalar(select(func.count()).select_from(PartnershipTerms)) == 2


@pytest.mark.parametrize("side", ["COMPANY", "STORE"])
async def test_prt_003_activation_requires_both_verified(client: AsyncClient, session: AsyncSession, side: str):
    owner, company, store, _, pid = await invited(client, session)
    profile = await session.get(Company if side == "COMPANY" else Store, company.id if side == "COMPANY" else store.id)
    profile.verification_status = "PENDING"
    await session.commit()
    result = await client.post(f"/api/v1/partnerships/{pid}/accept", headers=auth(owner, store), json={})
    assert result.status_code == 403
    assert result.json()["error"]["details"]["side"] == side


async def test_prt_004_lookup_exact_match_only(client: AsyncClient, session: AsyncSession):
    owner, company, store, _ = await prepared(session)
    profile = await session.get(Store, store.id)
    phone = profile.phone
    profile.tax_identifier = "123456789"
    await session.commit()
    for query in [{"phone": phone}, {"tax_identifier": "123456789"}]:
        result = await client.get("/api/v1/partnerships/store-lookup", headers=auth(owner, company), params=query)
        assert result.status_code == 200 and result.json() == [
            {"id": str(store.id), "name": profile.legal_name, "city": profile.city}
        ]
    for query in [{"phone": phone[:-1]}, {"tax_identifier": "123"}]:
        assert (
            await client.get("/api/v1/partnerships/store-lookup", headers=auth(owner, company), params=query)
        ).json() == []
    assert (await client.get("/api/v1/partnerships/store-lookup", headers=auth(owner, company))).status_code == 422


async def test_store_request_accept_and_idempotency(client: AsyncClient, session: AsyncSession):
    owner, company, store, terms = await prepared(session)
    profile = await session.get(Company, company.id)
    headers = auth(owner, store)
    payload = {"company_public_code": profile.public_code}
    result = await client.post("/api/v1/partnerships/request", headers=headers, json=payload)
    assert result.status_code == 201, result.text
    assert (await client.post("/api/v1/partnerships/request", headers=headers, json=payload)).json() == result.json()
    pid = result.json()["id"]
    assert result.json()["current_terms"] is None
    assert (
        await client.post(f"/api/v1/partnerships/{pid}/accept", headers=auth(owner, company), json={})
    ).status_code == 422
    headers = auth(owner, company)
    accepted = await client.post(f"/api/v1/partnerships/{pid}/accept", headers=headers, json={"terms": terms})
    assert accepted.status_code == 200 and accepted.json()["status"] == "ACTIVE", accepted.text
    assert (
        await client.post(f"/api/v1/partnerships/{pid}/accept", headers=headers, json={"terms": terms})
    ).json() == accepted.json()
    assert accepted.json()["current_terms"]["version_no"] == 1


async def test_prt_005_active_stores_limit_counts_suspended(client: AsyncClient, session: AsyncSession):
    owner, company, store, terms, pid = await activated(client, session)
    plan = await session.scalar(select(Plan).join(Subscription).where(Subscription.company_id == company.id))
    plan.max_active_stores = 1
    other = await make_org(session, owner, "STORE", "Another", verification_status="APPROVED")
    await session.commit()
    assert (
        await client.post(
            f"/api/v1/partnerships/{pid}/suspend", headers=auth(owner, company), json={"reason": "Paused"}
        )
    ).status_code == 200
    result = await client.post(
        "/api/v1/partnerships/invite", headers=auth(owner, company), json={"store_id": str(other.id), "terms": terms}
    )
    assert result.status_code == 201, result.text
    denied = await client.post(
        f"/api/v1/partnerships/{result.json()['id']}/accept", headers=auth(owner, other), json={}
    )
    assert denied.status_code == 403 and denied.json()["error"]["details"] == {
        "limit": "active_stores",
        "current": 1,
        "max": 1,
    }
    assert (
        await client.post(f"/api/v1/partnerships/{pid}/reactivate", headers=auth(owner, company))
    ).status_code == 200
    assert await service.active_store_count(session, company.id) == 1


async def test_prt_005_concurrent_activation_limit(client: AsyncClient, session: AsyncSession):
    owner, company, store, terms, pid = await invited(client, session)
    other = await make_org(session, owner, "STORE", "Other", verification_status="APPROVED")
    plan = await session.scalar(select(Plan).join(Subscription).where(Subscription.company_id == company.id))
    plan.max_active_stores = 1
    await session.commit()
    result = await client.post(
        "/api/v1/partnerships/invite", headers=auth(owner, company), json={"store_id": str(other.id), "terms": terms}
    )
    results = await asyncio.wait_for(
        asyncio.gather(
            client.post(f"/api/v1/partnerships/{pid}/accept", headers=auth(owner, store), json={}),
            client.post(f"/api/v1/partnerships/{result.json()['id']}/accept", headers=auth(owner, other), json={}),
        ),
        timeout=20,
    )
    assert sorted(response.status_code for response in results) == [200, 403]


async def test_prt_006_terms_versioning_and_effective_from_rules(client: AsyncClient, session: AsyncSession):
    owner, company, _, terms, pid = await activated(client, session)
    future = utcnow() + timedelta(days=1)
    result = await client.post(
        f"/api/v1/partnerships/{pid}/terms",
        headers=auth(owner, company),
        json={**terms, "credit_limit": "200.00", "effective_from": future.isoformat()},
    )
    assert result.status_code == 201 and result.json()["version_no"] == 2, result.text
    for effective in [utcnow() - timedelta(minutes=2), future, future - timedelta(seconds=1)]:
        invalid = await client.post(
            f"/api/v1/partnerships/{pid}/terms",
            headers=auth(owner, company),
            json={**terms, "effective_from": effective.isoformat()},
        )
        assert invalid.status_code == 422 and invalid.json()["error"]["code"] == "terms_effective_from_invalid"
    current = await service.terms_service.current(session, UUID(pid), future - timedelta(seconds=1))
    assert current.version_no == 1
    current = await service.terms_service.current(session, UUID(pid), future)
    assert current.version_no == 2 and current.credit_limit == Decimal(200)
    detail = (await client.get(f"/api/v1/partnerships/{pid}", headers=auth(owner, company))).json()
    assert detail["current_terms"]["version_no"] == 1 and len(detail["future_terms"]) == 1


async def test_prt_007_manager_cannot_change_credit(client: AsyncClient, session: AsyncSession):
    owner, company, _, terms, pid = await activated(client, session)
    manager = await make_user(session)
    await add_member(session, company, manager, "MANAGER")
    await session.commit()
    result = await client.post(
        f"/api/v1/partnerships/{pid}/terms", headers=auth(manager, company), json={**terms, "credit_days": 15}
    )
    assert result.status_code == 403 and result.json()["error"]["details"]["permission"] == "terms.manage_credit"
    result = await client.post(
        f"/api/v1/partnerships/{pid}/terms", headers=auth(manager, company), json={**terms, "delivery_fee": "12.00"}
    )
    assert result.status_code == 201, result.text


async def test_prt_008_foreign_price_list_rejected(client: AsyncClient, session: AsyncSession):
    owner, company, _, terms, pid = await activated(client, session)
    foreign = await make_org(session, owner)
    price_list = PriceList(company_id=foreign.id, code="X", name="Foreign")
    session.add(price_list)
    await session.commit()
    denied = await client.post(
        f"/api/v1/partnerships/{pid}/terms",
        headers=auth(owner, company),
        json={**terms, "price_list_id": str(price_list.id)},
    )
    assert denied.status_code == 422


async def test_prt_009_terminate_calls_cancellation_port(client: AsyncClient, session: AsyncSession, monkeypatch):
    owner, company, _, _, pid = await activated(client, session)
    calls = []

    class Orders:
        async def cancel_open_orders(self, db, partnership_id, reason):
            calls.append((partnership_id, reason))

    monkeypatch.setattr(ports, "order_cancellation", Orders())
    result = await client.post(
        f"/api/v1/partnerships/{pid}/terminate", headers=auth(owner, company), json={"reason": "Finished"}
    )
    assert result.status_code == 200 and calls == [(UUID(pid), "PARTNERSHIP_TERMINATED")]
    assert await session.scalar(select(OutboxEvent.id).where(OutboxEvent.event_type == "PARTNERSHIP_TERMINATED"))


@pytest.mark.parametrize("statement", ["UPDATE partnership_terms SET credit_limit=0", "DELETE FROM partnership_terms"])
async def test_terms_append_only(client: AsyncClient, session: AsyncSession, statement: str):
    await invited(client, session)
    async with get_sessionmaker()() as db:
        with pytest.raises(DBAPIError):
            await db.execute(text(statement))
        await db.rollback()


@pytest.mark.parametrize(
    "action,side,status",
    [
        ("accept", "COMPANY", 403),
        ("cancel", "STORE", 403),
        ("decline", "COMPANY", 403),
        ("suspend", "COMPANY", 409),
        ("terminate", "STORE", 409),
        ("reactivate", "COMPANY", 409),
        ("decline", "STORE", 200),
        ("cancel", "COMPANY", 200),
    ],
)
async def test_partnership_state_machine_valid_invalid(
    client: AsyncClient, session: AsyncSession, action: str, side: str, status: int
):
    owner, company, store, _, pid = await invited(client, session)
    result = await client.post(
        f"/api/v1/partnerships/{pid}/{action}",
        headers=auth(owner, company if side == "COMPANY" else store),
        json={"reason": "Explanation"},
    )
    assert result.status_code == status, result.text


async def test_partnership_new_blocked_in_soft_block(client: AsyncClient, session: AsyncSession):
    owner, company, store, terms = await prepared(session)
    subscription = await session.scalar(select(Subscription).where(Subscription.company_id == company.id))
    subscription.status = "SOFT_BLOCK"
    subscription.soft_block_ends_at = utcnow() + timedelta(days=2)
    await session.commit()
    result = await client.post(
        "/api/v1/partnerships/invite", headers=auth(owner, company), json={"store_id": str(store.id), "terms": terms}
    )
    assert result.status_code == 403 and result.json()["error"]["code"] == "subscription_blocked"


@pytest.mark.parametrize("side", ["COMPANY", "STORE"])
async def test_cross_company_partnership_404_cross_store_404(client: AsyncClient, session: AsyncSession, side: str):
    owner, _, _, _, pid = await invited(client, session)
    other = await make_org(session, owner, side)
    await session.commit()
    for suffix in ["", "/terms"]:
        assert (await client.get(f"/api/v1/partnerships/{pid}{suffix}", headers=auth(owner, other))).status_code == 404


@pytest.mark.parametrize(
    "side,role",
    [("COMPANY", role) for role in ["OWNER", "MANAGER", "OPERATOR", "WAREHOUSE", "COURIER"]]
    + [("STORE", "OWNER"), ("STORE", "SELLER")],
)
async def test_permission_matrix_p06(client: AsyncClient, session: AsyncSession, side: str, role: str):
    owner, company, store, _, pid = await invited(client, session)
    org = company if side == "COMPANY" else store
    user = owner
    if role != "OWNER":
        user = await make_user(session)
        await add_member(session, org, user, role)
        await session.commit()
    allowed = "partners.view" in permissions_for(side, role)
    for suffix in ["", "/terms"]:
        result = await client.get(f"/api/v1/partnerships/{pid}{suffix}", headers=auth(user, org))
        assert result.status_code == (200 if allowed else 403)
    result = await client.post(f"/api/v1/partnerships/{pid}/cancel", headers=auth(user, org))
    if "partners.manage" not in permissions_for(side, role) or side == "STORE":
        assert result.status_code == 403
    else:
        assert result.status_code == 200


async def test_prt_011_profile_privacy_and_customer_code_version(client: AsyncClient, session: AsyncSession):
    owner, company, store, _, pid = await invited(client, session)
    profile = await session.get(Store, store.id)
    profile.tax_identifier = "123456789"
    profile.verification_status = "PENDING"
    await session.commit()
    company_view = (await client.get(f"/api/v1/partnerships/{pid}", headers=auth(owner, company))).json()
    assert company_view["partner"]["tax_identifier"] is None
    assert company_view["partner"]["legal_name"] == profile.legal_name
    assert company_view["partner"]["version"] == profile.version
    store_view = (await client.get(f"/api/v1/partnerships/{pid}", headers=auth(owner, store))).json()
    assert store_view["partner"]["tax_identifier"] is None
    assert store_view["partner"]["legal_name"] is None
    result = await client.patch(
        f"/api/v1/partnerships/{pid}", headers=auth(owner, company), json={"version": 1, "customer_code": "SHOP-1"}
    )
    assert result.status_code == 200 and result.json()["version"] == 2
    assert (
        await client.patch(
            f"/api/v1/partnerships/{pid}", headers=auth(owner, company), json={"version": 1, "customer_code": "SHOP-2"}
        )
    ).status_code == 409
    listed = await client.get(
        "/api/v1/partnerships", headers=auth(owner, company), params={"search": "SHOP-1", "status": "PENDING"}
    )
    assert listed.status_code == 200 and listed.json()["count"] == 1, listed.text


async def test_prt_006_future_terms_become_current_at_time(client: AsyncClient, session: AsyncSession, monkeypatch):
    owner, company, _, terms, pid = await activated(client, session)
    future = utcnow() + timedelta(days=1)
    response = await client.post(
        f"/api/v1/partnerships/{pid}/terms",
        headers=auth(owner, company),
        json={**terms, "effective_from": future.isoformat()},
    )
    assert response.status_code == 201
    monkeypatch.setattr(service, "utcnow", lambda: future)
    assert (await service.terms_service.current(session, UUID(pid))).version_no == 2


async def test_prt_012_store_multiple_companies(client: AsyncClient, session: AsyncSession):
    owner, company, store, _, pid = await activated(client, session)
    other = await make_org(session, owner, name="Second", verification_status="APPROVED")
    price_list = PriceList(company_id=other.id, code="DEFAULT", name="Second list", is_default=True)
    session.add(price_list)
    await session.commit()
    result = await client.post(
        "/api/v1/partnerships/invite",
        headers=auth(owner, other),
        json={
            "store_id": str(store.id),
            "terms": {"price_list_id": str(price_list.id), "payment_methods": ["BANK_TRANSFER"]},
        },
    )
    assert result.status_code == 201, result.text
    result = await client.get("/api/v1/partnerships", headers=auth(owner, store))
    assert result.json()["count"] == 2
    assert {row["company_id"] for row in result.json()["results"]} == {str(company.id), str(other.id)}


async def test_termination_port_failure_rolls_back(client: AsyncClient, session: AsyncSession, monkeypatch):
    owner, company, _, _, pid = await activated(client, session)

    class FailedOrders:
        async def cancel_open_orders(self, db, partnership_id, reason):
            from app.core.errors import AppError

            raise AppError("invalid_transition", 409)

    monkeypatch.setattr(ports, "order_cancellation", FailedOrders())
    result = await client.post(
        f"/api/v1/partnerships/{pid}/terminate", headers=auth(owner, company), json={"reason": "Finished"}
    )
    assert result.status_code == 409
    partner = await session.get(Partnership, UUID(pid))
    assert partner.status == "ACTIVE" and partner.ended_at is None
    assert (
        await session.scalar(select(OutboxEvent.id).where(OutboxEvent.event_type == "PARTNERSHIP_TERMINATED")) is None
    )


@pytest.mark.parametrize("status", ["PENDING", "ACTIVE", "SUSPENDED", "TERMINATED", "DECLINED", "CANCELLED"])
async def test_prt_010_new_order_gate(client: AsyncClient, session: AsyncSession, status: str):
    from app.core.errors import AppError

    _, _, _, _, pid = await invited(client, session)
    partner = await session.get(Partnership, UUID(pid))
    partner.status = status
    if status == "ACTIVE":
        service.require_active(partner)
    else:
        with pytest.raises(AppError) as error:
            service.require_active(partner)
        assert error.value.code == "partnership_not_active"
