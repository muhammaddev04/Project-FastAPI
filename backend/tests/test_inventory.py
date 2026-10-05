import asyncio
from datetime import timedelta
from decimal import Decimal
from io import BytesIO
from uuid import UUID

import pytest
from httpx import AsyncClient
from openpyxl import Workbook
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_sessionmaker
from app.core.errors import AppError
from app.core.outbox import OutboxEvent
from app.core.permissions import permissions_for
from app.core.time import new_id, utcnow
from app.modules.catalog import imports
from app.modules.inventory import service
from app.modules.inventory.models import Stock, StockMovement, StockReservation
from app.modules.inventory.service import SourceRef, stock_service
from tests.factories import add_member, auth, make_user
from tests.test_catalog import product, setup


async def prepared(client: AsyncClient, session: AsyncSession):
    context = await setup(session)
    data = await product(client, context)
    return context, UUID(str(data["id"])), UUID(data["units"][0]["id"])


async def test_inv_001_unit_conversion_to_base(client: AsyncClient, session: AsyncSession) -> None:
    context, pid, _ = await prepared(client, session)
    headers = auth(context.user, context.organization)
    unit = await client.post(
        f"/api/v1/catalog/products/{pid}/units",
        headers=headers,
        json={
            "code": "BOX24",
            "name": {"en": "Box", "tg": "Қуттӣ", "ru": "Коробка"},
            "coefficient": "24",
            "allow_fraction": False,
        },
    )
    assert unit.status_code == 201, unit.text
    payload = {"items": [{"product_id": str(pid), "unit_id": unit.json()["id"], "quantity": "24"}], "note": "Delivered"}
    result = await client.post("/api/v1/inventory/receipts", headers=headers, json=payload)
    assert result.status_code == 201, result.text
    assert (await client.post("/api/v1/inventory/receipts", headers=headers, json=payload)).json() == result.json()
    stock = (await client.get(f"/api/v1/inventory/stocks/{pid}", headers=headers)).json()
    assert Decimal(stock["quantity"]) == Decimal(576)
    assert stock["available"] == stock["quantity"]
    log = (await client.get("/api/v1/inventory/movements", headers=headers)).json()
    assert log["count"] == 1 and Decimal(log["results"][0]["quantity_delta"]) == 576


async def test_inv_002_reserve_all_or_nothing_lists_all_insufficient(
    client: AsyncClient, session: AsyncSession
) -> None:
    context, pid, _ = await prepared(client, session)
    second = UUID(str((await product(client, context, sku="OTHER"))["id"]))
    with pytest.raises(AppError) as error:
        await stock_service.reserve(
            session,
            context.organization.id,
            [(pid, Decimal(2)), (second, Decimal(3))],
            SourceRef(context.organization.id, new_id()),
            context.user.id,
        )
    assert error.value.code == "insufficient_stock"
    assert {row["product_id"] for row in error.value.details["items"]} == {str(pid), str(second)}
    assert await session.scalar(select(func.count()).select_from(StockReservation)) == 0
    assert await session.scalar(select(func.count()).select_from(StockMovement)) == 0


async def concurrency(client: AsyncClient, session: AsyncSession, quantities: list[int], reverse: bool = False):
    context, pid, _ = await prepared(client, session)
    pids = [pid]
    if reverse:
        pids.append(UUID(str((await product(client, context, sku="SECOND"))["id"])))
    await stock_service.receive(session, context.organization.id, [(p, Decimal(100)) for p in pids], context.user.id)
    await session.commit()

    async def reserve(index: int, qty: int):
        async with get_sessionmaker()() as db, db.begin():
            try:
                lines = [(p, Decimal(qty)) for p in (pids[::-1] if index % 2 else pids)]
                await stock_service.reserve(
                    db, context.organization.id, lines, SourceRef(context.organization.id, new_id()), context.user.id
                )
                return True
            except AppError as exc:
                assert exc.code == "insufficient_stock"
                return False

    results = await asyncio.wait_for(asyncio.gather(*(reserve(i, q) for i, q in enumerate(quantities))), timeout=30)
    rows = list(await session.scalars(select(Stock).execution_options(populate_existing=True)))
    assert all(0 <= row.reserved_quantity <= row.quantity == 100 for row in rows)
    assert await service.reconcile(session) == 0
    return results


async def test_inv_002_concurrent_80_and_50_of_100_only_one_succeeds(
    client: AsyncClient, session: AsyncSession
) -> None:
    assert sum(await concurrency(client, session, [80, 50])) == 1


async def test_inv_002_concurrent_many_reservations_never_negative(client: AsyncClient, session: AsyncSession) -> None:
    assert sum(await concurrency(client, session, [3] * 50)) == 33


async def test_inv_002_lock_order_no_deadlock(client: AsyncClient, session: AsyncSession) -> None:
    assert all(await concurrency(client, session, [40, 40], reverse=True))


@pytest.mark.parametrize("action", ["release", "ship"])
async def test_inv_004_close_idempotent(client: AsyncClient, session: AsyncSession, action: str) -> None:
    context, pid, _ = await prepared(client, session)
    await stock_service.receive(session, context.organization.id, [(pid, Decimal(100))], context.user.id)
    source = SourceRef(context.organization.id, new_id())
    await stock_service.reserve(session, context.organization.id, [(pid, Decimal(40))], source, context.user.id)
    await stock_service.reserve(session, context.organization.id, [(pid, Decimal(40))], source, context.user.id)
    close = getattr(stock_service, action)
    await close(session, source, context.user.id)
    await close(session, source, context.user.id)
    stock = (await stock_service.availability(session, context.organization.id, [pid]))[pid]
    assert stock.quantity == (60 if action == "ship" else 100) and stock.reserved == 0
    assert await session.scalar(select(func.count()).select_from(StockMovement)) == 3
    assert await service.reconcile(session) == 0


async def test_inv_005_006_adjust_below_reserved_and_write_off_exceeds_available(
    client: AsyncClient, session: AsyncSession
) -> None:
    context, pid, _ = await prepared(client, session)
    await stock_service.receive(session, context.organization.id, [(pid, Decimal(100))], context.user.id)
    await stock_service.reserve(
        session,
        context.organization.id,
        [(pid, Decimal(80))],
        SourceRef(context.organization.id, new_id()),
        context.user.id,
    )
    for operation in (
        lambda: stock_service.adjust(
            session, context.organization.id, pid, Decimal(70), "Inventory count", context.user.id
        ),
        lambda: stock_service.write_off(
            session, context.organization.id, pid, Decimal(21), "Damaged goods", context.user.id
        ),
    ):
        with pytest.raises(AppError) as error:
            await operation()
        assert error.value.code == "negative_stock_forbidden"
    with pytest.raises(AppError) as error:
        await stock_service.adjust(session, context.organization.id, pid, Decimal(100), "bad", context.user.id)
    assert error.value.code == "validation_error"
    await stock_service.adjust(session, context.organization.id, pid, Decimal(90), "Count correction", context.user.id)
    await stock_service.write_off(session, context.organization.id, pid, Decimal(10), "Damaged goods", context.user.id)
    assert await service.reconcile(session) == 0


async def test_inv_007_low_stock_event_once_per_24h(client: AsyncClient, session: AsyncSession, monkeypatch) -> None:
    context, pid, _ = await prepared(client, session)
    await session.execute(text("UPDATE stocks SET low_stock_threshold = 110 WHERE product_id = :pid"), {"pid": pid})
    await stock_service.receive(session, context.organization.id, [(pid, Decimal(100))], context.user.id)
    await stock_service.adjust(session, context.organization.id, pid, Decimal(95), "Actual count", context.user.id)
    events = select(func.count()).select_from(OutboxEvent).where(OutboxEvent.event_type == "LOW_STOCK")
    assert await session.scalar(events) == 1
    later = utcnow() + timedelta(hours=25)
    monkeypatch.setattr(service, "utcnow", lambda: later)
    await stock_service.adjust(session, context.organization.id, pid, Decimal(90), "Actual count", context.user.id)
    assert await session.scalar(events) == 2


async def test_inv_009_reconciliation_detects_mismatch(client: AsyncClient, session: AsyncSession) -> None:
    context, pid, _ = await prepared(client, session)
    await stock_service.receive(session, context.organization.id, [(pid, Decimal(10))], context.user.id)
    assert await service.reconcile(session) == 0
    await session.execute(text("UPDATE stocks SET quantity = 11 WHERE product_id = :pid"), {"pid": pid})
    assert await service.reconcile(session) == 1
    assert await session.scalar(select(Stock.quantity)) == 11
    assert (
        await session.scalar(
            select(func.count())
            .select_from(OutboxEvent)
            .where(OutboxEvent.event_type == "STOCK_RECONCILIATION_MISMATCH")
        )
        == 1
    )


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE stocks SET quantity = -1",
        "UPDATE stocks SET reserved_quantity = 1",
        "UPDATE stock_movements SET reason = 'tampered'",
        "DELETE FROM stock_movements",
    ],
)
async def test_inv_003_stock_movements_append_only_and_checks(
    client: AsyncClient, session: AsyncSession, statement: str
) -> None:
    context, pid, _ = await prepared(client, session)
    await stock_service.adjust(session, context.organization.id, pid, Decimal(0), "Initial count", context.user.id)
    with pytest.raises(DBAPIError):
        async with session.begin_nested():
            await session.execute(text(statement))


@pytest.mark.parametrize("role", ["OWNER", "MANAGER", "OPERATOR", "WAREHOUSE", "COURIER"])
@pytest.mark.parametrize(
    "permission", ["stock.view", "stock.receive", "stock.adjust", "stock.write_off", "stock.settings"]
)
async def test_permission_matrix_p05(client: AsyncClient, session: AsyncSession, role: str, permission: str) -> None:
    context, pid, uid = await prepared(client, session)
    user = context.user
    if role != "OWNER":
        user = await make_user(session)
        await add_member(session, context.organization, user, role)
        await session.commit()
    headers = auth(user, context.organization)
    if permission == "stock.view":
        result = await client.get("/api/v1/inventory/stocks", headers=headers)
    elif permission == "stock.settings":
        result = await client.patch(
            f"/api/v1/inventory/stocks/{pid}", headers=headers, json={"version": 1, "low_stock_threshold": "5"}
        )
    else:
        path, body = {
            "stock.receive": ("receipts", {"items": [{"product_id": str(pid), "unit_id": str(uid), "quantity": "2"}]}),
            "stock.adjust": ("adjustments", {"product_id": str(pid), "actual_quantity": "2", "reason": "Actual count"}),
            "stock.write_off": (
                "write-offs",
                {"product_id": str(pid), "unit_id": str(uid), "quantity": "2", "reason": "Damaged goods"},
            ),
        }[permission]
        result = await client.post(f"/api/v1/inventory/{path}", headers=headers, json=body)
    allowed = permission in permissions_for("COMPANY", role)
    assert (result.status_code != 403) == allowed, result.text


async def test_inv_010_stock_import_all_or_nothing(client: AsyncClient, session: AsyncSession) -> None:
    context, pid, _ = await prepared(client, session)
    book = Workbook()
    book.active.append(["sku", "unit_code", "quantity", "note"])
    book.active.append(["TEA", "PCS", 10, "Delivered"])
    book.active.append(["MISSING", "PCS", 3, "Invalid"])
    stream = BytesIO()
    book.save(stream)
    result = await client.post(
        "/api/v1/imports",
        headers=auth(context.user, context.organization),
        data={"kind": "STOCK"},
        files={"file": ("stock.xlsx", stream.getvalue(), imports.MIME)},
    )
    assert result.status_code == 202, result.text
    await imports.process_pending()
    job = (
        await client.get(f"/api/v1/imports/{result.json()['id']}", headers=auth(context.user, context.organization))
    ).json()
    assert job["status"] == "VALIDATED" and job["error_count"] == 1
    confirm = await client.post(
        f"/api/v1/imports/{job['id']}/confirm", headers=auth(context.user, context.organization)
    )
    assert confirm.status_code == 422
    assert (await stock_service.availability(session, context.organization.id, [pid]))[pid].quantity == 0


async def test_inv_008_manual_write_requires_catalog_subscription_access(
    client: AsyncClient, session: AsyncSession
) -> None:
    from app.modules.subscriptions.models import Subscription

    context, pid, uid = await prepared(client, session)
    subscription = await session.scalar(select(Subscription).where(Subscription.company_id == context.organization.id))
    subscription.status = "FULL_BLOCK"
    await session.commit()
    headers = auth(context.user, context.organization)
    result = await client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={"items": [{"product_id": str(pid), "unit_id": str(uid), "quantity": "1"}]},
    )
    assert result.status_code == 403, result.text
    assert (await client.get("/api/v1/inventory/stocks", headers=headers)).status_code == 200


async def test_migration_backfills_existing_products(client: AsyncClient, session: AsyncSession) -> None:
    from alembic import command
    from alembic.config import Config

    from app.core.config import get_settings

    assert get_settings().app_env == "testing"
    assert get_settings().database_url.endswith(("/tezfarmo_ci", "/tezfarmo_test"))
    context, pid, _ = await prepared(client, session)
    company_id = context.organization.id
    config = Config("alembic.ini")
    await asyncio.to_thread(command.downgrade, config, "20261005_0019")
    await asyncio.to_thread(command.upgrade, config, "head")
    stock = await session.get(Stock, pid)
    assert stock.company_id == company_id and stock.quantity == stock.reserved_quantity == 0


async def test_base_unit_locked_by_inventory_and_worker_schedule(client: AsyncClient, session: AsyncSession) -> None:
    from app.celery_app import celery_app

    context, pid, _ = await prepared(client, session)
    await stock_service.receive(session, context.organization.id, [(pid, Decimal(1))], context.user.id)
    await session.commit()
    change = await client.patch(
        f"/api/v1/catalog/products/{pid}",
        headers=auth(context.user, context.organization),
        json={"version": 1, "base_unit": "PACK"},
    )
    assert change.status_code == 409 and change.json()["error"]["code"] == "base_unit_immutable"
    assert "tezfarmo.stock_reconciliation" in celery_app.tasks
    schedule = celery_app.conf.beat_schedule["stock-reconciliation"]["schedule"]
    assert schedule.hour == {22} and schedule.minute == {0}


@pytest.mark.parametrize("overflow", [False, True])
async def test_inv_010_valid_stock_import_and_execution_rollback(
    client: AsyncClient, session: AsyncSession, overflow: bool
) -> None:
    context, pid, _ = await prepared(client, session)
    second = UUID(str((await product(client, context, sku="SECOND"))["id"]))
    if overflow:
        await stock_service.receive(session, context.organization.id, [(second, service.MAX_QUANTITY)], context.user.id)
        await session.commit()
    book = Workbook()
    book.active.append(["sku", "unit_code", "quantity", "note"])
    book.active.append(["TEA", "PCS", 10, "First receipt"])
    book.active.append(["SECOND", "PCS", 3, "Second receipt"])
    stream = BytesIO()
    book.save(stream)
    headers = auth(context.user, context.organization)
    result = await client.post(
        "/api/v1/imports",
        headers=headers,
        data={"kind": "STOCK"},
        files={"file": ("stock.xlsx", stream.getvalue(), imports.MIME)},
    )
    assert result.status_code == 202, result.text
    await imports.process_pending()
    confirmed = await client.post(f"/api/v1/imports/{result.json()['id']}/confirm", headers=headers)
    assert confirmed.status_code == 202, confirmed.text
    await imports.process_pending()
    job = (await client.get(f"/api/v1/imports/{result.json()['id']}", headers=headers)).json()
    assert job["status"] == ("FAILED" if overflow else "COMPLETED")
    rows = await stock_service.availability(session, context.organization.id, [pid, second])
    assert rows[pid].quantity == (0 if overflow else 10)
    assert rows[second].quantity == (service.MAX_QUANTITY if overflow else 3)
    assert await service.reconcile(session) == 0


async def test_stock_tenant_filters_threshold_version_and_return_in(client: AsyncClient, session: AsyncSession) -> None:
    context, pid, _ = await prepared(client, session)
    other = await setup(session)
    other_pid = UUID(str((await product(client, other))["id"]))
    await stock_service.return_in(
        session,
        context.organization.id,
        [(pid, Decimal(5))],
        SourceRef(context.organization.id, new_id(), "RETURN"),
        context.user.id,
    )
    await session.commit()
    headers = auth(context.user, context.organization)
    changed = await client.patch(
        f"/api/v1/inventory/stocks/{pid}", headers=headers, json={"version": 2, "low_stock_threshold": "6"}
    )
    assert changed.status_code == 200, changed.text
    conflict = await client.patch(
        f"/api/v1/inventory/stocks/{pid}", headers=headers, json={"version": 2, "low_stock_threshold": "7"}
    )
    assert conflict.status_code == 409
    low = await client.get("/api/v1/inventory/stocks?low_stock=true&search=TEA&ordering=available", headers=headers)
    assert low.status_code == 200 and low.json()["count"] == 1
    assert (await client.get(f"/api/v1/inventory/stocks/{other_pid}", headers=headers)).status_code == 404
    assert (await client.get("/api/v1/inventory/movements?type=RETURN_IN", headers=headers)).json()["count"] == 1
    assert (await client.get("/api/v1/inventory/stocks?unknown=yes", headers=headers)).status_code == 422
    with pytest.raises(DBAPIError):
        async with session.begin_nested():
            await session.execute(
                text("UPDATE stocks SET company_id = :other WHERE product_id = :pid"),
                {"other": other.organization.id, "pid": pid},
            )
