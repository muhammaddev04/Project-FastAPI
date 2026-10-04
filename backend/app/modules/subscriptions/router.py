from datetime import timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.core import audit
from app.core.errors import AppError
from app.core.idempotency import IdempotentRoute, idempotent
from app.core.pagination import PageParamsDep, fetch_page
from app.core.time import utcnow
from app.modules.identity.deps import (
    CurrentUser,
    OrgContext,
    OrgContextDep,
    SessionDep,
    SuperadminDep,
    get_superadmin,
    require_permission,
)
from app.modules.identity.models import Organization
from app.modules.identity.team_service import lock_org
from app.modules.subscriptions import service
from app.modules.subscriptions.domain import SubscriptionStatus, allowed_actions
from app.modules.subscriptions.models import (
    Plan,
    PlanChangeRequest,
    Subscription,
    SubscriptionHistory,
    SubscriptionPayment,
)
from app.modules.subscriptions.schemas import (
    CancelIn,
    ChangePlanIn,
    ExtendTrialIn,
    HistoryOut,
    PaymentIn,
    PaymentOut,
    PaymentPage,
    PlanFields,
    PlanOut,
    PlanPage,
    PlanRequestDetail,
    PlanRequestIn,
    PlanRequestOut,
    PlanUpdate,
    RequestHandleIn,
    RequestPage,
    SubscriptionDetail,
    SubscriptionOut,
    SubscriptionPage,
)

router = APIRouter(prefix="/api/v1", tags=["subscriptions"], route_class=IdempotentRoute)
admin_router = APIRouter(prefix="/api/v1/admin", tags=["admin subscriptions"], route_class=IdempotentRoute)
Viewer = Annotated[OrgContext, Depends(require_permission("subscription.view"))]
Manager = Annotated[OrgContext, Depends(require_permission("subscription.manage"))]


async def subscription_out(session: SessionDep, sub: Subscription) -> SubscriptionOut:
    plan = await session.get(Plan, sub.plan_id)
    org = await session.get(Organization, sub.company_id)
    assert plan is not None and org is not None
    return SubscriptionOut(
        id=sub.id,
        company_id=sub.company_id,
        company_name=org.name,
        status=sub.status,
        plan=PlanOut.model_validate(plan),
        trial_ends_at=sub.trial_ends_at,
        current_period_start=sub.current_period_start,
        current_period_end=sub.current_period_end,
        grace_ends_at=sub.grace_ends_at,
        soft_block_ends_at=sub.soft_block_ends_at,
        cancel_at_period_end=sub.cancel_at_period_end,
        status_changed_at=sub.status_changed_at,
        version=sub.version,
        usage=await service.usage(session, sub.company_id),
        limits={"users": plan.max_users, "products": plan.max_products, "active_stores": plan.max_active_stores},
        allowed_actions=sorted(allowed_actions(SubscriptionStatus(sub.status))),
    )


async def detail(session: SessionDep, sub: Subscription) -> SubscriptionDetail:
    result = await subscription_out(session, sub)
    history = await session.scalars(
        select(SubscriptionHistory)
        .where(SubscriptionHistory.subscription_id == sub.id)
        .order_by(SubscriptionHistory.created_at, SubscriptionHistory.id)
    )
    payments = await session.scalars(
        select(SubscriptionPayment)
        .where(SubscriptionPayment.subscription_id == sub.id)
        .order_by(SubscriptionPayment.created_at.desc(), SubscriptionPayment.id)
    )
    return SubscriptionDetail(
        **result.model_dump(),
        history=[HistoryOut.model_validate(h) for h in history],
        payments=[PaymentOut.model_validate(p) for p in payments],
    )


@router.get("/plans", response_model=PlanPage)
async def public_plans(session: SessionDep, _user: CurrentUser, page: PageParamsDep) -> PlanPage:
    count, rows = await fetch_page(
        session, select(Plan).where(Plan.is_public.is_(True)), page, order_by=[Plan.sort_order], tie_breaker=Plan.id
    )
    return PlanPage.of(page, count, [PlanOut.model_validate(p) for p in rows.scalars()])


@router.get("/subscription", response_model=SubscriptionOut)
async def my_subscription(session: SessionDep, context: Viewer) -> SubscriptionOut:
    sub = await service.get_subscription(session, company_id=context.organization.id, lock=True)
    await service.evaluate(session, sub, utcnow())
    return await subscription_out(session, sub)


@router.get("/subscription/access")
async def subscription_access(session: SessionDep, context: OrgContextDep) -> dict[str, object]:
    """Minimal enforcement state for company banners/buttons, without billing details."""
    if context.organization.type != "COMPANY":
        raise AppError("not_found", 404)
    sub = await service.get_subscription(session, company_id=context.organization.id, lock=True)
    await service.evaluate(session, sub, utcnow())
    return {"status": sub.status, "allowed_actions": sorted(allowed_actions(SubscriptionStatus(sub.status)))}


@router.post("/subscription/cancel-at-period-end", response_model=SubscriptionOut)
async def cancel_at_period_end(payload: CancelIn, session: SessionDep, context: Manager) -> SubscriptionOut:
    await lock_org(session, context.organization.id)
    sub = await service.get_subscription(session, company_id=context.organization.id, lock=True)
    old = sub.cancel_at_period_end
    sub.cancel_at_period_end = payload.value
    sub.version += 1
    await audit.record(
        session,
        "subscription.cancel_at_period_end",
        "subscription",
        sub.id,
        org_id=sub.company_id,
        old={"value": old},
        new={"value": payload.value},
    )
    await session.flush()
    return await subscription_out(session, sub)


@router.post(
    "/subscription/plan-requests",
    response_model=PlanRequestOut,
    status_code=201,
    dependencies=[idempotent(permission="subscription.manage")],
)
async def request_plan(payload: PlanRequestIn, session: SessionDep, context: Manager) -> PlanRequestOut:
    await lock_org(session, context.organization.id)
    request = await service.request_plan(session, context.organization.id, context.user, payload.plan_code)
    return PlanRequestOut.model_validate(request)


@router.get("/subscription/payments", response_model=PaymentPage)
async def my_payments(session: SessionDep, context: Viewer, page: PageParamsDep) -> PaymentPage:
    sub = await service.get_subscription(session, company_id=context.organization.id)
    count, rows = await fetch_page(
        session,
        select(SubscriptionPayment).where(SubscriptionPayment.subscription_id == sub.id),
        page,
        order_by=[SubscriptionPayment.created_at.desc()],
        tie_breaker=SubscriptionPayment.id,
    )
    return PaymentPage.of(page, count, [PaymentOut.model_validate(p) for p in rows.scalars()])


@admin_router.get("/subscriptions", response_model=SubscriptionPage)
async def subscriptions(
    session: SessionDep,
    _admin: SuperadminDep,
    page: PageParamsDep,
    status: Annotated[SubscriptionStatus | None, Query()] = None,
    plan: str | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
) -> SubscriptionPage:
    query = (
        select(Subscription)
        .join(Organization, Organization.id == Subscription.company_id)
        .join(Plan, Plan.id == Subscription.plan_id)
    )
    if status:
        query = query.where(Subscription.status == status)
    if plan:
        query = query.where(Plan.code == plan)
    if search:
        query = query.where(Organization.name.ilike(f"%{search.replace('%', r'\%').replace('_', r'\_')}%", escape="\\"))
    count, rows = await fetch_page(
        session, query, page, order_by=[Subscription.created_at.desc()], tie_breaker=Subscription.id
    )
    return SubscriptionPage.of(page, count, [await subscription_out(session, sub) for sub in rows.scalars()])


@admin_router.get("/subscriptions/{subscription_id}", response_model=SubscriptionDetail)
async def subscription_detail(subscription_id: UUID, session: SessionDep, _admin: SuperadminDep) -> SubscriptionDetail:
    return await detail(session, await service.get_subscription(session, subscription_id=subscription_id))


@admin_router.post(
    "/subscriptions/{subscription_id}/payments",
    response_model=SubscriptionDetail,
    dependencies=[Depends(get_superadmin), idempotent()],
)
async def payment(
    subscription_id: UUID, payload: PaymentIn, session: SessionDep, admin: SuperadminDep
) -> SubscriptionDetail:
    sub = await service.record_payment(session, subscription_id, admin, **payload.model_dump())
    await session.flush()
    return await detail(session, sub)


@admin_router.post("/subscriptions/{subscription_id}/change-plan", response_model=SubscriptionDetail)
async def change_plan(
    subscription_id: UUID, payload: ChangePlanIn, session: SessionDep, admin: SuperadminDep
) -> SubscriptionDetail:
    sub = await service.get_subscription(session, subscription_id=subscription_id, lock=True)
    plan = await service.get_plan(session, payload.plan_code, lock=True)
    old = sub.plan_id
    sub.plan_id = plan.id
    sub.version += 1
    await audit.record(
        session,
        "subscription.plan_changed",
        "subscription",
        sub.id,
        actor_id=admin.id,
        org_id=sub.company_id,
        old={"plan_id": str(old)},
        new={"plan_id": str(plan.id)},
        reason=payload.reason,
    )
    await session.flush()
    return await detail(session, sub)


@admin_router.post("/subscriptions/{subscription_id}/extend-trial", response_model=SubscriptionDetail)
async def extend_trial(
    subscription_id: UUID, payload: ExtendTrialIn, session: SessionDep, admin: SuperadminDep
) -> SubscriptionDetail:
    sub = await service.get_subscription(session, subscription_id=subscription_id, lock=True)
    await service.evaluate(session, sub, utcnow())
    if sub.status != "TRIAL" or sub.trial_ends_at is None:
        raise AppError("invalid_transition", 409)
    old = sub.trial_ends_at
    sub.trial_ends_at += timedelta(days=payload.days)
    sub.version += 1
    await audit.record(
        session,
        "subscription.trial_extended",
        "subscription",
        sub.id,
        actor_id=admin.id,
        org_id=sub.company_id,
        old={"trial_ends_at": old.isoformat()},
        new={"trial_ends_at": sub.trial_ends_at.isoformat()},
        reason=payload.reason,
    )
    await session.flush()
    return await detail(session, sub)


@admin_router.get("/plans", response_model=PlanPage)
async def admin_plans(session: SessionDep, _admin: SuperadminDep, page: PageParamsDep) -> PlanPage:
    count, rows = await fetch_page(session, select(Plan), page, order_by=[Plan.sort_order], tie_breaker=Plan.id)
    return PlanPage.of(page, count, [PlanOut.model_validate(p) for p in rows.scalars()])


@admin_router.post("/plans", response_model=PlanOut, status_code=201)
async def create_plan(payload: PlanFields, session: SessionDep, admin: SuperadminDep) -> PlanOut:
    if (await session.scalars(select(Plan).where(Plan.code == payload.code))).first():
        raise AppError("version_conflict", 409)
    plan = Plan(**payload.model_dump())
    session.add(plan)
    await session.flush()
    await audit.record(
        session,
        "subscription.plan_created",
        "subscription_plan",
        plan.id,
        actor_id=admin.id,
        new=payload.model_dump(mode="json"),
    )
    return PlanOut.model_validate(plan)


@admin_router.patch("/plans/{plan_id}", response_model=PlanOut)
async def update_plan(plan_id: UUID, payload: PlanUpdate, session: SessionDep, admin: SuperadminDep) -> PlanOut:
    plan = (
        await session.scalars(
            select(Plan).where(Plan.id == plan_id).with_for_update().execution_options(populate_existing=True)
        )
    ).one_or_none()
    if plan is None:
        raise AppError("not_found", 404)
    if plan.version != payload.version:
        raise AppError("version_conflict", 409)
    # Codes are stable identifiers used by trial startup and existing integration clients.
    if "code" in payload.model_fields_set and payload.code != plan.code:
        raise AppError("validation_error", 422, {"field": "code"})
    old = PlanOut.model_validate(plan).model_dump(mode="json")
    for key, value in payload.model_dump(exclude={"version"}, exclude_unset=True).items():
        setattr(plan, key, value)
    plan.version += 1
    await session.flush()
    await audit.record(
        session,
        "subscription.plan_updated",
        "subscription_plan",
        plan.id,
        actor_id=admin.id,
        old=old,
        new=PlanOut.model_validate(plan).model_dump(mode="json"),
    )
    return PlanOut.model_validate(plan)


@admin_router.get("/plan-requests", response_model=RequestPage)
async def plan_requests(
    session: SessionDep,
    _admin: SuperadminDep,
    page: PageParamsDep,
    status: Annotated[str | None, Query(pattern="^(PENDING|DONE|DISMISSED)$")] = None,
) -> RequestPage:
    query = select(PlanChangeRequest)
    if status:
        query = query.where(PlanChangeRequest.status == status)
    count, rows = await fetch_page(
        session, query, page, order_by=[PlanChangeRequest.created_at.desc()], tie_breaker=PlanChangeRequest.id
    )
    results = []
    for request in rows.scalars():
        org = await session.get(Organization, request.company_id)
        plan = await session.get(Plan, request.requested_plan_id)
        assert org is not None and plan is not None
        results.append(
            PlanRequestDetail(
                **PlanRequestOut.model_validate(request).model_dump(), company_name=org.name, plan_code=plan.code
            )
        )
    return RequestPage.of(page, count, results)


@admin_router.post("/plan-requests/{request_id}/handle", response_model=PlanRequestOut)
async def handle_request(
    request_id: UUID, payload: RequestHandleIn, session: SessionDep, admin: SuperadminDep
) -> PlanRequestOut:
    # Lock subscription before request, consistently with owner plan-request creation.
    request = await session.get(PlanChangeRequest, request_id)
    if request is None:
        raise AppError("not_found", 404)
    sub = await service.get_subscription(session, company_id=request.company_id, lock=True)
    await session.refresh(request, with_for_update=True)
    if request.status != "PENDING":
        raise AppError("invalid_transition", 409)
    if payload.status == "DONE":
        old = sub.plan_id
        sub.plan_id = request.requested_plan_id
        sub.version += 1
        await audit.record(
            session,
            "subscription.plan_changed",
            "subscription",
            sub.id,
            actor_id=admin.id,
            org_id=sub.company_id,
            old={"plan_id": str(old)},
            new={"plan_id": str(sub.plan_id)},
            reason=payload.reason,
        )
    request.status = payload.status
    request.handled_at = utcnow()
    request.handled_by = admin.id
    await audit.record(
        session,
        "subscription.plan_request_handled",
        "plan_change_request",
        request.id,
        actor_id=admin.id,
        org_id=request.company_id,
        new={"status": request.status},
        reason=payload.reason,
    )
    await session.flush()
    return PlanRequestOut.model_validate(request)
