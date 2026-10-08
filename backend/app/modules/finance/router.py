"""P09 tenant-scoped finance reads and idempotent financial commands."""

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import column, select
from sqlalchemy.sql.elements import ColumnElement

from app.core import audit
from app.core.errors import AppError
from app.core.filtering import ListQuery
from app.core.idempotency import IdempotentRoute, idempotent
from app.core.pagination import Page, fetch_page
from app.core.time import utcnow
from app.modules.finance import domain, schemas
from app.modules.finance.models import (
    Adjustment,
    Allocation,
    Charge,
    Credit,
    Payment,
    PaymentStatusHistory,
    ReconciliationIssue,
)
from app.modules.finance.service import finance_service as finance
from app.modules.finance.service import party
from app.modules.identity.deps import OrgContext, SessionDep, SuperadminDep, get_org_context, require_permission
from app.modules.partnerships.models import Partnership

router = APIRouter(prefix="/api/v1", tags=["finance"], route_class=IdempotentRoute)
Viewer = Annotated[OrgContext, Depends(require_permission("finance.view"))]
Recorder = Annotated[OrgContext, Depends(require_permission("payments.record"))]
Confirmer = Annotated[OrgContext, Depends(require_permission("payments.confirm"))]
Rejecter = Annotated[OrgContext, Depends(require_permission("payments.reject"))]
Creator = Annotated[OrgContext, Depends(require_permission("adjustments.create"))]
Approver = Annotated[OrgContext, Depends(require_permission("adjustments.approve"))]
Context = Annotated[OrgContext, Depends(get_org_context)]


async def record_context(ctx: Recorder, payload: schemas.RecordIn) -> OrgContext:
    if payload.confirm and "payments.confirm" not in ctx.permissions:
        raise AppError("permission_denied", 403)
    return ctx


RecordContext = Annotated[OrgContext, Depends(record_context)]


class BalanceQuery(ListQuery):
    overdue: bool | None = None
    ordering: Literal["balance", "-balance", "overdue", "-overdue"] = "-balance"
    # Aggregated financial columns are bound explicitly after tenant scoping.
    ordering_columns = {"balance": column("balance"), "overdue": column("overdue")}


class ChargeQuery(ListQuery):
    status: schemas.ChargeStatus | None = None
    overdue: bool | None = None
    filter_columns = {"status": Charge.status}
    fixed_ordering = (Charge.due_date, Charge.created_at)


class PaymentQuery(schemas.DateRange, ListQuery):
    status: schemas.PaymentStatus | None = None
    partnership_id: UUID | None = None
    method: schemas.PaymentMethod | None = None
    filter_columns = {"status": Payment.status, "partnership_id": Payment.partnership_id, "method": Payment.method}
    fixed_ordering = (Payment.created_at.desc(),)


class AdjustmentQuery(ListQuery):
    status: schemas.AdjustmentStatus | None = None
    partnership_id: UUID | None = None
    filter_columns = {"status": Adjustment.status, "partnership_id": Adjustment.partnership_id}
    fixed_ordering = (Adjustment.created_at.desc(),)


class IssueQuery(ListQuery):
    resolved: bool | None = None
    partnership_id: UUID | None = None
    filter_columns = {"partnership_id": ReconciliationIssue.partnership_id}
    fixed_ordering = (ReconciliationIssue.detected_at.desc(),)


def scoped(model: type[Payment] | type[Charge], ctx: OrgContext) -> ColumnElement[bool]:
    column = model.company_id if ctx.organization.type == "COMPANY" else model.store_id
    return column == ctx.organization.id


async def payment_detail(session: SessionDep, payment: Payment) -> schemas.PaymentDetail:
    history = list(
        await session.scalars(
            select(PaymentStatusHistory)
            .where(PaymentStatusHistory.payment_id == payment.id)
            .order_by(PaymentStatusHistory.created_at, PaymentStatusHistory.id)
        )
    )
    allocations = list(
        await session.scalars(
            select(Allocation)
            .join(Credit, Credit.id == Allocation.credit_id)
            .where(Credit.kind == "PAYMENT", Credit.source_id == payment.id)
            .order_by(Allocation.created_at, Allocation.id)
        )
    )
    return schemas.PaymentDetail(
        **schemas.FinancePaymentOut.model_validate(payment).model_dump(),
        history=[schemas.HistoryOut.model_validate(r) for r in history],
        allocations=[schemas.AllocationOut.model_validate(r) for r in allocations],
    )


@router.get("/finance/summary", response_model=schemas.SummaryOut)
async def summary(session: SessionDep, ctx: Viewer) -> schemas.SummaryOut:
    return schemas.SummaryOut.model_validate(await finance.summary(session, ctx))


@router.get("/finance/partnerships", response_model=Page[schemas.PartnerBalanceOut])
async def partnerships(
    session: SessionDep, ctx: Viewer, query: Annotated[BalanceQuery, Query()]
) -> Page[schemas.PartnerBalanceOut]:
    rollup = finance.balances_query(ctx).subquery()
    statement = select(rollup)
    if query.overdue is not None:
        statement = statement.where(rollup.c.overdue > 0 if query.overdue else rollup.c.overdue == 0)
    column = rollup.c[query.ordering.removeprefix("-")]
    count, rows = await fetch_page(
        session,
        statement,
        query.page,
        order_by=[column.desc() if query.ordering.startswith("-") else column],
        tie_breaker=rollup.c.partnership_id,
    )
    return Page.of(
        query.page,
        count,
        [schemas.PartnerBalanceOut.model_validate(finance.balance_output(r)) for r in rows.mappings()],
    )


@router.get("/finance/partnerships/{partnership_id}", response_model=schemas.BalanceOut)
async def balance(session: SessionDep, ctx: Viewer, partnership_id: UUID) -> schemas.BalanceOut:
    await party(session, partnership_id, ctx)
    return schemas.BalanceOut.model_validate(await finance.balance(session, partnership_id))


@router.get("/finance/partnerships/{partnership_id}/charges", response_model=Page[schemas.ChargeOut])
async def charges(
    session: SessionDep, ctx: Viewer, partnership_id: UUID, query: Annotated[ChargeQuery, Query()]
) -> Page[schemas.ChargeOut]:
    await party(session, partnership_id, ctx)
    statement = select(Charge).where(Charge.partnership_id == partnership_id)
    if query.overdue is not None:
        overdue = (Charge.due_date < domain.local_date(utcnow())) & (Charge.status != "PAID")
        statement = statement.where(overdue if query.overdue else ~overdue)
    count, rows = await query.fetch(session, statement, tie_breaker=Charge.id)
    return Page.of(query.page, count, [schemas.ChargeOut.model_validate(r) for r in rows.scalars()])


@router.get("/finance/partnerships/{partnership_id}/statement", response_model=schemas.StatementOut)
async def statement(
    session: SessionDep, ctx: Viewer, partnership_id: UUID, query: Annotated[schemas.DateRange, Query()]
) -> schemas.StatementOut:
    await party(session, partnership_id, ctx)
    result = await finance.statement(session, partnership_id, query.date_from, query.date_to)
    return schemas.StatementOut.model_validate(result)


@router.get("/finance/partnerships/{partnership_id}/allocation-preview", response_model=schemas.PreviewOut)
async def preview(
    session: SessionDep, ctx: Viewer, partnership_id: UUID, amount: Annotated[Decimal, Query()]
) -> schemas.PreviewOut:
    await party(session, partnership_id, ctx)
    return schemas.PreviewOut.model_validate(await finance.payment_preview(session, partnership_id, amount))


@router.get("/finance/charges/{charge_id}", response_model=schemas.ChargeDetail)
async def charge(session: SessionDep, ctx: Viewer, charge_id: UUID) -> schemas.ChargeDetail:
    row = await session.scalar(select(Charge).where(Charge.id == charge_id, scoped(Charge, ctx)))
    if row is None:
        raise AppError("not_found", 404)
    allocations = list(
        await session.scalars(
            select(Allocation).where(Allocation.charge_id == charge_id).order_by(Allocation.created_at, Allocation.id)
        )
    )
    return schemas.ChargeDetail(
        **schemas.ChargeOut.model_validate(row).model_dump(),
        allocations=[schemas.AllocationOut.model_validate(r) for r in allocations],
    )


@router.get("/payments", response_model=Page[schemas.FinancePaymentOut])
async def payments(
    session: SessionDep, ctx: Viewer, query: Annotated[PaymentQuery, Query()]
) -> Page[schemas.FinancePaymentOut]:
    statement = select(Payment).where(scoped(Payment, ctx))
    if query.date_from:
        statement = statement.where(
            Payment.created_at >= datetime.combine(query.date_from, time.min, tzinfo=domain.FINANCE_TIMEZONE)
        )
    if query.date_to and query.date_to < date.max:
        statement = statement.where(
            Payment.created_at
            < datetime.combine(query.date_to + timedelta(days=1), time.min, tzinfo=domain.FINANCE_TIMEZONE)
        )
    count, rows = await query.fetch(session, statement, tie_breaker=Payment.id)
    return Page.of(query.page, count, [schemas.FinancePaymentOut.model_validate(r) for r in rows.scalars()])


@router.post(
    "/payments",
    response_model=schemas.PaymentDetail,
    status_code=201,
    dependencies=[Depends(record_context), idempotent(permission="payments.record")],
)
async def record_payment(session: SessionDep, ctx: RecordContext, payload: schemas.RecordIn) -> schemas.PaymentDetail:
    payment = await finance.record_payment(session, ctx, **payload.model_dump())
    return await payment_detail(session, payment)


@router.get("/payments/{payment_id}", response_model=schemas.PaymentDetail)
async def payment(session: SessionDep, ctx: Viewer, payment_id: UUID) -> schemas.PaymentDetail:
    row = await session.scalar(select(Payment).where(Payment.id == payment_id, scoped(Payment, ctx)))
    if row is None:
        raise AppError("not_found", 404)
    return await payment_detail(session, row)


@router.post(
    "/payments/{payment_id}/confirm",
    response_model=schemas.PaymentDetail,
    dependencies=[idempotent(permission="payments.confirm")],
)
async def confirm_payment(
    session: SessionDep, ctx: Confirmer, payment_id: UUID, payload: schemas.VersionIn
) -> schemas.PaymentDetail:
    return await payment_detail(session, await finance.confirm_payment(session, ctx, payment_id, payload.version))


@router.post(
    "/payments/{payment_id}/reject",
    response_model=schemas.PaymentDetail,
    dependencies=[idempotent(permission="payments.reject")],
)
async def reject_payment(
    session: SessionDep, ctx: Rejecter, payment_id: UUID, payload: schemas.RejectIn
) -> schemas.PaymentDetail:
    return await payment_detail(
        session, await finance.reject_payment(session, ctx, payment_id, payload.reason, payload.version)
    )


@router.post(
    "/payments/{payment_id}/cancel",
    response_model=schemas.PaymentDetail,
    dependencies=[idempotent(permission="org.view")],
)
async def cancel_payment(
    session: SessionDep, ctx: Context, payment_id: UUID, payload: schemas.VersionIn
) -> schemas.PaymentDetail:
    return await payment_detail(session, await finance.cancel_payment(session, ctx, payment_id, payload.version))


@router.get("/adjustments", response_model=Page[schemas.AdjustmentOut])
async def adjustments(
    session: SessionDep, ctx: Viewer, query: Annotated[AdjustmentQuery, Query()]
) -> Page[schemas.AdjustmentOut]:
    if ctx.organization.type != "COMPANY":
        raise AppError("permission_denied", 403)
    statement = (
        select(Adjustment)
        .join(Partnership, Partnership.id == Adjustment.partnership_id)
        .where(Partnership.company_id == ctx.organization.id)
    )
    count, rows = await query.fetch(session, statement, tie_breaker=Adjustment.id)
    return Page.of(query.page, count, [schemas.AdjustmentOut.model_validate(r) for r in rows.scalars()])


@router.post(
    "/adjustments",
    response_model=schemas.AdjustmentOut,
    status_code=201,
    dependencies=[idempotent(permission="adjustments.create")],
)
async def create_adjustment(session: SessionDep, ctx: Creator, payload: schemas.AdjustmentIn) -> schemas.AdjustmentOut:
    return schemas.AdjustmentOut.model_validate(await finance.create_adjustment(session, ctx, **payload.model_dump()))


@router.post(
    "/adjustments/{adjustment_id}/approve",
    response_model=schemas.AdjustmentOut,
    dependencies=[idempotent(permission="adjustments.approve")],
)
async def approve_adjustment(
    session: SessionDep, ctx: Approver, adjustment_id: UUID, payload: schemas.VersionIn
) -> schemas.AdjustmentOut:
    return schemas.AdjustmentOut.model_validate(
        await finance.approve_adjustment(session, ctx, adjustment_id, payload.version)
    )


@router.post(
    "/adjustments/{adjustment_id}/reject",
    response_model=schemas.AdjustmentOut,
    dependencies=[idempotent(permission="adjustments.approve")],
)
async def reject_adjustment(
    session: SessionDep, ctx: Approver, adjustment_id: UUID, payload: schemas.RejectIn
) -> schemas.AdjustmentOut:
    return schemas.AdjustmentOut.model_validate(
        await finance.reject_adjustment(session, ctx, adjustment_id, payload.reason, payload.version)
    )


@router.get("/admin/reconciliation-issues", response_model=Page[schemas.ReconciliationOut])
async def issues(
    session: SessionDep, admin: SuperadminDep, query: Annotated[IssueQuery, Query()]
) -> Page[schemas.ReconciliationOut]:
    statement = select(ReconciliationIssue)
    if query.resolved is not None:
        statement = statement.where(
            ReconciliationIssue.resolved_at.is_not(None)
            if query.resolved
            else ReconciliationIssue.resolved_at.is_(None)
        )
    count, rows = await query.fetch(session, statement, tie_breaker=ReconciliationIssue.id)
    return Page.of(query.page, count, [schemas.ReconciliationOut.model_validate(r) for r in rows.scalars()])


@router.post("/admin/reconciliation-issues/{issue_id}/resolve", response_model=schemas.ReconciliationOut)
async def resolve(
    session: SessionDep, admin: SuperadminDep, issue_id: UUID, payload: schemas.ResolveIn
) -> schemas.ReconciliationOut:
    issue = await session.scalar(
        select(ReconciliationIssue).where(ReconciliationIssue.id == issue_id).with_for_update()
    )
    if issue is None:
        raise AppError("not_found", 404)
    if issue.resolved_at is not None:
        raise AppError("invalid_transition", 409)
    issue.resolved_at, issue.resolved_by, issue.note = utcnow(), admin.id, payload.note
    await audit.record(
        session, "reconciliation.resolved", "reconciliation_issues", issue.id, actor_id=admin.id, reason=payload.note
    )
    await session.flush()
    return schemas.ReconciliationOut.model_validate(issue)
