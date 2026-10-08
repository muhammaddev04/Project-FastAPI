"""P08 delivery: planning, runs, the handover code and the courier's offline queue."""

from datetime import timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.errors import AppError
from app.core.outbox import OutboxEvent
from app.core.time import utcnow
from app.modules.delivery import codes
from app.modules.delivery.models import CourierSyncOperation, Delivery, DeliveryStatusHistory
from app.modules.identity.models import Membership, User
from app.modules.inventory.models import Stock
from app.modules.orders.models import Order
from tests.factories import add_member, auth, make_user
from tests.test_orders import confirm, create, setup


async def ready_order(client: AsyncClient, session: AsyncSession, ctx, pid, uid, quantity="5"):
    """Drive an order to READY_FOR_DELIVERY, which is what makes P08 create a delivery."""
    order = await create(client, ctx, pid, uid, quantity)
    order = await confirm(client, ctx, order, quantity)
    headers = auth(ctx.user, ctx.organization)
    for endpoint in ("start-assembling", "mark-ready"):
        result = await client.post(
            f"/api/v1/orders/{order['id']}/{endpoint}", headers=headers, json={"version": order["version"]}
        )
        assert result.status_code == 200, result.text
        order = result.json()
    return order


async def courier_for(session: AsyncSession, company, email: str = "courier@example.com"):
    user = await make_user(session, email=email)
    await add_member(session, company, user, "COURIER")
    await session.commit()
    return user


async def planned(client: AsyncClient, session: AsyncSession, **kwargs):
    ctx, store, pid, data, uid = await setup(client, session, **kwargs)
    order = await ready_order(client, session, ctx, pid, uid)
    delivery = (await session.scalars(select(Delivery).where(Delivery.order_id == UUID(order["id"])))).one()
    return ctx, store, order, delivery


async def test_del_001_order_ready_creates_planned(client: AsyncClient, session: AsyncSession):
    ctx, _, order, delivery = await planned(client, session)
    assert delivery.status == "PLANNED" and delivery.attempt_no == 1
    assert delivery.courier_id is None and delivery.run_id is None
    # The address is the one the order froze at checkout, not a live read of the store profile.
    stored = await session.get(Order, UUID(order["id"]))
    assert stored is not None
    assert delivery.address == stored.delivery_address


async def test_del_001_reattempt_creates_new_attempt_no(client: AsyncClient, session: AsyncSession):
    ctx, _, order, delivery = await planned(client, session)
    headers = auth(ctx.user, ctx.organization)
    courier = await courier_for(session, ctx.organization)
    await client.post(
        f"/api/v1/deliveries/{delivery.id}/assign",
        headers=headers,
        json={"courier_id": str(courier.id), "version": delivery.version},
    )
    await client.post(f"/api/v1/courier/deliveries/{delivery.id}/dispatch", headers=auth(courier, ctx.organization))
    failed = await client.post(
        f"/api/v1/courier/deliveries/{delivery.id}/fail",
        headers=auth(courier, ctx.organization),
        json={"reason_code": "STORE_CLOSED"},
    )
    assert failed.status_code == 200, failed.text
    fresh = await session.get(Order, UUID(order["id"]))
    assert fresh is not None
    await session.refresh(fresh)
    assert fresh.status == "DELIVERY_FAILED"
    again = await client.post(
        f"/api/v1/orders/{order['id']}/reattempt", headers=headers, json={"version": fresh.version}
    )
    assert again.status_code == 200, again.text
    rows = list(
        await session.scalars(
            select(Delivery)
            .where(Delivery.order_id == UUID(order["id"]))
            .order_by(Delivery.attempt_no)
            .execution_options(populate_existing=True)  # the first row was loaded before it failed
        )
    )
    assert [row.attempt_no for row in rows] == [1, 2]
    assert [row.status for row in rows] == ["FAILED", "PLANNED"]


async def test_del_002_cancel_port_cancels_planned(client: AsyncClient, session: AsyncSession):
    ctx, _, order, delivery = await planned(client, session)
    result = await client.post(
        f"/api/v1/orders/{order['id']}/cancel",
        headers=auth(ctx.user, ctx.organization),
        json={"reason": "Store asked to stop", "version": order["version"]},
    )
    assert result.status_code == 200, result.text
    await session.refresh(delivery)
    assert delivery.status == "CANCELLED"


async def test_del_002_cancel_port_in_transit_raises(client: AsyncClient, session: AsyncSession):
    ctx, _, order, delivery = await planned(client, session)
    courier = await courier_for(session, ctx.organization)
    headers = auth(ctx.user, ctx.organization)
    await client.post(
        f"/api/v1/deliveries/{delivery.id}/assign",
        headers=headers,
        json={"courier_id": str(courier.id), "version": delivery.version},
    )
    await client.post(f"/api/v1/courier/deliveries/{delivery.id}/dispatch", headers=auth(courier, ctx.organization))
    await session.refresh(delivery)
    assert delivery.status == "IN_TRANSIT"
    fresh = await session.get(Order, UUID(order["id"]))
    assert fresh is not None
    await session.refresh(fresh)
    # ORD-031: the order cannot be cancelled out from under a courier who already has the goods.
    result = await client.post(
        f"/api/v1/orders/{order['id']}/cancel",
        headers=headers,
        json={"reason": "Too late to stop", "version": fresh.version},
    )
    assert result.status_code == 409, result.text


async def test_del_003_courier_sees_only_own_404(client: AsyncClient, session: AsyncSession):
    ctx, _, _, delivery = await planned(client, session)
    mine = await courier_for(session, ctx.organization)
    other = await courier_for(session, ctx.organization, email="other-courier@example.com")
    await client.post(
        f"/api/v1/deliveries/{delivery.id}/assign",
        headers=auth(ctx.user, ctx.organization),
        json={"courier_id": str(mine.id), "version": delivery.version},
    )
    seen = await client.get(f"/api/v1/courier/deliveries/{delivery.id}", headers=auth(mine, ctx.organization))
    assert seen.status_code == 200
    # Somebody else's stop is a 404, not a 403: a 403 would confirm the delivery exists.
    hidden = await client.get(f"/api/v1/courier/deliveries/{delivery.id}", headers=auth(other, ctx.organization))
    assert hidden.status_code == 404


async def dispatched(client: AsyncClient, session: AsyncSession, **kwargs):
    """A delivery on the road, with its code minted, plus the courier carrying it."""
    ctx, store, order, delivery = await planned(client, session, **kwargs)
    courier = await courier_for(session, ctx.organization)
    await client.post(
        f"/api/v1/deliveries/{delivery.id}/assign",
        headers=auth(ctx.user, ctx.organization),
        json={"courier_id": str(courier.id), "version": delivery.version},
    )
    result = await client.post(
        f"/api/v1/courier/deliveries/{delivery.id}/dispatch", headers=auth(courier, ctx.organization)
    )
    assert result.status_code == 200, result.text
    await session.refresh(delivery)
    return ctx, store, order, delivery, courier


async def test_del_010_code_generated_on_dispatch_hash_and_encrypted(client: AsyncClient, session: AsyncSession):
    _, _, _, delivery, _ = await dispatched(client, session)
    assert delivery.status == "IN_TRANSIT"
    assert delivery.code_hash is not None and len(delivery.code_hash) == 64
    assert delivery.code_encrypted is not None
    assert delivery.code_attempts == 0 and delivery.code_locked is False
    code = codes.decrypt(delivery.id, delivery.code_encrypted)
    assert code is not None and len(code) == 6 and code.isdigit()
    # The digest is the only thing that can answer "is this the code", and it is not the code.
    assert codes.matches(delivery.id, code, delivery.code_hash)
    assert code.encode() not in delivery.code_encrypted


async def test_del_011_wrong_code_attempts_and_lock_after_5(client: AsyncClient, session: AsyncSession):
    ctx, _, _, delivery, courier = await dispatched(client, session)
    right = codes.decrypt(delivery.id, delivery.code_encrypted)
    assert right is not None
    wrong = "000000" if right != "000000" else "111111"
    headers = auth(courier, ctx.organization)
    for attempt in range(1, codes.MAX_ATTEMPTS):
        result = await client.post(
            f"/api/v1/courier/deliveries/{delivery.id}/confirm", headers=headers, json={"code": wrong}
        )
        assert result.status_code == 422, result.text
        body = result.json()["error"]
        assert body["code"] == "delivery_code_invalid"
        assert body["details"]["attempts_left"] == codes.MAX_ATTEMPTS - attempt
    locked = await client.post(
        f"/api/v1/courier/deliveries/{delivery.id}/confirm", headers=headers, json={"code": wrong}
    )
    assert locked.status_code == 409 and locked.json()["error"]["code"] == "delivery_code_locked"
    await session.refresh(delivery)
    assert delivery.code_locked is True and delivery.status == "IN_TRANSIT"
    # Even the right code is refused once the delivery is locked; it has to be re-coded first.
    after = await client.post(
        f"/api/v1/courier/deliveries/{delivery.id}/confirm", headers=headers, json={"code": right}
    )
    assert after.status_code == 409 and after.json()["error"]["code"] == "delivery_code_locked"
    events = list(await session.scalars(select(OutboxEvent.event_type)))
    assert "DELIVERY_CODE_LOCKED" in events


async def test_del_012_code_never_in_audit_or_outbox(client: AsyncClient, session: AsyncSession, caplog):
    ctx, _, _, delivery, courier = await dispatched(client, session)
    code = codes.decrypt(delivery.id, delivery.code_encrypted)
    assert code is not None
    confirmed = await client.post(
        f"/api/v1/courier/deliveries/{delivery.id}/confirm",
        headers=auth(courier, ctx.organization),
        json={"code": code},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert code not in caplog.text
    # The code must not have leaked into anything that is kept or forwarded.
    for payload in await session.scalars(select(OutboxEvent.payload)):
        assert code not in str(payload)
    for row in await session.scalars(select(AuditLog)):
        assert code not in f"{row.old_data} {row.new_data} {row.reason}"
    for row in await session.scalars(select(DeliveryStatusHistory)):
        assert code not in f"{row.details} {row.reason}"


async def test_del_012_code_visible_only_to_store_in_transit(client: AsyncClient, session: AsyncSession):
    ctx, store, order, delivery, courier = await dispatched(client, session)
    code = codes.decrypt(delivery.id, delivery.code_encrypted)
    store_owner = (
        await session.scalars(
            select(Membership).where(Membership.organization_id == store.id, Membership.role == "OWNER")
        )
    ).first()
    assert store_owner is not None
    owner_user = await session.get(User, store_owner.user_id)
    assert owner_user is not None
    seen = await client.get(f"/api/v1/orders/{order['id']}/delivery", headers=auth(owner_user, store))
    assert seen.status_code == 200, seen.text
    assert seen.json()["code"] == code
    # The company side drives the delivery but is never shown the code.
    company_view = await client.get(f"/api/v1/deliveries/{delivery.id}", headers=auth(ctx.user, ctx.organization))
    assert company_view.status_code == 200
    assert code not in company_view.text
    # Once it is delivered the code stops being shown at all.
    await client.post(
        f"/api/v1/courier/deliveries/{delivery.id}/confirm",
        headers=auth(courier, ctx.organization),
        json={"code": code},
    )
    after = await client.get(f"/api/v1/orders/{order['id']}/delivery", headers=auth(owner_user, store))
    assert after.status_code == 200 and after.json()["code"] is None


async def test_del_013_manual_override_requires_reason_and_audits(client: AsyncClient, session: AsyncSession):
    ctx, _, _, delivery, _ = await dispatched(client, session)
    headers = auth(ctx.user, ctx.organization)
    short = await client.post(
        f"/api/v1/deliveries/{delivery.id}/manual-confirm",
        headers=headers | {"Idempotency-Key": str(uuid4())},
        json={"reason": "too short"},
    )
    assert short.status_code == 422, short.text
    result = await client.post(
        f"/api/v1/deliveries/{delivery.id}/manual-confirm",
        headers=headers | {"Idempotency-Key": str(uuid4())},
        json={"reason": "Store owner known personally, code not to hand"},
    )
    assert result.status_code == 200, result.text
    await session.refresh(delivery)
    assert delivery.status == "DELIVERED" and delivery.confirmation_method == "MANUAL_OVERRIDE"
    actions = list(await session.scalars(select(AuditLog.action)))
    assert "delivery.manual_confirm" in actions
    events = list(await session.scalars(select(OutboxEvent.event_type)))
    assert "DELIVERY_MANUAL_CONFIRMED" in events


async def test_del_014_regenerate_resets_attempts(client: AsyncClient, session: AsyncSession):
    ctx, _, _, delivery, courier = await dispatched(client, session)
    first = codes.decrypt(delivery.id, delivery.code_encrypted)
    wrong = "000000" if first != "000000" else "111111"
    for _ in range(codes.MAX_ATTEMPTS):
        await client.post(
            f"/api/v1/courier/deliveries/{delivery.id}/confirm",
            headers=auth(courier, ctx.organization),
            json={"code": wrong},
        )
    await session.refresh(delivery)
    assert delivery.code_locked is True
    result = await client.post(
        f"/api/v1/deliveries/{delivery.id}/regenerate-code",
        headers=auth(ctx.user, ctx.organization) | {"Idempotency-Key": str(uuid4())},
    )
    assert result.status_code == 200, result.text
    assert first not in result.text  # DEL-012: not even the regenerate response carries it
    await session.refresh(delivery)
    assert delivery.code_locked is False and delivery.code_attempts == 0
    second = codes.decrypt(delivery.id, delivery.code_encrypted)
    assert second is not None and second != first
    works = await client.post(
        f"/api/v1/courier/deliveries/{delivery.id}/confirm",
        headers=auth(courier, ctx.organization),
        json={"code": second},
    )
    assert works.status_code == 200, works.text


async def test_del_015_delivered_updates_order_and_stock_in_one_transaction(client: AsyncClient, session: AsyncSession):
    ctx, _, order, delivery, courier = await dispatched(client, session)
    code = codes.decrypt(delivery.id, delivery.code_encrypted)
    assert code is not None
    before = await session.scalar(select(Stock.quantity).where(Stock.company_id == ctx.organization.id))
    result = await client.post(
        f"/api/v1/courier/deliveries/{delivery.id}/confirm",
        headers=auth(courier, ctx.organization),
        json={"code": code},
    )
    assert result.status_code == 200, result.text
    await session.refresh(delivery)
    stored = await session.get(Order, UUID(order["id"]))
    assert stored is not None
    after = await session.scalar(select(Stock.quantity).where(Stock.company_id == ctx.organization.id))
    assert delivery.status == "DELIVERED" and delivery.confirmation_method == "CODE"
    assert stored.status == "DELIVERED" and stored.delivered_at is not None
    # The goods left the warehouse in the same transaction that closed the delivery.
    assert before is not None and after is not None and after == before - Decimal("5")


async def test_del_015_order_failure_rolls_the_delivery_back(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    """If the order side refuses, the delivery must not be left marked as handed over."""
    ctx, _, order, delivery, courier = await dispatched(client, session)
    code = codes.decrypt(delivery.id, delivery.code_encrypted)
    assert code is not None

    async def explode(*args: object, **kwargs: object) -> None:
        raise AppError("invalid_transition", 409)

    monkeypatch.setattr("app.modules.delivery.service.order_service.deliver", explode)
    result = await client.post(
        f"/api/v1/courier/deliveries/{delivery.id}/confirm",
        headers=auth(courier, ctx.organization),
        json={"code": code},
    )
    assert result.status_code == 409
    await session.refresh(delivery)
    stored = await session.get(Order, UUID(order["id"]))
    assert stored is not None
    assert delivery.status == "IN_TRANSIT" and delivery.delivered_at is None
    assert stored.status == "IN_TRANSIT"


async def make_run(client: AsyncClient, ctx, courier, delivery_ids: list[str], run_date: str | None = None):
    return await client.post(
        "/api/v1/delivery-runs",
        headers=auth(ctx.user, ctx.organization) | {"Idempotency-Key": str(uuid4())},
        json={
            "courier_id": str(courier.id),
            "run_date": run_date or utcnow().date().isoformat(),
            "delivery_ids": delivery_ids,
        },
    )


async def two_planned(client: AsyncClient, session: AsyncSession):
    """Two ready orders for one company, so a run has something to order."""
    ctx, store, pid, data, uid = await setup(client, session, stock=100)
    first = await ready_order(client, session, ctx, pid, uid)
    second = await ready_order(client, session, ctx, pid, uid)
    rows = list(
        await session.scalars(select(Delivery).where(Delivery.status == "PLANNED").order_by(Delivery.created_at))
    )
    assert len(rows) == 2
    courier = await courier_for(session, ctx.organization)
    return ctx, [first, second], rows, courier


async def test_one_active_delivery_per_order_constraint(client: AsyncClient, session: AsyncSession):
    _, _, _, delivery = await planned(client, session)
    twin = Delivery(
        company_id=delivery.company_id,
        store_id=delivery.store_id,
        order_id=delivery.order_id,
        attempt_no=delivery.attempt_no + 1,
        status="PLANNED",
        address=delivery.address,
    )
    session.add(twin)
    with pytest.raises(DBAPIError):
        async with session.begin_nested():
            await session.flush()


async def test_run_state_machine_start_dispatches_all(client: AsyncClient, session: AsyncSession):
    ctx, _, rows, courier = await two_planned(client, session)
    created = await make_run(client, ctx, courier, [str(rows[0].id), str(rows[1].id)])
    assert created.status_code == 201, created.text
    run = created.json()
    assert run["status"] == "DRAFT" and [stop["stop_sequence"] for stop in run["stops"]] == [1, 2]
    assert all(stop["status"] == "ASSIGNED" for stop in run["stops"])
    started = await client.post(
        f"/api/v1/delivery-runs/{run['id']}/start",
        headers=auth(ctx.user, ctx.organization) | {"Idempotency-Key": str(uuid4())},
    )
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "STARTED"
    # Starting a run puts every stop on the road at once, each with its own code.
    for row in rows:
        await session.refresh(row)
        assert row.status == "IN_TRANSIT" and row.code_hash is not None
    assert rows[0].code_hash != rows[1].code_hash


async def test_run_finish_requires_every_stop_terminal(client: AsyncClient, session: AsyncSession):
    ctx, _, rows, courier = await two_planned(client, session)
    run = (await make_run(client, ctx, courier, [str(rows[0].id), str(rows[1].id)])).json()
    headers = auth(ctx.user, ctx.organization)
    await client.post(f"/api/v1/delivery-runs/{run['id']}/start", headers=headers | {"Idempotency-Key": str(uuid4())})
    early = await client.post(
        f"/api/v1/delivery-runs/{run['id']}/finish", headers=headers | {"Idempotency-Key": str(uuid4())}
    )
    assert early.status_code == 409, early.text
    for row in rows:
        await session.refresh(row)
        code = codes.decrypt(row.id, row.code_encrypted)
        done = await client.post(
            f"/api/v1/courier/deliveries/{row.id}/confirm",
            headers=auth(courier, ctx.organization),
            json={"code": code},
        )
        assert done.status_code == 200, done.text
    late = await client.post(
        f"/api/v1/delivery-runs/{run['id']}/finish", headers=headers | {"Idempotency-Key": str(uuid4())}
    )
    assert late.status_code == 200 and late.json()["status"] == "FINISHED"


async def test_run_not_editable_once_started(client: AsyncClient, session: AsyncSession):
    ctx, _, rows, courier = await two_planned(client, session)
    run = (await make_run(client, ctx, courier, [str(rows[0].id), str(rows[1].id)])).json()
    headers = auth(ctx.user, ctx.organization)
    reorder = await client.patch(
        f"/api/v1/delivery-runs/{run['id']}",
        headers=headers,
        json={"delivery_ids": [str(rows[1].id), str(rows[0].id)], "version": run["version"]},
    )
    assert reorder.status_code == 200, reorder.text
    assert [stop["stop_sequence"] for stop in reorder.json()["stops"]] == [1, 2]
    assert reorder.json()["stops"][0]["id"] == str(rows[1].id)
    await client.post(f"/api/v1/delivery-runs/{run['id']}/start", headers=headers | {"Idempotency-Key": str(uuid4())})
    frozen = await client.patch(
        f"/api/v1/delivery-runs/{run['id']}",
        headers=headers,
        json={"delivery_ids": [str(rows[0].id)], "version": reorder.json()["version"]},
    )
    assert frozen.status_code == 409 and frozen.json()["error"]["code"] == "run_not_editable"


async def test_run_cancel_returns_stops_to_the_pool(client: AsyncClient, session: AsyncSession):
    ctx, _, rows, courier = await two_planned(client, session)
    run = (await make_run(client, ctx, courier, [str(rows[0].id), str(rows[1].id)])).json()
    result = await client.post(
        f"/api/v1/delivery-runs/{run['id']}/cancel",
        headers=auth(ctx.user, ctx.organization) | {"Idempotency-Key": str(uuid4())},
    )
    assert result.status_code == 200 and result.json()["status"] == "CANCELLED"
    for row in rows:
        await session.refresh(row)
        assert row.status == "PLANNED" and row.run_id is None and row.courier_id is None


async def test_permission_matrix_p08(client: AsyncClient, session: AsyncSession):
    from app.core.permissions import permissions_for

    expected = {
        ("COMPANY", "OWNER"): {"view_all", "plan", "act_own", "act_any", "manual_confirm", "regenerate_code"},
        ("COMPANY", "MANAGER"): {"view_all", "plan", "act_own", "act_any", "manual_confirm", "regenerate_code"},
        ("COMPANY", "OPERATOR"): {"view_all"},
        ("COMPANY", "WAREHOUSE"): {"view_all"},
        ("COMPANY", "COURIER"): {"act_own"},
        ("STORE", "OWNER"): {"view_store"},
        ("STORE", "SELLER"): {"view_store"},
    }
    for (org_type, role), codes_expected in expected.items():
        granted = {name.split(".", 1)[1] for name in permissions_for(org_type, role) if name.startswith("delivery.")}
        assert granted == codes_expected, (org_type, role, granted)
    # A courier cannot plan, and an operator cannot act.
    ctx, _, _, delivery = await planned(client, session)
    courier = await courier_for(session, ctx.organization)
    refused = await client.post(
        f"/api/v1/deliveries/{delivery.id}/assign",
        headers=auth(courier, ctx.organization),
        json={"courier_id": str(courier.id), "version": delivery.version},
    )
    assert refused.status_code == 403


def operation(kind: str, entity, *, payload=None, expected=None, offset_seconds: int = 0):
    return {
        "operation_id": str(uuid4()),
        "operation_type": kind,
        "entity_id": str(entity),
        "payload": payload or {},
        "expected_status": expected,
        "client_created_at": (utcnow() + timedelta(seconds=offset_seconds)).isoformat(),
    }


async def sync(client: AsyncClient, courier, org, operations: list[dict]):
    result = await client.post("/api/v1/courier/sync", headers=auth(courier, org), json={"operations": operations})
    assert result.status_code == 200, result.text
    return {row["operation_id"]: row for row in result.json()["results"]}


async def test_del_022_sync_processes_in_client_order(client: AsyncClient, session: AsyncSession):
    """Arrive then confirm, queued offline, applied in the order the phone recorded them."""
    ctx, _, _, delivery, courier = await dispatched(client, session)
    code = codes.decrypt(delivery.id, delivery.code_encrypted)
    arrive = operation("DELIVERY_ARRIVE", delivery.id, expected="IN_TRANSIT", offset_seconds=0)
    confirm_op = operation(
        "DELIVERY_CONFIRM", delivery.id, payload={"code": code}, expected="ARRIVED", offset_seconds=5
    )
    # Deliberately handed over in the wrong order: the server sorts by client_created_at.
    results = await sync(client, courier, ctx.organization, [confirm_op, arrive])
    assert results[arrive["operation_id"]]["result_status"] == "APPLIED"
    assert results[confirm_op["operation_id"]]["result_status"] == "APPLIED"
    await session.refresh(delivery)
    assert delivery.status == "DELIVERED"
    history = list(
        await session.scalars(
            select(DeliveryStatusHistory)
            .where(DeliveryStatusHistory.delivery_id == delivery.id)
            .order_by(DeliveryStatusHistory.created_at)
        )
    )
    assert [row.to_status for row in history][-2:] == ["ARRIVED", "DELIVERED"]
    assert {row.source for row in history[-2:]} == {"OFFLINE_SYNC"}


async def test_del_022_each_operation_commits_on_its_own(client: AsyncClient, session: AsyncSession):
    """A rejected operation later in the batch must not undo one that already succeeded."""
    ctx, _, _, delivery, courier = await dispatched(client, session)
    good = operation("DELIVERY_ARRIVE", delivery.id, offset_seconds=0)
    bad = operation("PAYMENT_RECORD", delivery.id, offset_seconds=5)
    results = await sync(client, courier, ctx.organization, [good, bad])
    assert results[good["operation_id"]]["result_status"] == "APPLIED"
    assert results[bad["operation_id"]]["result_status"] == "REJECTED"
    assert results[bad["operation_id"]]["error"] == "not_supported"
    await session.refresh(delivery)
    assert delivery.status == "ARRIVED"


async def test_del_023_duplicate_operation_returns_same_result(client: AsyncClient, session: AsyncSession):
    ctx, _, _, delivery, courier = await dispatched(client, session)
    arrive = operation("DELIVERY_ARRIVE", delivery.id)
    first = await sync(client, courier, ctx.organization, [arrive])
    assert first[arrive["operation_id"]]["result_status"] == "APPLIED"
    # The same queue replayed: the work is not done twice.
    again = await sync(client, courier, ctx.organization, [arrive])
    assert again[arrive["operation_id"]]["result_status"] == "DUPLICATE"
    await session.refresh(delivery)
    assert delivery.status == "ARRIVED"
    rows = list(await session.scalars(select(CourierSyncOperation)))
    assert len(rows) == 1
    arrivals = [
        row
        for row in await session.scalars(
            select(DeliveryStatusHistory).where(DeliveryStatusHistory.delivery_id == delivery.id)
        )
        if row.to_status == "ARRIVED"
    ]
    assert len(arrivals) == 1


async def test_del_024_conflict_returns_server_state(client: AsyncClient, session: AsyncSession):
    """The delivery was failed online while the phone was offline holding a confirm."""
    ctx, _, _, delivery, courier = await dispatched(client, session)
    code = codes.decrypt(delivery.id, delivery.code_encrypted)
    failed = await client.post(
        f"/api/v1/courier/deliveries/{delivery.id}/fail",
        headers=auth(courier, ctx.organization),
        json={"reason_code": "REFUSED"},
    )
    assert failed.status_code == 200, failed.text
    stale = operation("DELIVERY_CONFIRM", delivery.id, payload={"code": code}, expected="ARRIVED")
    results = await sync(client, courier, ctx.organization, [stale])
    row = results[stale["operation_id"]]
    assert row["result_status"] == "CONFLICT"
    assert row["server_state"] is not None and row["server_state"]["status"] == "FAILED"
    await session.refresh(delivery)
    assert delivery.status == "FAILED"


async def test_del_025_confirm_after_arrive_is_applied(client: AsyncClient, session: AsyncSession):
    """The client expected IN_TRANSIT but the server is already ARRIVED; confirm is still legal."""
    ctx, _, _, delivery, courier = await dispatched(client, session)
    code = codes.decrypt(delivery.id, delivery.code_encrypted)
    await client.post(f"/api/v1/courier/deliveries/{delivery.id}/arrive", headers=auth(courier, ctx.organization))
    stale = operation("DELIVERY_CONFIRM", delivery.id, payload={"code": code}, expected="IN_TRANSIT")
    results = await sync(client, courier, ctx.organization, [stale])
    assert results[stale["operation_id"]]["result_status"] == "APPLIED"
    await session.refresh(delivery)
    assert delivery.status == "DELIVERED"


async def test_del_026_invalid_code_is_rejected(client: AsyncClient, session: AsyncSession):
    ctx, _, _, delivery, courier = await dispatched(client, session)
    wrong = operation("DELIVERY_CONFIRM", delivery.id, payload={"code": "000001"}, expected="IN_TRANSIT")
    results = await sync(client, courier, ctx.organization, [wrong])
    row = results[wrong["operation_id"]]
    assert row["result_status"] == "REJECTED" and row["error"] == "delivery_code_invalid"
    await session.refresh(delivery)
    assert delivery.status == "IN_TRANSIT" and delivery.code_attempts == 1


async def test_del_021_queued_code_is_not_stored_in_the_sync_log(client: AsyncClient, session: AsyncSession):
    ctx, _, _, delivery, courier = await dispatched(client, session)
    code = codes.decrypt(delivery.id, delivery.code_encrypted)
    assert code is not None
    confirm_op = operation("DELIVERY_CONFIRM", delivery.id, payload={"code": code}, expected="IN_TRANSIT")
    await sync(client, courier, ctx.organization, [confirm_op])
    row = (await session.scalars(select(CourierSyncOperation))).one()
    assert "code" not in row.payload
    assert code not in str(row.payload) and code not in str(row.result)


async def test_courier_sync_log_is_append_only(client: AsyncClient, session: AsyncSession):
    ctx, _, _, delivery, courier = await dispatched(client, session)
    await sync(client, courier, ctx.organization, [operation("DELIVERY_ARRIVE", delivery.id)])
    for statement in [
        "UPDATE courier_sync_operations SET result_status='APPLIED'",
        "DELETE FROM courier_sync_operations",
        "UPDATE delivery_status_history SET to_status='DELIVERED'",
        "DELETE FROM delivery_status_history",
    ]:
        with pytest.raises(DBAPIError):
            async with session.begin_nested():
                await session.execute(text(statement))


async def test_sync_cannot_act_on_or_disclose_another_couriers_stop(client: AsyncClient, session: AsyncSession):
    ctx, _, _, delivery, courier = await dispatched(client, session)
    other = await courier_for(session, ctx.organization, "foreign-courier@example.com")
    code = codes.decrypt(delivery.id, delivery.code_encrypted)
    op = operation("DELIVERY_CONFIRM", delivery.id, payload={"code": code})
    result = (await sync(client, other, ctx.organization, [op]))[op["operation_id"]]
    assert result["server_state"] is None
    assert result["result_status"] == "REJECTED"
    await session.refresh(delivery)
    assert delivery.status == "IN_TRANSIT" and delivery.code_attempts == 0
    replay = (await sync(client, courier, ctx.organization, [op]))[op["operation_id"]]
    assert replay["result_status"] == "REJECTED" and replay["server_state"] is None


async def test_sync_duplicate_keeps_the_original_conflict_state(client: AsyncClient, session: AsyncSession):
    ctx, _, _, delivery, courier = await dispatched(client, session)
    await client.post(f"/api/v1/courier/deliveries/{delivery.id}/arrive", headers=auth(courier, ctx.organization))
    op = operation("DELIVERY_ARRIVE", delivery.id)
    first = (await sync(client, courier, ctx.organization, [op]))[op["operation_id"]]
    await client.post(
        f"/api/v1/courier/deliveries/{delivery.id}/fail",
        headers=auth(courier, ctx.organization),
        json={"reason_code": "REFUSED"},
    )
    again = (await sync(client, courier, ctx.organization, [op]))[op["operation_id"]]
    assert again["result_status"] == "DUPLICATE"
    assert again["server_state"] == first["server_state"]
    assert again["server_state"]["status"] == "ARRIVED"


async def test_sync_retention_allows_only_old_log_deletion(client: AsyncClient, session: AsyncSession):
    from app.celery_app import purge_courier_sync_operations

    ctx, _, _, delivery, courier = await dispatched(client, session)
    op = operation("DELIVERY_ARRIVE", delivery.id)
    await sync(client, courier, ctx.organization, [op])
    old = CourierSyncOperation(
        id=uuid4(),
        courier_id=courier.id,
        operation_type="PAYMENT_RECORD",
        entity_id=delivery.id,
        payload={},
        client_created_at=utcnow() - timedelta(days=31),
        received_at=utcnow() - timedelta(days=31),
        result_status="REJECTED",
        result={},
    )
    session.add(old)
    await session.commit()
    await session.execute(text("DELETE FROM courier_sync_operations WHERE received_at < now() - interval '30 days'"))
    await session.commit()
    assert await session.get(CourierSyncOperation, UUID(op["operation_id"])) is not None
    assert purge_courier_sync_operations.name == "tezfarmo.purge_courier_sync_operations"


async def test_run_cannot_steal_another_runs_stop(client: AsyncClient, session: AsyncSession):
    ctx, _, deliveries, courier = await two_planned(client, session)
    first = await make_run(client, ctx, courier, [str(deliveries[0].id)])
    assert first.status_code == 201
    second = await make_run(client, ctx, courier, [str(deliveries[0].id), str(deliveries[1].id)])
    assert second.status_code == 422
    await session.refresh(deliveries[0])
    assert str(deliveries[0].run_id) == first.json()["id"]


async def test_courier_today_contains_multiple_runs_and_terminal_stops(client: AsyncClient, session: AsyncSession):
    from zoneinfo import ZoneInfo

    ctx, _, deliveries, courier = await two_planned(client, session)
    local_date = utcnow().astimezone(ZoneInfo("Asia/Dushanbe")).date().isoformat()
    for row in deliveries:
        run = await make_run(client, ctx, courier, [str(row.id)], local_date)
        assert run.status_code == 201
    result = await client.get("/api/v1/courier/today", headers=auth(courier, ctx.organization))
    assert result.status_code == 200
    assert len(result.json()["runs"]) == 2 and len(result.json()["stops"]) == 2
