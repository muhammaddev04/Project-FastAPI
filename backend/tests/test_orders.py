import ast
import asyncio
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.errors import AppError
from app.core.time import utcnow
from app.modules.catalog.models import Price, Product, ProductUnit
from app.modules.identity.deps import OrgContext
from app.modules.identity.models import Membership
from app.modules.inventory.models import Stock, StockReservation
from app.modules.inventory.service import stock_service
from app.modules.orders import ports, service
from app.modules.orders.models import STATUSES, Order, OrderItem
from app.modules.subscriptions.models import Subscription
from tests.factories import add_member, auth, make_org, make_user
from tests.test_catalog import product
from tests.test_partnerships import activated


async def setup(client: AsyncClient, session: AsyncSession, *, stock: int = 100, base_unit: str = "PCS"):
    owner, company, store, terms, pid = await activated(client, session)
    membership = (await session.scalars(select(Membership).where(Membership.organization_id == company.id))).one()
    context = OrgContext(owner, membership, company)
    data = await product(client, context, base_unit=base_unit)
    unit = data["units"][0]
    session.add(
        Price(
            price_list_id=UUID(terms["price_list_id"]),
            product_unit_id=UUID(unit["id"]),
            price=Decimal("10"),
            valid_from=utcnow() - timedelta(days=1),
            created_by=owner.id,
        )
    )
    if stock:
        await stock_service.receive(session, company.id, [(UUID(str(data["id"])), Decimal(stock))], owner.id)
    await session.commit()
    return context, store, UUID(pid), data, UUID(unit["id"])


async def create(client, context, pid, uid, quantity="5"):
    result = await client.post(
        "/api/v1/orders",
        headers=auth(context.user, context.organization),
        json={"partnership_id": str(pid), "items": [{"product_unit_id": str(uid), "quantity": quantity}]},
    )
    assert result.status_code == 201, result.text
    return result.json()


def confirmation(order, quantity="5", **extra):
    return {
        "version": order["version"],
        "lines": [{"item_id": row["id"], "confirmed_quantity": quantity} for row in order["items"]],
        **extra,
    }


async def confirm(client, ctx, order, quantity="5", **extra):
    result = await client.post(
        f"/api/v1/orders/{order['id']}/confirm",
        headers=auth(ctx.user, ctx.organization),
        json=confirmation(order, quantity, **extra),
    )
    assert result.status_code == 200, result.text
    return result.json()


async def test_ord_007_price_snapshot_create_no_reservation_and_immutable(client: AsyncClient, session: AsyncSession):
    ctx, _, pid, data, uid = await setup(client, session, stock=0)
    order = await create(client, ctx, pid, uid)
    assert Decimal(order["requested_subtotal"]) == 50
    assert order["source"] == "COMPANY_ON_BEHALF" and order["order_number"].endswith("000001")
    assert await session.scalar(select(func.count()).select_from(StockReservation)) == 0
    for statement in [
        "UPDATE order_items SET unit_price=20, line_total=100",
        "UPDATE order_items SET requested_quantity=10, line_total=100",
        "DELETE FROM order_items",
        "UPDATE orders SET delivery_address='Elsewhere'",
        "UPDATE order_status_history SET to_status='CANCELLED'",
        "DELETE FROM order_status_history",
    ]:
        with pytest.raises(DBAPIError):
            async with session.begin_nested():
                await session.execute(text(statement))
    item = (await session.scalars(select(OrderItem))).one()
    assert item.product_name_snapshot == "Tea" and item.product_id == UUID(str(data["id"]))
    price = (await session.scalars(select(Price))).one()
    price.valid_to = utcnow()
    session.add(
        Price(
            price_list_id=price.price_list_id,
            product_unit_id=uid,
            price=Decimal("20"),
            valid_from=price.valid_to,
            created_by=ctx.user.id,
        )
    )
    prod = await session.get(Product, item.product_id)
    prod.name = "New name"
    await session.commit()
    assert (
        Decimal(
            (await client.get(f"/api/v1/orders/{order['id']}", headers=auth(ctx.user, ctx.organization))).json()[
                "items"
            ][0]["unit_price"]
        )
        == 10
    )


@pytest.mark.parametrize(
    "quantity,base,valid",
    [("0.5", "PCS", False), ("0.1", "KG", False), ("1.001", "KG", True), ("1.0001", "KG", False), ("0", "PCS", False)],
)
async def test_ord_003_quantity_rules(client, session, quantity, base, valid):
    ctx, _, pid, _, uid = await setup(client, session, base_unit=base)
    result = await client.post(
        "/api/v1/orders",
        headers=auth(ctx.user, ctx.organization),
        json={"partnership_id": str(pid), "items": [{"product_unit_id": str(uid), "quantity": quantity}]},
    )
    assert result.status_code == (201 if valid else 422)


async def test_ord_004_merges_duplicates(client, session):
    ctx, _, pid, _, uid = await setup(client, session)
    result = await client.post(
        "/api/v1/orders",
        headers=auth(ctx.user, ctx.organization),
        json={
            "partnership_id": str(pid),
            "items": [{"product_unit_id": str(uid), "quantity": "2"}, {"product_unit_id": str(uid), "quantity": "3"}],
        },
    )
    assert result.status_code == 201 and len(result.json()["items"]) == 1
    assert Decimal(result.json()["items"][0]["requested_quantity"]) == 5


async def test_ord_008_personal_cart_checkout_idempotent_atomic_clear(client, session):
    ctx, store, pid, _, uid = await setup(client, session)
    headers = auth(ctx.user, store)
    path = f"/api/v1/store/cart/{pid}"
    cart = await client.put(f"{path}/items/{uid}", headers=headers, json={"quantity": "5"})
    assert cart.status_code == 200 and Decimal(cart.json()["subtotal"]) == 50
    seller = await make_user(session)
    await add_member(session, store, seller, "SELLER")
    await session.commit()
    assert (await client.get(path, headers=auth(seller, store))).json()["items"] == []
    first = await client.post(f"{path}/checkout", headers=headers, json={"store_note": "Deliver tomorrow"})
    assert first.status_code == 201, first.text
    retry = await client.post(f"{path}/checkout", headers=headers, json={"store_note": "Deliver tomorrow"})
    assert retry.json() == first.json()
    assert first.json()["source"] == "STORE" and first.json()["store_note"] == "Deliver tomorrow"
    assert (await client.get(path, headers=headers)).json()["items"] == []
    assert await session.scalar(select(func.count()).select_from(Order)) == 1


@pytest.mark.parametrize(
    "block", ["partnership", "subscription", "inactive_product", "inactive_unit", "price", "minimum"]
)
async def test_ord_001_002_005_creation_guards(client, session, block):
    ctx, store, pid, data, uid = await setup(client, session)
    if block == "partnership":
        await client.post(
            f"/api/v1/partnerships/{pid}/suspend", headers=auth(ctx.user, ctx.organization), json={"reason": "Review"}
        )
    elif block == "subscription":
        sub = (await session.scalars(select(Subscription))).one()
        sub.status = "SOFT_BLOCK"
        sub.soft_block_ends_at = utcnow() + timedelta(days=5)
        await session.commit()
    elif block == "inactive_unit":
        unit = ProductUnit(
            product_id=UUID(str(data["id"])), code="BOX", name={"en": "Box"}, coefficient=Decimal("2"), is_active=False
        )
        session.add(unit)
        await session.flush()
        uid = unit.id
        session.add(
            Price(
                price_list_id=(await session.scalars(select(Price.price_list_id))).one(),
                product_unit_id=uid,
                price=Decimal("20"),
                valid_from=utcnow() - timedelta(hours=1),
                created_by=ctx.user.id,
            )
        )
        await session.commit()
    elif block == "inactive_product":
        entity = await session.get(
            Product if block == "inactive_product" else ProductUnit,
            UUID(str(data["id"])) if block == "inactive_product" else uid,
        )
        entity.is_active = False
        await session.commit()
    elif block == "price":
        price = (await session.scalars(select(Price))).one()
        price.valid_to = utcnow() - timedelta(seconds=1)
        await session.commit()
    else:
        terms = (await client.get(f"/api/v1/partnerships/{pid}", headers=auth(ctx.user, ctx.organization))).json()[
            "current_terms"
        ]
        payload = {
            k: v for k, v in terms.items() if k in {"price_list_id", "payment_methods", "credit_limit", "credit_days"}
        }
        payload["minimum_order_amount"] = "1000"
        await client.post(f"/api/v1/partnerships/{pid}/terms", headers=auth(ctx.user, ctx.organization), json=payload)
    result = await client.post(
        "/api/v1/orders",
        headers=auth(ctx.user, ctx.organization),
        json={"partnership_id": str(pid), "items": [{"product_unit_id": str(uid), "quantity": "5"}]},
    )
    assert result.status_code in {403, 409, 422}, result.text
    assert await session.scalar(select(func.count()).select_from(Order)) == 0


async def test_ord_024_insufficient_stock_rolls_back_confirmation(client, session):
    ctx, _, pid, _, uid = await setup(client, session, stock=2)
    order = await create(client, ctx, pid, uid)
    response = await client.post(
        f"/api/v1/orders/{order['id']}/confirm", headers=auth(ctx.user, ctx.organization), json=confirmation(order)
    )
    assert response.status_code == 409 and response.json()["error"]["code"] == "insufficient_stock"
    stored = (await client.get(f"/api/v1/orders/{order['id']}", headers=auth(ctx.user, ctx.organization))).json()
    assert stored["status"] == "NEW" and stored["terms_id"] is None and stored["items"][0]["confirmed_quantity"] is None
    assert await session.scalar(select(func.count()).select_from(StockReservation)) == 0


async def test_ord_020_021_026_partial_and_version_and_zero(client, session):
    ctx, _, pid, _, uid = await setup(client, session)
    order = await create(client, ctx, pid, uid)
    for values, code in [
        (confirmation(order, "0"), "validation_error"),
        (confirmation(order, "6"), "quantity_invalid"),
        (confirmation(order, version=999), "version_conflict"),
    ]:
        result = await client.post(
            f"/api/v1/orders/{order['id']}/confirm", headers=auth(ctx.user, ctx.organization), json=values
        )
        assert result.json()["error"]["code"] == code
    order = await confirm(client, ctx, order, "3")
    assert order["status"] == "PARTIALLY_CONFIRMED" and Decimal(order["items"][0]["rejected_quantity"]) == 2
    stock = (await session.scalars(select(Stock).execution_options(populate_existing=True))).one()
    assert stock.reserved_quantity == 3
    with pytest.raises(DBAPIError):
        async with session.begin_nested():
            await session.execute(text("UPDATE order_items SET confirmed_quantity=2, line_total=20"))


async def test_ord_022_023_credit_minimum_discount_overrides_audited(client, session):
    ctx, _, pid, _, uid = await setup(client, session)
    order = await create(client, ctx, pid, uid, "20")
    result = await client.post(
        f"/api/v1/orders/{order['id']}/confirm",
        headers=auth(ctx.user, ctx.organization),
        json=confirmation(order, "20"),
    )
    assert result.json()["error"]["code"] == "credit_limit_exceeded"
    order = await confirm(
        client,
        ctx,
        order,
        "20",
        override_credit_reason="Approved exceptional credit",
        discount="10",
        discount_reason="Promotion",
    )
    assert Decimal(order["total"]) == 190
    actions = set(await session.scalars(select(AuditLog.action).where(AuditLog.entity_id == UUID(order["id"]))))
    assert {"order.credit_override", "order.discount_applied"} <= actions


async def test_ord_010_fulfillment_system_delivery_failure_dispute_and_completion(client, session):
    ctx, _, pid, _, uid = await setup(client, session)
    order = await create(client, ctx, pid, uid)
    viewed = await client.post(f"/api/v1/orders/{order['id']}/mark-viewed", headers=auth(ctx.user, ctx.organization))
    assert viewed.json()["status"] == "VIEWED"
    order = await confirm(client, ctx, viewed.json())
    for endpoint, expected in [("start-assembling", "ASSEMBLING"), ("mark-ready", "READY_FOR_DELIVERY")]:
        response = await client.post(
            f"/api/v1/orders/{order['id']}/{endpoint}",
            headers=auth(ctx.user, ctx.organization),
            json={"version": order["version"]},
        )
        assert response.status_code == 200, response.text
        order = response.json()
        assert order["status"] == expected
    actor = service.SystemActor("DELIVERY")
    oid = UUID(order["id"])
    for action in ["dispatch", "fail"]:
        await service.order_service.system(session, actor, oid, action, reason="Address unavailable")
        await session.commit()
    stored = (await client.get(f"/api/v1/orders/{oid}", headers=auth(ctx.user, ctx.organization))).json()
    result = await client.post(
        f"/api/v1/orders/{oid}/reattempt", headers=auth(ctx.user, ctx.organization), json={"version": stored["version"]}
    )
    assert result.json()["status"] == "READY_FOR_DELIVERY"
    await service.order_service.system(session, actor, oid, "dispatch")
    await service.order_service.system(session, actor, oid, "deliver", delivered_at=utcnow() - timedelta(hours=49))
    await session.commit()
    stock = (await session.scalars(select(Stock).execution_options(populate_existing=True))).one()
    assert stock.quantity == 95 and stock.reserved_quantity == 0
    await service.order_service.system(session, service.SystemActor("DISPUTE"), oid, "dispute")
    await service.order_service.system(session, service.SystemActor("DISPUTE"), oid, "complete")
    await session.commit()
    assert (await client.get(f"/api/v1/orders/{oid}", headers=auth(ctx.user, ctx.organization))).json()[
        "status"
    ] == "COMPLETED"
    assert await service.complete_due(session) == 0


async def test_ord_041_completion_window_and_open_dispute(client, session, monkeypatch):
    ctx, _, pid, _, uid = await setup(client, session)
    order = await confirm(client, ctx, await create(client, ctx, pid, uid))
    oid = UUID(order["id"])
    for target in ["ASSEMBLING", "READY_FOR_DELIVERY"]:
        # Exercise the central transition writer for this internal fixture setup.
        obj = await service.locked(session, await session.get(Order, oid))
        await service._apply_transition(session, obj, target, ctx)
    actor = service.SystemActor("DELIVERY")
    await service.order_service.system(session, actor, oid, "dispatch")
    await service.order_service.system(session, actor, oid, "deliver")
    await session.commit()
    assert await service.complete_due(session) == 0
    obj = await session.get(Order, oid)
    obj.delivered_at = utcnow() - timedelta(hours=49)
    await session.commit()

    class Open:
        async def has_open(self, session, order_id):
            return True

    monkeypatch.setattr(ports, "open_dispute", Open())
    assert await service.complete_due(session) == 0
    monkeypatch.setattr(ports, "open_dispute", ports.FutureDispute())
    assert await service.complete_due(session) == 1
    await session.commit()
    assert await service.complete_due(session) == 0


async def test_ord_030_seller_own_and_032_cancel_releases(client, session):
    ctx, store, pid, _, uid = await setup(client, session)
    order = await create(client, ctx, pid, uid)
    seller = await make_user(session)
    await add_member(session, store, seller, "SELLER")
    await session.commit()
    result = await client.post(
        f"/api/v1/orders/{order['id']}/cancel",
        headers=auth(seller, store),
        json={"version": order["version"], "reason": "Cancel"},
    )
    assert result.status_code == 403
    order = await confirm(client, ctx, order)
    result = await client.post(
        f"/api/v1/orders/{order['id']}/cancel",
        headers=auth(ctx.user, ctx.organization),
        json={"version": order["version"], "reason": "Customer changed plans"},
    )
    assert result.status_code == 200 and result.json()["status"] == "CANCELLED"
    stock = (await session.scalars(select(Stock).execution_options(populate_existing=True))).one()
    assert stock.reserved_quantity == 0 and stock.quantity == 100


async def test_prt_009_termination_cancels_only_open_orders(client, session):
    ctx, store, pid, _, uid = await setup(client, session)
    early = await create(client, ctx, pid, uid)
    confirmed = await confirm(client, ctx, await create(client, ctx, pid, uid))
    result = await client.post(
        f"/api/v1/partnerships/{pid}/terminate", headers=auth(ctx.user, store), json={"reason": "Partnership ended"}
    )
    assert result.status_code == 200
    for order, expected in [(early, "CANCELLED"), (confirmed, "CONFIRMED")]:
        stored = (await client.get(f"/api/v1/orders/{order['id']}", headers=auth(ctx.user, ctx.organization))).json()
        assert stored["status"] == expected


async def test_ord_024_concurrent_confirmation_only_one_reserves(client, session):
    ctx, _, pid, _, uid = await setup(client, session, stock=10)
    orders = [await create(client, ctx, pid, uid, "8") for _ in range(2)]

    async def attempt(order):
        return await client.post(
            f"/api/v1/orders/{order['id']}/confirm",
            headers=auth(ctx.user, ctx.organization),
            json=confirmation(order, "8"),
        )

    results = await asyncio.wait_for(asyncio.gather(*(attempt(order) for order in orders)), timeout=30)
    assert sorted(row.status_code for row in results) == [200, 409]
    stock = (await session.scalars(select(Stock).execution_options(populate_existing=True))).one()
    assert stock.quantity == 10 and stock.reserved_quantity == 8


async def test_ord_040_catalog_no_exact_stock_and_repeat_reprices(client, session):
    ctx, store, pid, _, uid = await setup(client, session)
    result = await client.get(f"/api/v1/store/catalog/{pid}/products", headers=auth(ctx.user, store))
    assert result.status_code == 200, result.text
    unit = result.json()["results"][0]["units"][0]
    assert unit["availability_status"] == "IN_STOCK" and "available" not in unit and "quantity" not in unit
    order = await create(client, ctx, pid, uid)
    price = (await session.scalars(select(Price))).one()
    price.valid_to = utcnow()
    session.add(
        Price(
            price_list_id=price.price_list_id,
            product_unit_id=uid,
            price=Decimal("12"),
            valid_from=price.valid_to,
            created_by=ctx.user.id,
        )
    )
    await session.commit()
    repeated = await client.post(f"/api/v1/store/orders/{order['id']}/repeat", headers=auth(ctx.user, store))
    assert repeated.status_code == 200 and Decimal(repeated.json()["subtotal"]) == 60


async def test_ord_042_043_warehouse_no_prices_and_cross_tenant(client, session):
    ctx, store, pid, _, uid = await setup(client, session)
    order = await create(client, ctx, pid, uid)
    warehouse = await make_user(session)
    await add_member(session, ctx.organization, warehouse, "WAREHOUSE")
    other = await make_org(session, ctx.user)
    other_store = await make_org(session, ctx.user, "STORE")
    await session.commit()
    for user, org in [(ctx.user, other), (ctx.user, other_store), (warehouse, ctx.organization)]:
        assert (await client.get(f"/api/v1/orders/{order['id']}", headers=auth(user, org))).status_code == 404
    order = await confirm(client, ctx, order)
    result = await client.get(f"/api/v1/orders/{order['id']}", headers=auth(warehouse, ctx.organization))
    assert result.status_code == 200
    body = result.json()
    for key in {"total", "subtotal", "requested_subtotal", "discount", "terms_snapshot", "credit_override_reason"}:
        assert key not in body
    assert "unit_price" not in body["items"][0] and "line_total" not in body["items"][0]
    pick = await client.get(f"/api/v1/orders/{order['id']}/pick-list", headers=auth(warehouse, ctx.organization))
    assert pick.status_code == 200 and "Tea" in pick.text and "10.00" not in pick.text


async def test_ord_010_all_invalid_transition_pairs_and_011_single_writer():
    expected = {
        "view": {"NEW"},
        "confirm": {"NEW", "VIEWED"},
        "partial": {"NEW", "VIEWED"},
        "reject": {"NEW", "VIEWED"},
        "cancel": {
            "NEW",
            "VIEWED",
            "CONFIRMED",
            "PARTIALLY_CONFIRMED",
            "ASSEMBLING",
            "READY_FOR_DELIVERY",
            "DELIVERY_FAILED",
        },
        "assemble": {"CONFIRMED", "PARTIALLY_CONFIRMED"},
        "ready": {"ASSEMBLING"},
        "reattempt": {"DELIVERY_FAILED"},
        "dispatch": {"READY_FOR_DELIVERY"},
        "deliver": {"IN_TRANSIT"},
        "fail": {"IN_TRANSIT"},
        "dispute": {"DELIVERED"},
        "complete": {"DELIVERED", "DISPUTED"},
        "terminate": {"NEW", "VIEWED"},
    }
    assert service.TRANSITIONS == expected
    for status in STATUSES:
        order = Order(status=status)
        for action, sources in expected.items():
            if status not in sources:
                with pytest.raises(AppError) as exc:
                    service.transition_allowed(order, action)
                assert exc.value.code == "invalid_transition"
    for path in (Path(__file__).resolve().parents[1] / "app").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name != "_apply_transition":
                for child in ast.walk(node):
                    if isinstance(child, ast.Assign):
                        assert not any(
                            isinstance(target, ast.Attribute)
                            and isinstance(target.value, ast.Name)
                            and target.value.id == "order"
                            and target.attr == "status"
                            for target in child.targets
                        ), str(path)


@pytest.mark.parametrize(
    "side,role",
    [("COMPANY", role) for role in ["OWNER", "MANAGER", "OPERATOR", "WAREHOUSE", "COURIER"]]
    + [("STORE", "OWNER"), ("STORE", "SELLER")],
)
async def test_permission_matrix_p07(client, session, side, role):
    from app.core.permissions import permissions_for

    ctx, store, pid, _, uid = await setup(client, session)
    order = await confirm(client, ctx, await create(client, ctx, pid, uid))
    org = ctx.organization if side == "COMPANY" else store
    user = ctx.user
    if role != "OWNER":
        user = await make_user(session)
        await add_member(session, org, user, role)
        await session.commit()
    rights = permissions_for(side, role)
    headers = auth(user, org)
    assert (await client.get("/api/v1/orders", headers=headers)).status_code == (
        200 if "orders.view" in rights else 403
    )
    for endpoint, permission in [
        ("confirm", "orders.confirm"),
        ("reject", "orders.reject"),
        ("cancel", "orders.cancel"),
        ("start-assembling", "orders.assemble"),
        ("mark-ready", "orders.assemble"),
        ("reattempt", "orders.reattempt"),
    ]:
        payload = {"version": 999, "reason": "Test"} if endpoint in {"reject", "cancel"} else {"version": 999}
        if endpoint == "confirm":
            payload = confirmation(order, version=999)
        response = await client.post(
            f"/api/v1/orders/{order['id']}/{endpoint}",
            headers=auth(user, org),
            json=payload,
        )
        assert response.status_code == (409 if permission in rights else 403), (side, role, endpoint, response.text)
    response = await client.get(f"/api/v1/store/catalog/{pid}/products", headers=headers)
    assert response.status_code == (200 if side == "STORE" else 403)
    for path in ["dispatch", "deliver", "fail-delivery", "mark-disputed", "complete"]:
        assert (await client.post(f"/api/v1/orders/{order['id']}/{path}", headers=headers, json={})).status_code == 404


async def test_ord_022_current_terms_delivery_threshold_and_minimum_override(client, session):
    ctx, _, pid, _, uid = await setup(client, session)
    first = await create(client, ctx, pid, uid)
    second = await create(client, ctx, pid, uid, "8")
    terms = (await client.get(f"/api/v1/partnerships/{pid}", headers=auth(ctx.user, ctx.organization))).json()[
        "current_terms"
    ]
    payload = {
        k: v for k, v in terms.items() if k in {"price_list_id", "payment_methods", "credit_limit", "credit_days"}
    }
    payload.update(minimum_order_amount="60", delivery_fee="7", free_delivery_threshold="50")
    result = await client.post(
        f"/api/v1/partnerships/{pid}/terms", headers=auth(ctx.user, ctx.organization), json=payload
    )
    assert result.status_code == 201, result.text
    operator = await make_user(session)
    await add_member(session, ctx.organization, operator, "OPERATOR")
    await session.commit()
    for extra in [{"discount": "1", "discount_reason": "Sale"}, {"override_minimum_reason": "Exception"}]:
        response = await client.post(
            f"/api/v1/orders/{first['id']}/confirm",
            headers=auth(operator, ctx.organization),
            json=confirmation(first, **extra),
        )
        assert response.status_code == 403
    response = await client.post(
        f"/api/v1/orders/{first['id']}/confirm", headers=auth(ctx.user, ctx.organization), json=confirmation(first)
    )
    assert response.json()["error"]["code"] == "minimum_order_not_met"
    first = await confirm(
        client, ctx, first, "3", override_minimum_reason="Accepted smaller order", discount="5", discount_reason="Sale"
    )
    assert Decimal(first["delivery_fee"]) == 7 and Decimal(first["total"]) == 32
    assert first["terms_id"] == result.json()["id"]
    second = await confirm(client, ctx, second, "8", discount="40", discount_reason="Special price")
    assert Decimal(second["delivery_fee"]) == 0 and Decimal(second["total"]) == 40


async def test_ord_030_031_seller_own_rejection_and_transit_cancellation(client, session):
    ctx, store, pid, _, uid = await setup(client, session)
    seller = await make_user(session)
    await add_member(session, store, seller, "SELLER")
    await session.commit()
    seller_headers = auth(seller, store)
    path = f"/api/v1/store/cart/{pid}"
    await client.put(f"{path}/items/{uid}", headers=seller_headers, json={"quantity": "5"})
    own = (await client.post(f"{path}/checkout", headers=seller_headers, json={})).json()
    result = await client.post(
        f"/api/v1/orders/{own['id']}/cancel",
        headers=auth(seller, store),
        json={"version": own["version"], "reason": "No longer needed"},
    )
    assert result.status_code == 200
    rejected = await create(client, ctx, pid, uid)
    result = await client.post(
        f"/api/v1/orders/{rejected['id']}/reject",
        headers=auth(ctx.user, ctx.organization),
        json={"version": rejected["version"], "reason": "Not available"},
    )
    assert result.status_code == 200 and result.json()["status"] == "REJECTED"
    order = await confirm(client, ctx, await create(client, ctx, pid, uid))
    oid = UUID(order["id"])
    await service.order_service.start_assembling(session, ctx, oid, order["version"])
    await service.order_service.mark_ready(session, ctx, oid, order["version"] + 1)
    await service.order_service.dispatch(session, service.SystemActor("DELIVERY"), oid)
    await session.commit()
    result = await client.post(
        f"/api/v1/orders/{oid}/cancel",
        headers=auth(ctx.user, ctx.organization),
        json={"version": order["version"] + 3, "reason": "Cancel"},
    )
    assert result.json()["error"]["code"] == "cancellation_not_allowed"
    obj = await service.order_service.fail_delivery(session, service.SystemActor("DELIVERY"), oid, "No one at address")
    await session.commit()
    result = await client.post(
        f"/api/v1/orders/{oid}/cancel",
        headers=auth(ctx.user, ctx.organization),
        json={"version": obj.version, "reason": "Stop delivery"},
    )
    assert result.status_code == 200


@pytest.mark.parametrize(
    "quantity,threshold,status", [(0, 10, "OUT_OF_STOCK"), (3, 5, "LOW"), (5, 5, "IN_STOCK"), (1, None, "IN_STOCK")]
)
async def test_ord_040_availability_bands(quantity, threshold, status):
    from app.modules.orders.cart import availability

    stock = Stock(
        quantity=Decimal(quantity),
        reserved_quantity=Decimal(0),
        low_stock_threshold=Decimal(threshold) if threshold is not None else None,
    )
    assert availability(stock) == status


async def test_order_number_sequence_per_company_year(client, session):
    from app.core.sequences import NumberSequence

    ctx, _, pid, _, uid = await setup(client, session)
    year = utcnow().year
    session.add(NumberSequence(scope="order_number", key=f"{ctx.organization.id}:{year - 1}", last_value=99))
    await session.commit()
    first = await create(client, ctx, pid, uid)
    second = await create(client, ctx, pid, uid)
    assert first["order_number"] == f"ORD-{year}-000001" and second["order_number"] == f"ORD-{year}-000002"
    other_ctx, _, other_pid, _, other_uid = await setup(client, session)
    other = await create(client, other_ctx, other_pid, other_uid)
    assert other["order_number"] == f"ORD-{year}-000001"
    assert (await session.get(NumberSequence, ("order_number", f"{ctx.organization.id}:{year - 1}"))).last_value == 99


async def test_order_amount_overflow_is_validation_not_database_error(client, session):
    ctx, _, pid, _, uid = await setup(client, session)
    result = await client.post(
        "/api/v1/orders",
        headers=auth(ctx.user, ctx.organization),
        json={"partnership_id": str(pid), "items": [{"product_unit_id": str(uid), "quantity": "99999999999"}]},
    )
    assert result.status_code == 422 and result.json()["error"]["code"] == "validation_error"
