import datetime
from typing import Annotated, Literal, cast
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from pydantic import Field
from sqlalchemy import func, or_, select

from app.core import rate_limit
from app.core.errors import AppError
from app.core.filtering import ListQuery
from app.core.idempotency import IdempotentRoute, idempotent
from app.core.pagination import Page
from app.core.time import utcnow
from app.modules.delivery import codes
from app.modules.delivery import service as delivery
from app.modules.delivery.models import Delivery, DeliveryRun, DeliveryStatusHistory
from app.modules.delivery.schemas import (
    AssignIn,
    CancelIn,
    ConfirmIn,
    CourierItemOut,
    CourierStopOut,
    CourierTodayOut,
    DeliveryDetailOut,
    DeliveryOut,
    DeliveryStatus,
    FailIn,
    HistoryOut,
    ManualConfirmIn,
    RunDetailOut,
    RunIn,
    RunOut,
    RunPatchIn,
    RunStatus,
    StoreDeliveryOut,
    SyncIn,
    SyncOut,
    VersionIn,
)
from app.modules.delivery.sync import sync_service
from app.modules.identity.deps import OrgContext, SessionDep, require_permission
from app.modules.identity.models import User
from app.modules.orders.models import Order, OrderItem
from app.modules.organizations.models import Store

router = APIRouter(prefix="/api/v1", tags=["delivery"], route_class=IdempotentRoute)
Viewer = Annotated[OrgContext, Depends(require_permission("delivery.view_all"))]
Planner = Annotated[OrgContext, Depends(require_permission("delivery.plan"))]
Overrider = Annotated[OrgContext, Depends(require_permission("delivery.manual_confirm"))]
Recoder = Annotated[OrgContext, Depends(require_permission("delivery.regenerate_code"))]


class DeliveryQuery(ListQuery):
    status: list[DeliveryStatus] = Field(default_factory=list)
    courier_id: UUID | None = None
    run_id: UUID | None = None
    # P10 §9: a dispute is argued over how the delivery went, so its page needs the attempts of one order.
    order_id: UUID | None = None
    date: datetime.date | None = None
    unassigned: bool = False
    ordering: Literal["created_at", "-created_at"] = "-created_at"
    filter_columns = {
        "courier_id": Delivery.courier_id,
        "run_id": Delivery.run_id,
        "order_id": Delivery.order_id,
    }
    ordering_columns = {"created_at": Delivery.created_at}


class RunQuery(ListQuery):
    status: list[RunStatus] = Field(default_factory=list)
    courier_id: UUID | None = None
    run_date: datetime.date | None = None
    ordering: Literal["run_date", "-run_date"] = "-run_date"
    filter_columns = {"courier_id": DeliveryRun.courier_id}
    ordering_columns = {"run_date": DeliveryRun.run_date}


async def _names(session: SessionDep, rows: list[Delivery]) -> list[DeliveryOut]:
    """One extra query per lookup table rather than one per row (the N+1 ban in 01_GLOBAL §16)."""
    result = [DeliveryOut.model_validate(row) for row in rows]
    store_ids = {row.store_id for row in rows}
    courier_ids = {row.courier_id for row in rows if row.courier_id}
    order_ids = {row.order_id for row in rows}
    stores = (
        {row.id: row.legal_name for row in await session.scalars(select(Store).where(Store.id.in_(store_ids)))}
        if store_ids
        else {}
    )
    couriers = (
        {row.id: row.full_name for row in await session.scalars(select(User).where(User.id.in_(courier_ids)))}
        if courier_ids
        else {}
    )
    orders = (
        {row.id: row for row in await session.scalars(select(Order).where(Order.id.in_(order_ids)))}
        if order_ids
        else {}
    )
    for item in result:
        item.store_name = stores.get(item.store_id)
        item.courier_name = couriers.get(item.courier_id) if item.courier_id else None
        order = orders.get(item.order_id)
        item.order_number = order.order_number if order else None
        item.order_total = order.total if order else None
    return result


async def _get(session: SessionDep, ctx: OrgContext, delivery_id: UUID) -> Delivery:
    row = await session.scalar(
        select(Delivery).where(Delivery.id == delivery_id, Delivery.company_id == ctx.organization.id)
    )
    if row is None:
        raise AppError("not_found", 404)
    return row


async def _one(session: SessionDep, ctx: OrgContext, row: Delivery) -> DeliveryOut:
    return (await _names(session, [row]))[0]


@router.get("/deliveries", response_model=Page[DeliveryOut])
async def listing(session: SessionDep, ctx: Viewer, query: Annotated[DeliveryQuery, Query()]) -> Page[DeliveryOut]:
    statement = select(Delivery).where(Delivery.company_id == ctx.organization.id)
    if query.status:
        statement = statement.where(Delivery.status.in_(query.status))
    if query.date:
        statement = statement.where(func.date(Delivery.created_at) == query.date)
    if query.unassigned:
        statement = statement.where(Delivery.courier_id.is_(None), Delivery.status == "PLANNED")
    count, rows = await query.fetch(session, statement, tie_breaker=Delivery.id)
    return Page[DeliveryOut].of(query.page, count, await _names(session, [row[0] for row in rows]))


@router.get("/deliveries/{delivery_id}", response_model=DeliveryDetailOut)
async def detail(session: SessionDep, ctx: Viewer, delivery_id: UUID) -> DeliveryDetailOut:
    row = await _get(session, ctx, delivery_id)
    result = DeliveryDetailOut.model_validate(await _one(session, ctx, row))
    result.history = [
        HistoryOut.model_validate(item)
        for item in await session.scalars(
            select(DeliveryStatusHistory)
            .where(DeliveryStatusHistory.delivery_id == delivery_id)
            .order_by(DeliveryStatusHistory.created_at, DeliveryStatusHistory.id)
        )
    ]
    return result


@router.post("/deliveries/{delivery_id}/assign", response_model=DeliveryOut)
async def assign(session: SessionDep, ctx: Planner, delivery_id: UUID, payload: AssignIn) -> DeliveryOut:
    row = await _get(session, ctx, delivery_id)
    updated = await delivery.delivery_service.assign(session, ctx, row, payload.courier_id, payload.version)
    return await _one(session, ctx, updated)


@router.post("/deliveries/{delivery_id}/unassign", response_model=DeliveryOut)
async def unassign(session: SessionDep, ctx: Planner, delivery_id: UUID, payload: VersionIn) -> DeliveryOut:
    row = await _get(session, ctx, delivery_id)
    updated = await delivery.delivery_service.unassign(session, ctx, row, payload.version)
    return await _one(session, ctx, updated)


@router.post("/deliveries/{delivery_id}/cancel", response_model=DeliveryOut)
async def cancel(session: SessionDep, ctx: Planner, delivery_id: UUID, payload: CancelIn) -> DeliveryOut:
    row = await _get(session, ctx, delivery_id)
    updated = await delivery.delivery_service.cancel(session, ctx, row, payload.reason, payload.version)
    return await _one(session, ctx, updated)


@router.post(
    "/deliveries/{delivery_id}/regenerate-code",
    response_model=DeliveryOut,
    dependencies=[idempotent(permission="delivery.regenerate_code")],
)
async def regenerate_code(session: SessionDep, ctx: Recoder, delivery_id: UUID) -> DeliveryOut:
    """DEL-014. The new code is not returned here: only the store is ever shown it (DEL-012)."""
    row = await _get(session, ctx, delivery_id)
    await delivery.delivery_service.regenerate_code(session, ctx, row)
    return await _one(session, ctx, row)


@router.post(
    "/deliveries/{delivery_id}/manual-confirm",
    response_model=DeliveryOut,
    dependencies=[idempotent(permission="delivery.manual_confirm")],
)
async def manual_confirm(
    session: SessionDep, ctx: Overrider, delivery_id: UUID, payload: ManualConfirmIn
) -> DeliveryOut:
    row = await _get(session, ctx, delivery_id)
    updated = await delivery.delivery_service.manual_confirm(session, ctx, row, payload.reason)
    return await _one(session, ctx, updated)


async def _run(session: SessionDep, ctx: OrgContext, run_id: UUID) -> DeliveryRun:
    row = await session.scalar(
        select(DeliveryRun).where(DeliveryRun.id == run_id, DeliveryRun.company_id == ctx.organization.id)
    )
    if row is None:
        raise AppError("not_found", 404)
    return row


async def _run_out(session: SessionDep, ctx: OrgContext, run: DeliveryRun) -> RunDetailOut:
    result = RunDetailOut.model_validate(run)
    courier = await session.get(User, run.courier_id)
    result.courier_name = courier.full_name if courier else None
    stops = await delivery.run_stops(session, run.id)
    result.stops = await _names(session, stops)
    result.stop_count = len(stops)
    return result


@router.get("/delivery-runs", response_model=Page[RunOut])
async def runs(session: SessionDep, ctx: Viewer, query: Annotated[RunQuery, Query()]) -> Page[RunOut]:
    statement = select(DeliveryRun).where(DeliveryRun.company_id == ctx.organization.id)
    if query.status:
        statement = statement.where(DeliveryRun.status.in_(query.status))
    if query.run_date:
        statement = statement.where(DeliveryRun.run_date == query.run_date)
    count, rows = await query.fetch(session, statement, tie_breaker=DeliveryRun.id)
    runs = [row[0] for row in rows]
    couriers = {
        user.id: user.full_name
        for user in await session.scalars(select(User).where(User.id.in_([run.courier_id for run in runs])))
    }
    counts = {
        run_id: count
        for run_id, count in await session.execute(
            select(Delivery.run_id, func.count())
            .where(Delivery.run_id.in_([run.id for run in runs]))
            .group_by(Delivery.run_id)
        )
    }
    results = []
    for run in runs:
        result = RunOut.model_validate(run)
        result.courier_name = couriers.get(run.courier_id)
        result.stop_count = counts.get(run.id, 0)
        results.append(result)
    return Page[RunOut].of(query.page, count, results)


@router.post(
    "/delivery-runs",
    response_model=RunDetailOut,
    status_code=201,
    dependencies=[idempotent(permission="delivery.plan")],
)
async def create_run(session: SessionDep, ctx: Planner, payload: RunIn) -> RunDetailOut:
    run = await delivery.run_service.create(session, ctx, payload.courier_id, payload.run_date, payload.delivery_ids)
    return await _run_out(session, ctx, run)


@router.get("/delivery-runs/{run_id}", response_model=RunDetailOut)
async def run_detail(session: SessionDep, ctx: Viewer, run_id: UUID) -> RunDetailOut:
    return await _run_out(session, ctx, await _run(session, ctx, run_id))


@router.patch("/delivery-runs/{run_id}", response_model=RunDetailOut)
async def patch_run(session: SessionDep, ctx: Planner, run_id: UUID, payload: RunPatchIn) -> RunDetailOut:
    run = await delivery.run_service.update(
        session, ctx, await _run(session, ctx, run_id), payload.delivery_ids, payload.version
    )
    return await _run_out(session, ctx, run)


@router.post(
    "/delivery-runs/{run_id}/start", response_model=RunDetailOut, dependencies=[idempotent(permission="delivery.plan")]
)
async def start_run(session: SessionDep, ctx: Planner, run_id: UUID) -> RunDetailOut:
    run = await delivery.run_service.start(session, delivery.Actor(ctx), await _run(session, ctx, run_id))
    return await _run_out(session, ctx, run)


@router.post(
    "/delivery-runs/{run_id}/finish",
    response_model=RunDetailOut,
    dependencies=[idempotent(permission="delivery.plan")],
)
async def finish_run(session: SessionDep, ctx: Planner, run_id: UUID) -> RunDetailOut:
    run = await delivery.run_service.finish(session, delivery.Actor(ctx), await _run(session, ctx, run_id))
    return await _run_out(session, ctx, run)


@router.post(
    "/delivery-runs/{run_id}/cancel",
    response_model=RunDetailOut,
    dependencies=[idempotent(permission="delivery.plan")],
)
async def cancel_run(session: SessionDep, ctx: Planner, run_id: UUID) -> RunDetailOut:
    run = await delivery.run_service.cancel(session, ctx, await _run(session, ctx, run_id))
    return await _run_out(session, ctx, run)


Courier = Annotated[OrgContext, Depends(require_permission("delivery.act_own"))]
StoreViewer = Annotated[OrgContext, Depends(require_permission("delivery.view_store"))]


async def _own(session: SessionDep, ctx: OrgContext, delivery_id: UUID) -> Delivery:
    """DEL-003: somebody else's stop is not a 403 that confirms it exists — it is a 404."""
    row = await session.scalar(
        select(Delivery).where(Delivery.id == delivery_id, Delivery.company_id == ctx.organization.id)
    )
    if row is None or ("delivery.act_any" not in ctx.permissions and row.courier_id != ctx.user.id):
        raise AppError("not_found", 404)
    return row


@router.get("/courier/today", response_model=CourierTodayOut)
async def courier_today(session: SessionDep, ctx: Courier) -> CourierTodayOut:
    """The courier's own stops for today, ordered. Money is limited to the order total."""
    today = utcnow().astimezone(ZoneInfo("Asia/Dushanbe")).date()
    today_runs = list(
        await session.scalars(
            select(DeliveryRun)
            .where(
                DeliveryRun.company_id == ctx.organization.id,
                DeliveryRun.courier_id == ctx.user.id,
                DeliveryRun.run_date == today,
                DeliveryRun.status.in_(("DRAFT", "STARTED", "FINISHED")),
            )
            .order_by(DeliveryRun.created_at.desc())
        )
    )
    run = next((item for item in today_runs if item.status in {"DRAFT", "STARTED"}), None)
    statement = select(Delivery).where(
        Delivery.company_id == ctx.organization.id,
        Delivery.courier_id == ctx.user.id,
        or_(
            Delivery.run_id.in_([item.id for item in today_runs]),
            (Delivery.run_id.is_(None)) & Delivery.status.in_(tuple(delivery.OPEN)),
        ),
    )
    rows = list(await session.scalars(statement.order_by(Delivery.stop_sequence, Delivery.created_at)))
    return CourierTodayOut(
        runs=[RunOut.model_validate(item) for item in today_runs],
        run_id=run.id if run else None,
        run_status=cast(RunStatus, run.status) if run else None,
        run_date=run.run_date if run else None,
        stops=await _stops(session, rows),
    )


async def _stop(session: SessionDep, row: Delivery) -> CourierStopOut:
    return (await _stops(session, [row]))[0]


async def _stops(session: SessionDep, rows: list[Delivery]) -> list[CourierStopOut]:
    stores = {
        store.id: store
        for store in await session.scalars(select(Store).where(Store.id.in_([row.store_id for row in rows])))
    }
    orders = {
        order.id: order
        for order in await session.scalars(select(Order).where(Order.id.in_([row.order_id for row in rows])))
    }
    all_items = list(
        await session.scalars(
            select(OrderItem).where(OrderItem.order_id.in_([row.order_id for row in rows])).order_by(OrderItem.id)
        )
    )
    results = []
    for row in rows:
        store = stores.get(row.store_id)
        order = orders.get(row.order_id)
        items = [item for item in all_items if item.order_id == row.order_id]
        results.append(
            CourierStopOut(
                id=row.id,
                run_id=row.run_id,
                order_id=row.order_id,
                order_number=order.order_number if order else "",
                attempt_no=row.attempt_no,
                status=cast(DeliveryStatus, row.status),
                stop_sequence=row.stop_sequence,
                store_name=store.legal_name if store else "",
                store_phone=store.phone if store else "",
                address=row.address,
                latitude=row.latitude,
                longitude=row.longitude,
                order_total=order.total if order else None,
                items=[
                    CourierItemOut(
                        product_name=item.product_name_snapshot,
                        sku=item.sku_snapshot,
                        unit_code=item.unit_code_snapshot,
                        quantity=item.confirmed_quantity
                        if item.confirmed_quantity is not None
                        else item.requested_quantity,
                    )
                    for item in items
                ],
                code_locked=row.code_locked,
                version=row.version,
            )
        )
    return results


@router.get("/courier/deliveries/{delivery_id}", response_model=CourierStopOut)
async def courier_stop(session: SessionDep, ctx: Courier, delivery_id: UUID) -> CourierStopOut:
    return await _stop(session, await _own(session, ctx, delivery_id))


@router.post(
    "/courier/deliveries/{delivery_id}/dispatch",
    response_model=CourierStopOut,
    dependencies=[idempotent(permission="delivery.act_own")],
)
async def courier_dispatch(session: SessionDep, ctx: Courier, delivery_id: UUID) -> CourierStopOut:
    row = await _own(session, ctx, delivery_id)
    return await _stop(session, await delivery.delivery_service.dispatch(session, delivery.Actor(ctx), row))


@router.post(
    "/courier/deliveries/{delivery_id}/arrive",
    response_model=CourierStopOut,
    dependencies=[idempotent(permission="delivery.act_own")],
)
async def courier_arrive(session: SessionDep, ctx: Courier, delivery_id: UUID) -> CourierStopOut:
    row = await _own(session, ctx, delivery_id)
    return await _stop(session, await delivery.delivery_service.arrive(session, delivery.Actor(ctx), row))


@router.post(
    "/courier/deliveries/{delivery_id}/confirm",
    response_model=CourierStopOut,
    dependencies=[idempotent(permission="delivery.act_own")],
)
async def courier_confirm(session: SessionDep, ctx: Courier, delivery_id: UUID, payload: ConfirmIn) -> CourierStopOut:
    row = await _own(session, ctx, delivery_id)
    await rate_limit.hit(rate_limit.DELIVERY_CONFIRM, f"{ctx.user.id}:{delivery_id}")
    updated = await delivery.delivery_service.confirm(session, delivery.Actor(ctx), row, payload.code)
    return await _stop(session, updated)


@router.post(
    "/courier/deliveries/{delivery_id}/fail",
    response_model=CourierStopOut,
    dependencies=[idempotent(permission="delivery.act_own")],
)
async def courier_fail(session: SessionDep, ctx: Courier, delivery_id: UUID, payload: FailIn) -> CourierStopOut:
    row = await _own(session, ctx, delivery_id)
    updated = await delivery.delivery_service.fail(session, delivery.Actor(ctx), row, payload.reason_code, payload.note)
    return await _stop(session, updated)


async def _own_run(session: SessionDep, ctx: OrgContext, run_id: UUID) -> DeliveryRun:
    row = await session.scalar(
        select(DeliveryRun).where(DeliveryRun.id == run_id, DeliveryRun.company_id == ctx.organization.id)
    )
    if row is None or ("delivery.act_any" not in ctx.permissions and row.courier_id != ctx.user.id):
        raise AppError("not_found", 404)
    return row


@router.post("/courier/runs/{run_id}/start", dependencies=[idempotent(permission="delivery.act_own")])
async def courier_start(session: SessionDep, ctx: Courier, run_id: UUID) -> CourierTodayOut:
    await delivery.run_service.start(session, delivery.Actor(ctx), await _own_run(session, ctx, run_id))
    return await courier_today(session, ctx)


@router.post("/courier/runs/{run_id}/finish", dependencies=[idempotent(permission="delivery.act_own")])
async def courier_finish(session: SessionDep, ctx: Courier, run_id: UUID) -> CourierTodayOut:
    await delivery.run_service.finish(session, delivery.Actor(ctx), await _own_run(session, ctx, run_id))
    return await courier_today(session, ctx)


@router.post("/courier/sync", response_model=SyncOut)
async def courier_sync(ctx: Courier, payload: SyncIn) -> SyncOut:
    """DEL-022: each operation commits on its own session, so this endpoint takes none from the request."""
    return SyncOut(results=await sync_service.apply(ctx, payload.operations))


@router.get("/orders/{order_id}/delivery", response_model=StoreDeliveryOut)
async def store_delivery(session: SessionDep, ctx: StoreViewer, order_id: UUID) -> StoreDeliveryOut:
    """DEL-012: the only endpoint that returns the code, and only while the goods are on their way."""
    order = await session.scalar(select(Order).where(Order.id == order_id, Order.store_id == ctx.organization.id))
    if order is None:
        raise AppError("not_found", 404)
    row = await session.scalar(
        select(Delivery).where(Delivery.order_id == order_id).order_by(Delivery.attempt_no.desc())
    )
    if row is None:
        raise AppError("not_found", 404)
    visible = row.status in delivery.CODE_STATUSES
    courier = await session.get(User, row.courier_id) if row.courier_id and visible else None
    return StoreDeliveryOut(
        status=cast(DeliveryStatus, row.status),
        attempt_no=row.attempt_no,
        courier_name=courier.full_name if courier else None,
        courier_phone=courier.phone if courier else None,
        code=codes.decrypt(row.id, row.code_encrypted) if visible else None,
        dispatched_at=row.dispatched_at,
        arrived_at=row.arrived_at,
        delivered_at=row.delivered_at,
    )
