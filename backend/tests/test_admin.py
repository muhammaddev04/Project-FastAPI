"""P12 §3 SUPERADMIN panel: who may call it, what a change costs, and what it records."""

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.outbox import OutboxEvent
from app.modules.identity.models import Membership, User
from app.modules.notifications.models import Notification, NotificationDelivery
from tests.factories import add_member, auth, make_user
from tests.test_reports import plain
from tests.test_returns_service import delivered

REASON = "Owner asked support to intervene"


def admin_headers(admin: User) -> dict[str, str]:
    return {**auth(admin), "Idempotency-Key": str(uuid4())}


async def superadmin(session: AsyncSession) -> User:
    admin = await make_user(session, full_name="Platform Admin", is_superadmin=True)
    await session.commit()
    return admin


MUTATIONS = (
    ("post", "/api/v1/admin/users/{user_id}/block"),
    ("post", "/api/v1/admin/users/{user_id}/unblock"),
    ("post", "/api/v1/admin/users/{user_id}/logout-all"),
    ("post", "/api/v1/admin/organizations/{organization_id}/suspend"),
    ("post", "/api/v1/admin/organizations/{organization_id}/block"),
    ("post", "/api/v1/admin/organizations/{organization_id}/activate"),
)
READS = (
    "/api/v1/admin/dashboard",
    "/api/v1/admin/users",
    "/api/v1/admin/organizations",
    "/api/v1/admin/audit-logs",
    "/api/v1/admin/outbox",
    "/api/v1/admin/notification-failures",
)


@pytest.mark.parametrize("path", READS)
async def test_adm_admin_endpoints_require_superadmin(client: AsyncClient, session: AsyncSession, path: str):
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    await session.commit()
    assert (await client.get(path)).status_code == 401
    answer = await client.get(path, headers=plain(ctx))
    assert answer.status_code == 403, path
    assert answer.json()["error"]["code"] == "permission_denied"
    admin = await superadmin(session)
    assert (await client.get(path, headers=auth(admin))).status_code == 200, path


@pytest.mark.parametrize(("method", "path"), MUTATIONS)
async def test_adm_mutations_require_superadmin(client: AsyncClient, session: AsyncSession, method: str, path: str):
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    await session.commit()
    target = path.format(user_id=ctx.user.id, organization_id=ctx.organization.id)
    answer = await client.request(method, target, headers=plain(ctx), json={"reason": REASON})
    assert answer.status_code == 403, target


@pytest.mark.parametrize(("method", "path"), MUTATIONS)
async def test_adm_reason_required_for_mutations(client: AsyncClient, session: AsyncSession, method: str, path: str):
    """§3: `override_reason_required` - no admin change happens without a stated reason."""
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    admin = await superadmin(session)
    target = path.format(user_id=ctx.user.id, organization_id=ctx.organization.id)

    for payload in ({}, {"reason": "  "}, {"reason": "too short"}):
        answer = await client.request(method, target, headers=admin_headers(admin), json=payload)
        assert answer.status_code == 422, (target, payload)
        assert answer.json()["error"]["code"] == "override_reason_required"


async def test_adm_001_dashboard_counts(client: AsyncClient, session: AsyncSession):
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    admin = await superadmin(session)

    answer = await client.get("/api/v1/admin/dashboard", headers=auth(admin))
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["organizations"]["COMPANY_ACTIVE"] == 1 and body["organizations"]["STORE_ACTIVE"] == 1
    assert sum(body["subscriptions"].values()) == 1
    assert body["outbox_failed"] == 0 and body["reconciliation_issues"] == 0
    assert body["notifications_failed_24h"] == 0 and body["verifications_pending"] == 0
    assert ctx.organization.type == "COMPANY"


async def test_adm_002_block_user_ends_every_session(client: AsyncClient, session: AsyncSession):
    """IAM-009: status BLOCKED and a new token_version, so live access tokens stop working."""
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    admin = await superadmin(session)
    before = ctx.user.token_version
    live = plain(ctx)  # a token issued while the account was still active

    blocked = await client.post(
        f"/api/v1/admin/users/{ctx.user.id}/block", headers=admin_headers(admin), json={"reason": REASON}
    )
    assert blocked.status_code == 200, blocked.text
    assert blocked.json()["status"] == "BLOCKED"
    await session.refresh(ctx.user)
    assert ctx.user.token_version == before + 1
    # The token that was in flight is now invalid; a newly signed one is refused because the account is blocked.
    stale = await client.get("/api/v1/dashboard", headers=live)
    assert stale.status_code == 401 and stale.json()["error"]["code"] == "token_invalid"
    fresh = await client.get("/api/v1/dashboard", headers=plain(ctx))
    assert fresh.status_code == 403 and fresh.json()["error"]["code"] == "user_blocked"

    again = await client.post(
        f"/api/v1/admin/users/{ctx.user.id}/block", headers=admin_headers(admin), json={"reason": REASON}
    )
    assert again.status_code == 409 and again.json()["error"]["code"] == "invalid_transition"

    unblocked = await client.post(
        f"/api/v1/admin/users/{ctx.user.id}/unblock", headers=admin_headers(admin), json={"reason": REASON}
    )
    assert unblocked.status_code == 200 and unblocked.json()["status"] == "ACTIVE"
    recorded = (
        await session.scalars(select(AuditLog).where(AuditLog.entity_id == ctx.user.id, AuditLog.action.like("user.%")))
    ).all()
    assert {row.action for row in recorded} == {"user.blocked", "user.unblocked"}
    assert all(row.actor_type == "SUPERADMIN" and row.reason == REASON for row in recorded)


async def test_adm_002_superadmin_is_managed_by_cli_only(client: AsyncClient, session: AsyncSession):
    admin = await superadmin(session)
    other = await make_user(session, is_superadmin=True)
    await session.commit()
    answer = await client.post(
        f"/api/v1/admin/users/{other.id}/block", headers=admin_headers(admin), json={"reason": REASON}
    )
    assert answer.status_code == 403


async def test_adm_002_logout_all_keeps_the_user_active(client: AsyncClient, session: AsyncSession):
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    admin = await superadmin(session)
    answer = await client.post(
        f"/api/v1/admin/users/{ctx.user.id}/logout-all", headers=admin_headers(admin), json={"reason": REASON}
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["status"] == "ACTIVE"
    assert (await client.get("/api/v1/dashboard", headers=plain(ctx))).status_code == 401


async def test_adm_002_user_detail_lists_memberships(client: AsyncClient, session: AsyncSession):
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    admin = await superadmin(session)
    detail = await client.get(f"/api/v1/admin/users/{ctx.user.id}", headers=auth(admin))
    assert detail.status_code == 200, detail.text
    roles = {entry["organization_id"]: entry["role"] for entry in detail.json()["memberships"]}
    assert roles[str(ctx.organization.id)] == "OWNER"
    search = await client.get("/api/v1/admin/users", headers=auth(admin), params={"search": ctx.user.full_name})
    assert search.status_code == 200 and search.json()["count"] >= 1
    missing = await client.get(f"/api/v1/admin/users/{uuid4()}", headers=auth(admin))
    assert missing.status_code == 404


async def test_adm_003_organization_status_machine(client: AsyncClient, session: AsyncSession):
    """P02 §2.2: SUSPENDED still reads, BLOCKED stops everything but `/me`."""
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    admin = await superadmin(session)

    suspended = await client.post(
        f"/api/v1/admin/organizations/{ctx.organization.id}/suspend",
        headers=admin_headers(admin),
        json={"reason": REASON},
    )
    assert suspended.status_code == 200, suspended.text
    assert suspended.json()["status"] == "SUSPENDED"
    assert (await client.get("/api/v1/dashboard", headers=plain(ctx))).status_code == 200

    blocked = await client.post(
        f"/api/v1/admin/organizations/{ctx.organization.id}/block",
        headers=admin_headers(admin),
        json={"reason": REASON},
    )
    assert blocked.status_code == 200, blocked.text
    denied = await client.get("/api/v1/dashboard", headers=plain(ctx))
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "organization_blocked"

    again = await client.post(
        f"/api/v1/admin/organizations/{ctx.organization.id}/suspend",
        headers=admin_headers(admin),
        json={"reason": REASON},
    )
    assert again.status_code == 409 and again.json()["error"]["code"] == "invalid_transition"

    activated = await client.post(
        f"/api/v1/admin/organizations/{ctx.organization.id}/activate",
        headers=admin_headers(admin),
        json={"reason": REASON},
    )
    assert activated.status_code == 200 and activated.json()["status"] == "ACTIVE"


async def test_adm_003_transfer_ownership_single_owner(client: AsyncClient, session: AsyncSession):
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    admin = await superadmin(session)
    successor = await make_user(session, full_name="Next Owner")
    await add_member(session, ctx.organization, successor, "MANAGER")
    await session.commit()

    answer = await client.post(
        f"/api/v1/admin/organizations/{ctx.organization.id}/transfer-ownership",
        headers=admin_headers(admin),
        json={"user_id": str(successor.id), "reason": REASON},
    )
    assert answer.status_code == 200, answer.text
    owners = (
        await session.scalars(
            select(Membership)
            .where(
                Membership.organization_id == ctx.organization.id,
                Membership.role == "OWNER",
                Membership.status == "ACTIVE",
            )
            .execution_options(populate_existing=True)
        )
    ).all()
    assert [row.user_id for row in owners] == [successor.id]
    previous = await session.scalar(
        select(Membership)
        .where(Membership.organization_id == ctx.organization.id, Membership.user_id == ctx.user.id)
        .execution_options(populate_existing=True)
    )
    assert previous is not None and previous.role == "MANAGER" and previous.status == "ACTIVE"

    repeated = await client.post(
        f"/api/v1/admin/organizations/{ctx.organization.id}/transfer-ownership",
        headers=admin_headers(admin),
        json={"user_id": str(successor.id), "reason": REASON},
    )
    assert repeated.status_code == 409
    outsider = await make_user(session)
    await session.commit()
    stranger = await client.post(
        f"/api/v1/admin/organizations/{ctx.organization.id}/transfer-ownership",
        headers=admin_headers(admin),
        json={"user_id": str(outsider.id), "reason": REASON},
    )
    assert stranger.status_code == 404


async def test_adm_003_transfer_ownership_can_revoke_the_previous_owner(client: AsyncClient, session: AsyncSession):
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    admin = await superadmin(session)
    successor = await make_user(session, full_name="Next Owner")
    await add_member(session, ctx.organization, successor, "MANAGER")
    await session.commit()

    answer = await client.post(
        f"/api/v1/admin/organizations/{ctx.organization.id}/transfer-ownership",
        headers=admin_headers(admin),
        json={"user_id": str(successor.id), "previous_owner_role": "REVOKED", "reason": REASON},
    )
    assert answer.status_code == 200, answer.text
    previous = await session.scalar(
        select(Membership)
        .where(Membership.organization_id == ctx.organization.id, Membership.user_id == ctx.user.id)
        .execution_options(populate_existing=True)
    )
    assert previous is not None and previous.status == "REVOKED" and previous.revoked_at is not None


async def test_adm_003_legal_fields_need_a_version_and_a_reason(client: AsyncClient, session: AsyncSession):
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    admin = await superadmin(session)
    detail = await client.get(f"/api/v1/admin/organizations/{ctx.organization.id}", headers=auth(admin))
    assert detail.status_code == 200, detail.text
    version = detail.json()["version"]

    stale = await client.patch(
        f"/api/v1/admin/organizations/{ctx.organization.id}/legal",
        headers=admin_headers(admin),
        json={"legal_name": "Renamed LLC", "version": version + 5, "reason": REASON},
    )
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "version_conflict"

    updated = await client.patch(
        f"/api/v1/admin/organizations/{ctx.organization.id}/legal",
        headers=admin_headers(admin),
        json={"legal_name": "Renamed LLC", "version": version, "reason": REASON},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["legal_name"] == "Renamed LLC"
    recorded = await session.scalar(select(AuditLog).where(AuditLog.action == "organization.legal_updated"))
    assert recorded is not None
    assert recorded.actor_type == "SUPERADMIN" and recorded.new_data == {"legal_name": "Renamed LLC"}


async def test_adm_003_organization_detail_and_search(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, _order, _item = await delivered(client, session)
    admin = await superadmin(session)

    listed = await client.get("/api/v1/admin/organizations", headers=auth(admin), params={"type": "STORE"})
    assert listed.status_code == 200, listed.text
    assert [row["id"] for row in listed.json()["results"]] == [str(store_ctx.organization.id)]
    assert listed.json()["results"][0]["legal_name"] is not None

    detail = await client.get(f"/api/v1/admin/organizations/{ctx.organization.id}", headers=auth(admin))
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["partnerships"] == 1 and body["subscription"]["status"] in {"TRIAL", "ACTIVE"}
    assert "OWNER" in {member["role"] for member in body["members"]}


async def test_adm_006_audit_viewer_filters(client: AsyncClient, session: AsyncSession):
    ctx, _store_ctx, order, _item = await delivered(client, session)
    admin = await superadmin(session)

    answer = await client.get(
        "/api/v1/admin/audit-logs",
        headers=auth(admin),
        params={"org_id": str(ctx.organization.id), "entity_type": "orders"},
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["count"] >= 1
    assert all(row["entity_type"] == "orders" for row in answer.json()["results"])
    narrow = await client.get("/api/v1/admin/audit-logs", headers=auth(admin), params={"entity_id": str(order.id)})
    assert narrow.status_code == 200 and narrow.json()["count"] >= 1
    unknown = await client.get("/api/v1/admin/audit-logs", headers=auth(admin), params={"what": "x"})
    assert unknown.status_code == 422


async def test_adm_007_outbox_retry(client: AsyncClient, session: AsyncSession):
    ctx, _store_ctx, _order, _item = await delivered(client, session)
    admin = await superadmin(session)
    event = await session.scalar(select(OutboxEvent).order_by(OutboxEvent.created_at))
    assert event is not None
    event.status = "FAILED"
    event.attempts = 8
    event.last_error = "RuntimeError"
    await session.commit()

    failed = await client.get("/api/v1/admin/outbox", headers=auth(admin), params={"status": "FAILED"})
    assert failed.status_code == 200 and failed.json()["count"] == 1
    assert failed.json()["results"][0]["last_error"] == "RuntimeError"

    retried = await client.post(
        f"/api/v1/admin/outbox/{event.id}/retry", headers=admin_headers(admin), json={"reason": REASON}
    )
    assert retried.status_code == 200, retried.text
    body = retried.json()
    assert body["status"] == "PENDING" and body["attempts"] == 0 and body["last_error"] is None

    again = await client.post(
        f"/api/v1/admin/outbox/{event.id}/retry", headers=admin_headers(admin), json={"reason": REASON}
    )
    assert again.status_code == 409
    recorded = await session.scalar(select(AuditLog).where(AuditLog.action == "outbox.retried"))
    assert recorded is not None and recorded.actor_type == "SUPERADMIN"
    assert ctx.organization.id is not None


async def test_adm_008_notification_failures(client: AsyncClient, session: AsyncSession):
    from app.core.outbox import dispatch_pending

    ctx, _store_ctx, _order, _item = await delivered(client, session)
    admin = await superadmin(session)
    await session.commit()
    await dispatch_pending()

    notification = await session.scalar(select(Notification).limit(1))
    assert notification is not None
    # NTF-004: the row exists from the moment the notification is created; it is the third attempt that fails it.
    delivery = await session.scalar(
        select(NotificationDelivery).where(NotificationDelivery.notification_id == notification.id)
    )
    if delivery is None:
        delivery = NotificationDelivery(notification_id=notification.id, channel="TELEGRAM")
        session.add(delivery)
    delivery.status = "FAILED"
    delivery.attempts = 3
    delivery.last_error = "HTTPError"
    await session.commit()

    answer = await client.get("/api/v1/admin/notification-failures", headers=auth(admin))
    assert answer.status_code == 200, answer.text
    assert answer.json()["count"] == 1
    row = answer.json()["results"][0]
    assert row["channel"] == "TELEGRAM" and row["attempts"] == 3 and row["last_error"] == "HTTPError"
    assert row["user_id"] == str(notification.user_id)
    assert ctx.user.id is not None


async def test_adm_010_admin_read_audited(client: AsyncClient, session: AsyncSession):
    """Support reads a tenant's data read-only, and every read says why."""
    ctx, _store_ctx, order, _item = await delivered(client, session)
    admin = await superadmin(session)
    partnership_id = order.partnership_id

    unexplained = await client.get(f"/api/v1/admin/organizations/{ctx.organization.id}/orders", headers=auth(admin))
    assert unexplained.status_code == 422
    assert unexplained.json()["error"]["code"] == "override_reason_required"

    orders = await client.get(
        f"/api/v1/admin/organizations/{ctx.organization.id}/orders",
        headers=auth(admin),
        params={"reason": "Support ticket 4821"},
    )
    assert orders.status_code == 200, orders.text
    assert [row["order_number"] for row in orders.json()["results"]] == [order.order_number]

    statement = await client.get(
        f"/api/v1/admin/partnerships/{partnership_id}/statement",
        headers=auth(admin),
        params={"reason": "Support ticket 4821"},
    )
    assert statement.status_code == 200, statement.text
    assert statement.json()["entries"]

    reads = (await session.scalars(select(AuditLog).where(AuditLog.action == "admin.viewed"))).all()
    assert {row.entity_type for row in reads} == {"orders", "partnerships"}
    assert all(row.actor_type == "SUPERADMIN" and row.reason == "Support ticket 4821" for row in reads)


async def test_adm_011_no_impersonation_endpoint(client: AsyncClient, session: AsyncSession):
    admin = await superadmin(session)
    for path in ("/api/v1/admin/impersonate", f"/api/v1/admin/users/{admin.id}/impersonate"):
        assert (await client.post(path, headers=admin_headers(admin), json={})).status_code == 404


async def test_admin_panel_does_not_change_business_data(client: AsyncClient, session: AsyncSession):
    """ADM-010 is read-only: there is no admin route that writes an order or a ledger entry."""
    from app.main import app

    writable = [
        route.path  # type: ignore[attr-defined]
        for route in app.routes
        if getattr(route, "path", "").startswith("/api/v1/admin/")
        and {"POST", "PATCH", "PUT", "DELETE"} & getattr(route, "methods", set())
        and ("orders" in getattr(route, "path", "") or "statement" in getattr(route, "path", ""))
    ]
    assert writable == []
    counted = await session.scalar(select(func.count()).select_from(AuditLog))
    assert counted is not None
