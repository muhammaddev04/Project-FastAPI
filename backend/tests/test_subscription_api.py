import asyncio
from datetime import timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.db import get_sessionmaker
from app.core.errors import AppError
from app.core.outbox import OutboxEvent
from app.core.time import utcnow
from app.modules.identity.models import MembershipInvitation
from app.modules.subscriptions import service
from app.modules.subscriptions.domain import SubAction
from app.modules.subscriptions.models import (
    Plan,
    PlanChangeRequest,
    Subscription,
    SubscriptionHistory,
    SubscriptionPayment,
    SubscriptionReminder,
)
from tests.factories import add_member, auth, make_org, make_user


async def test_sub_001_002_trial_and_store_free(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    await session.commit()
    payload = {
        "name": "Trial",
        "legal_name": "Trial LLC",
        "phone": "+992900000011",
        "city": "Dushanbe",
        "address": "Rudaki 1",
        "tax_identifier": "900123456",
    }
    response = await client.post("/api/v1/organizations/companies", headers=auth(owner), json=payload)
    assert response.status_code == 201, response.text
    subscriptions = list(await session.scalars(select(Subscription)))
    assert len(subscriptions) == 1
    sub = subscriptions[0]
    plan = await session.get(Plan, sub.plan_id)
    assert plan is not None and plan.code == "STANDARD"
    assert plan.id.version == 7 and sub.id.version == 7
    assert sub.status == "TRIAL" and sub.trial_ends_at is not None
    assert timedelta(days=13, hours=23) < sub.trial_ends_at - utcnow() <= timedelta(days=14)
    await service.TrialStarter().start_trial(session, sub.company_id)
    await session.flush()
    assert (await session.execute(select(func.count()).select_from(Subscription))).scalar_one() == 1
    store = await make_org(session, owner, "STORE")
    await session.commit()
    assert (
        await session.execute(select(func.count()).select_from(Subscription).where(Subscription.company_id == store.id))
    ).scalar_one() == 0
    assert (await client.get("/api/v1/subscription", headers=auth(owner, store))).status_code == 403


@pytest.mark.parametrize(
    "role, expected", [("OWNER", 200), ("MANAGER", 200), ("OPERATOR", 403), ("WAREHOUSE", 403), ("COURIER", 403)]
)
async def test_subscription_view_permissions(
    client: AsyncClient, session: AsyncSession, role: str, expected: int
) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    user = owner
    if role != "OWNER":
        user = await make_user(session)
        await add_member(session, org, user, role)
    await session.commit()
    response = await client.get("/api/v1/subscription", headers=auth(user, org))
    assert response.status_code == expected, response.text
    if expected == 200:
        assert response.json()["plan"]["code"] == "STANDARD"
        assert response.json()["usage"]["users"] == (1 if role == "OWNER" else 2)
        assert "NEW_ORDER" in response.json()["allowed_actions"]


async def test_sub_003_004_payment_idempotent_and_override(client: AsyncClient, session: AsyncSession) -> None:
    admin = await make_user(session, is_superadmin=True)
    owner = await make_user(session)
    org = await make_org(session, owner)
    sub = await service.get_subscription(session, company_id=org.id)
    await session.commit()
    path = f"/api/v1/admin/subscriptions/{sub.id}/payments"
    payload = {"months": 2, "amount": "1400.00", "method": "BANK_TRANSFER", "reference": "BANK-001"}
    headers = auth(admin)
    assert (await client.post(path, headers=auth(owner), json=payload)).status_code == 403
    missing = auth(admin)
    missing.pop("Idempotency-Key")
    assert (await client.post(path, headers=missing, json=payload)).status_code == 400
    response = await client.post(path, headers=headers, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "ACTIVE"
    repeated = await client.post(path, headers=headers, json=payload)
    assert repeated.json() == response.json()
    assert (await session.execute(select(func.count()).select_from(SubscriptionPayment))).scalar_one() == 1
    wrong = {**payload, "amount": "1300.00"}
    assert (await client.post(path, headers=auth(admin), json=wrong)).status_code == 422
    override = await client.post(
        path, headers=auth(admin), json={**wrong, "override_amount_reason": "Approved discount for customer"}
    )
    assert override.status_code == 200, override.text
    assert (await session.execute(select(func.count()).select_from(SubscriptionPayment))).scalar_one() == 2
    payments = list(await session.scalars(select(SubscriptionPayment).order_by(SubscriptionPayment.created_at)))
    assert payments[1].period_start == payments[0].period_end
    audit = (
        await session.scalars(
            select(AuditLog).where(AuditLog.action == "subscription.payment_recorded", AuditLog.reason.is_not(None))
        )
    ).one()
    assert audit.reason == "Approved discount for customer"
    assert (await client.get("/api/v1/subscription/payments", headers=auth(owner, org))).json()["count"] == 2


async def test_sub_005_tick_catchup_idempotent_audit_events(session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    sub = await service.get_subscription(session, company_id=org.id)
    now = utcnow()
    sub.trial_ends_at = now - timedelta(days=22)
    await session.flush()
    assert await service.tick(session, now) == 3
    assert sub.status == "FULL_BLOCK"
    assert await service.tick(session, now) == 0
    assert (await session.execute(select(func.count()).select_from(SubscriptionHistory))).scalar_one() == 4
    assert (await session.execute(select(func.count()).select_from(SubscriptionReminder))).scalar_one() == 3
    assert (
        await session.execute(
            select(func.count()).select_from(AuditLog).where(AuditLog.action == "subscription.status_changed")
        )
    ).scalar_one() == 4
    assert (
        await session.execute(
            select(func.count()).select_from(OutboxEvent).where(OutboxEvent.event_type == "SUBSCRIPTION_STATUS_CHANGED")
        )
    ).scalar_one() == 4


async def test_sub_010_reminders_once_per_anchor(session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    sub = await service.get_subscription(session, company_id=org.id)
    now = utcnow()
    sub.trial_ends_at = now + timedelta(days=7)
    await session.flush()
    assert await service.send_reminders(session, now) == 1
    assert await service.send_reminders(session, now + timedelta(hours=1)) == 0
    assert await service.send_reminders(session, now + timedelta(days=4)) == 1
    assert await service.send_reminders(session, now + timedelta(days=6)) == 1
    assert await service.send_reminders(session, now + timedelta(days=6, hours=2)) == 0
    assert (await session.execute(select(func.count()).select_from(SubscriptionReminder))).scalar_one() == 3


async def test_sub_006_guard_expiry_and_member_invite(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    sub = await service.get_subscription(session, company_id=org.id)
    sub.trial_ends_at = utcnow() - timedelta(days=8)
    await session.commit()
    response = await client.post(
        "/api/v1/members/invitations", headers=auth(owner, org), json={"email": "new@example.tj", "role": "MANAGER"}
    )
    assert response.status_code == 403, response.text
    with pytest.raises(AppError) as error:
        await service.guard.require(session, org.id, SubAction.NEW_ORDER)
    assert error.value.code == "subscription_blocked"
    await service.guard.require(session, org.id, SubAction.EXPORT)


async def test_sub_008_009_limits_downgrade_preserves_members(client: AsyncClient, session: AsyncSession) -> None:
    admin = await make_user(session, is_superadmin=True)
    owner = await make_user(session)
    org = await make_org(session, owner)
    for _ in range(5):
        await add_member(session, org, await make_user(session), "MANAGER")
    sub = await service.get_subscription(session, company_id=org.id)
    await session.commit()
    response = await client.post(
        f"/api/v1/admin/subscriptions/{sub.id}/change-plan",
        headers=auth(admin),
        json={"plan_code": "START", "reason": "Customer requested a smaller plan"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["usage"]["users"] == 6
    with pytest.raises(AppError) as error:
        await service.guard.check_limit(session, org.id, "users")
    assert error.value.details == {"limit": "users", "current": 6, "max": 5}
    await session.commit()
    large = await client.post(
        f"/api/v1/admin/subscriptions/{sub.id}/change-plan",
        headers=auth(admin),
        json={"plan_code": "LARGE", "reason": "Customer requested unlimited usage"},
    )
    assert large.status_code == 200
    await service.guard.check_limit(session, org.id, "users", adding=1000)


async def test_sub_011_012_owner_cancel_and_plan_request(client: AsyncClient, session: AsyncSession) -> None:
    admin = await make_user(session, is_superadmin=True)
    owner = await make_user(session)
    org = await make_org(session, owner)
    manager = await make_user(session)
    await add_member(session, org, manager, "MANAGER")
    await session.commit()
    path = "/api/v1/subscription/cancel-at-period-end"
    assert (await client.post(path, headers=auth(manager, org), json={"value": True})).status_code == 403
    assert (await client.post(path, headers=auth(owner, org), json={"value": True})).json()[
        "cancel_at_period_end"
    ] is True
    headers = auth(owner, org)
    payload = {"plan_code": "LARGE"}
    request = await client.post("/api/v1/subscription/plan-requests", headers=headers, json=payload)
    assert request.status_code == 201, request.text
    assert (
        await client.post("/api/v1/subscription/plan-requests", headers=headers, json=payload)
    ).json() == request.json()
    assert (await session.execute(select(func.count()).select_from(PlanChangeRequest))).scalar_one() == 1
    listed = await client.get("/api/v1/admin/plan-requests?status=PENDING", headers=auth(admin))
    assert listed.json()["results"][0]["company_name"] == org.name
    handled = await client.post(
        f"/api/v1/admin/plan-requests/{request.json()['id']}/handle",
        headers=auth(admin),
        json={"status": "DONE", "reason": "Approved requested larger plan"},
    )
    assert handled.status_code == 200, handled.text
    assert handled.json()["handled_by"] == str(admin.id)
    assert (await client.get("/api/v1/subscription", headers=auth(owner, org))).json()["plan"]["code"] == "LARGE"


@pytest.mark.parametrize("table", ["subscription_payments", "subscription_status_history"])
@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
async def test_sub_007_append_only(session: AsyncSession, table: str, operation: str) -> None:
    admin = await make_user(session, is_superadmin=True)
    org = await make_org(session, admin)
    sub = await service.get_subscription(session, company_id=org.id)
    await service.record_payment(
        session,
        sub.id,
        admin,
        months=1,
        amount=Decimal("700"),
        method="CASH",
        reference=None,
        override_amount_reason=None,
    )
    await session.commit()
    statement = f"DELETE FROM {table}" if operation == "DELETE" else f"UPDATE {table} SET created_at = now()"
    with pytest.raises(DBAPIError):
        async with session.begin_nested():
            await session.execute(text(statement))


async def test_admin_plan_price_does_not_change_paid_period(client: AsyncClient, session: AsyncSession) -> None:
    admin = await make_user(session, is_superadmin=True)
    org = await make_org(session, admin)
    sub = await service.get_subscription(session, company_id=org.id)
    await service.record_payment(
        session,
        sub.id,
        admin,
        months=1,
        amount=Decimal("700"),
        method="CASH",
        reference=None,
        override_amount_reason=None,
    )
    original_end = sub.current_period_end
    await session.commit()
    plans = (await client.get("/api/v1/admin/plans", headers=auth(admin))).json()["results"]
    plan = next(p for p in plans if p["code"] == "STANDARD")
    response = await client.patch(
        f"/api/v1/admin/plans/{plan['id']}", headers=auth(admin), json={**plan, "price_monthly": "800.00"}
    )
    assert response.status_code == 200, response.text
    stale = await client.patch(f"/api/v1/admin/plans/{plan['id']}", headers=auth(admin), json=plan)
    assert stale.status_code == 409
    await session.refresh(sub)
    assert sub.current_period_end == original_end
    payment = (await session.scalars(select(SubscriptionPayment))).one()
    assert payment.amount == Decimal("700")


async def test_trial_extension_and_admin_filter(client: AsyncClient, session: AsyncSession) -> None:
    admin = await make_user(session, is_superadmin=True)
    owner = await make_user(session)
    org = await make_org(session, owner, name="Subscription Filter")
    sub = await service.get_subscription(session, company_id=org.id)
    original = sub.trial_ends_at
    assert original is not None
    await session.commit()
    extended = await client.post(
        f"/api/v1/admin/subscriptions/{sub.id}/extend-trial",
        headers=auth(admin),
        json={"days": 5, "reason": "Customer needs more evaluation time"},
    )
    assert extended.status_code == 200, extended.text
    await session.refresh(sub)
    assert sub.trial_ends_at == original + timedelta(days=5)
    filtered = await client.get(
        "/api/v1/admin/subscriptions?status=TRIAL&plan=STANDARD&search=Filter", headers=auth(admin)
    )
    assert filtered.json()["count"] == 1
    assert (await client.get("/api/v1/admin/subscriptions", headers=auth(owner))).status_code == 403


async def test_sub_005_skip_locked_subscription_and_catchup(session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    sub = await service.get_subscription(session, company_id=org.id)
    now = utcnow()
    sub.trial_ends_at = now - timedelta(days=22)
    sub_id = sub.id
    await session.commit()
    async with get_sessionmaker()() as locked, locked.begin():
        held = await service.get_subscription(locked, subscription_id=sub_id, lock=True)
        async with get_sessionmaker()() as other, other.begin():
            assert await service.tick(other, now) == 0
        assert await service.evaluate(locked, held, now) == 3
    assert await service.tick(session, now) == 0


async def test_concurrent_payments_extend_without_lost_periods(client: AsyncClient, session: AsyncSession) -> None:
    admin = await make_user(session, is_superadmin=True)
    org = await make_org(session, admin)
    sub = await service.get_subscription(session, company_id=org.id)
    await session.commit()
    path = f"/api/v1/admin/subscriptions/{sub.id}/payments"
    payload = {"months": 1, "amount": "700.00", "method": "CASH"}
    responses = await asyncio.gather(*[client.post(path, headers=auth(admin), json=payload) for _ in range(2)])
    assert all(response.status_code == 200 for response in responses), [r.text for r in responses]
    payments = list(
        await session.scalars(
            select(SubscriptionPayment).order_by(SubscriptionPayment.created_at, SubscriptionPayment.id)
        )
    )
    assert len(payments) == 2
    assert payments[1].period_start == payments[0].period_end
    await session.refresh(sub)
    assert sub.current_period_end == payments[1].period_end


async def test_cancelled_paid_subscription_reactivates_and_resets_cancel(
    client: AsyncClient, session: AsyncSession
) -> None:
    admin = await make_user(session, is_superadmin=True)
    org = await make_org(session, admin)
    sub = await service.get_subscription(session, company_id=org.id)
    now = utcnow()
    sub.status = "ACTIVE"
    sub.current_period_start = now - timedelta(days=31)
    sub.current_period_end = now - timedelta(seconds=1)
    sub.cancel_at_period_end = True
    await session.flush()
    assert await service.tick(session, now) == 1
    assert sub.status == "CANCELLED"
    await session.commit()
    response = await client.post(
        f"/api/v1/admin/subscriptions/{sub.id}/payments",
        headers=auth(admin),
        json={"months": 1, "amount": "700.00", "method": "CASH"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "ACTIVE" and response.json()["cancel_at_period_end"] is False


async def test_hidden_plans_and_trial_extension_rejects_expiry(client: AsyncClient, session: AsyncSession) -> None:
    admin = await make_user(session, is_superadmin=True)
    owner = await make_user(session)
    org = await make_org(session, owner)
    sub = await service.get_subscription(session, company_id=org.id)
    large = await service.get_plan(session, "LARGE")
    large.is_public = False
    sub.trial_ends_at = utcnow() - timedelta(seconds=1)
    await session.commit()
    assert (await client.get("/api/v1/plans", headers=auth(owner))).json()["count"] == 2
    assert (
        await client.post("/api/v1/subscription/plan-requests", headers=auth(owner, org), json={"plan_code": "LARGE"})
    ).status_code == 404
    assert (
        await client.post(
            f"/api/v1/admin/subscriptions/{sub.id}/extend-trial",
            headers=auth(admin),
            json={"days": 3, "reason": "This trial already expired"},
        )
    ).status_code == 409


async def test_minimal_access_exposes_no_billing_to_operators(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    operator = await make_user(session)
    await add_member(session, org, operator, "OPERATOR")
    await session.commit()
    response = await client.get("/api/v1/subscription/access", headers=auth(operator, org))
    assert response.status_code == 200
    assert set(response.json()) == {"status", "allowed_actions"}
    assert (await client.get("/api/v1/subscription", headers=auth(operator, org))).status_code == 403


async def test_payment_replay_rechecks_superadmin_privilege(client: AsyncClient, session: AsyncSession) -> None:
    admin = await make_user(session, is_superadmin=True)
    org = await make_org(session, admin)
    sub = await service.get_subscription(session, company_id=org.id)
    await session.commit()
    headers = auth(admin)
    path = f"/api/v1/admin/subscriptions/{sub.id}/payments"
    payload = {"months": 1, "amount": "700.00", "method": "CASH"}
    assert (await client.post(path, headers=headers, json=payload)).status_code == 200
    admin.is_superadmin = False
    await session.commit()
    assert (await client.post(path, headers=headers, json=payload)).status_code == 403
    assert (await session.execute(select(func.count()).select_from(SubscriptionPayment))).scalar_one() == 1


async def test_payment_key_cannot_replay_for_another_subscription(client: AsyncClient, session: AsyncSession) -> None:
    admin = await make_user(session, is_superadmin=True)
    first = await make_org(session, admin)
    second = await make_org(session, admin)
    subscriptions = [await service.get_subscription(session, company_id=org.id) for org in (first, second)]
    await session.commit()
    headers = auth(admin)
    payload = {"months": 1, "amount": "700.00", "method": "CASH"}
    responses = [
        await client.post(f"/api/v1/admin/subscriptions/{sub.id}/payments", headers=headers, json=payload)
        for sub in subscriptions
    ]
    assert responses[0].status_code == 200
    assert responses[1].status_code == 409
    assert responses[1].json()["error"]["code"] == "idempotency_key_reused"
    assert (await session.execute(select(func.count()).select_from(SubscriptionPayment))).scalar_one() == 1


async def test_real_users_limit_blocks_invitation_accept_and_reactivation(
    client: AsyncClient, session: AsyncSession
) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    recipient = await make_user(session)
    plan = await service.get_plan(session, "STANDARD")
    plan.max_users = 1
    invitation = MembershipInvitation(
        organization_id=org.id,
        email=recipient.email,
        role="MANAGER",
        invited_by=owner.id,
        expires_at=utcnow() + timedelta(days=7),
    )
    session.add(invitation)
    await session.commit()
    response = await client.post(f"/api/v1/me/invitations/{invitation.id}/accept", headers=auth(recipient))
    assert response.status_code == 403
    assert response.json()["error"]["details"] == {"limit": "users", "current": 1, "max": 1}
    await session.refresh(invitation)
    assert invitation.status == "PENDING"
    member = await add_member(session, org, recipient, "MANAGER", "SUSPENDED")
    await session.commit()
    response = await client.post(f"/api/v1/members/{member.id}/reactivate", headers=auth(owner, org))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "subscription_limit_reached"
    await session.refresh(member)
    assert member.status == "SUSPENDED"


async def test_cached_plan_refreshes_price_and_limit_under_lock(session: AsyncSession) -> None:
    admin = await make_user(session, is_superadmin=True)
    org = await make_org(session, admin)
    sub = await service.get_subscription(session, company_id=org.id)
    cached = await service.get_plan(session, "STANDARD")
    assert cached.price_monthly == Decimal("700")
    await session.commit()
    async with get_sessionmaker()() as other, other.begin():
        changed = await service.get_plan(other, "STANDARD", lock=True)
        changed.price_monthly = Decimal("800")
        changed.max_users = 1
    with pytest.raises(AppError) as error:
        await service.record_payment(
            session,
            sub.id,
            admin,
            months=1,
            amount=Decimal("700"),
            method="CASH",
            reference=None,
            override_amount_reason=None,
        )
    assert error.value.details["expected_amount"] == "800.00"
    with pytest.raises(AppError) as limit:
        await service.guard.check_limit(session, org.id, "users")
    assert limit.value.details["max"] == 1


async def test_plan_partial_patch_preserves_omitted_limits(client: AsyncClient, session: AsyncSession) -> None:
    admin = await make_user(session, is_superadmin=True)
    plan = await service.get_plan(session, "STANDARD")
    await session.commit()
    path = f"/api/v1/admin/plans/{plan.id}"
    changed = await client.patch(path, headers=auth(admin), json={"version": 1, "price_monthly": "800.00"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["max_users"] == 15 and changed.json()["code"] == "STANDARD"
    assert changed.json()["price_monthly"] == "800.00"
    assert (
        await client.patch(path, headers=auth(admin), json={"version": 2, "price_monthly": None})
    ).status_code == 422
    unlimited = await client.patch(path, headers=auth(admin), json={"version": 2, "max_users": None})
    assert unlimited.status_code == 200 and unlimited.json()["max_users"] is None
    assert unlimited.json()["max_products"] == 3000
