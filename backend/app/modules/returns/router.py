"""P10 tenant-scoped return and dispute endpoints; every command is idempotent."""

from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Select, select

from app.core.errors import AppError
from app.core.filtering import ListQuery
from app.core.idempotency import IdempotentRoute, idempotent
from app.core.pagination import Page
from app.modules.identity.deps import OrgContext, SessionDep, get_org_context, require_permission
from app.modules.returns import schemas
from app.modules.returns.models import Dispute, DisputeMessage, Return, ReturnItem, ReturnStatusHistory
from app.modules.returns.service import CompletionRequest, RequestLine, StepLine
from app.modules.returns.service import dispute_service as disputes
from app.modules.returns.service import return_service as returns

router = APIRouter(prefix="/api/v1", tags=["returns"], route_class=IdempotentRoute)
ReturnViewer = Annotated[OrgContext, Depends(require_permission("returns.view"))]
Requester = Annotated[OrgContext, Depends(require_permission("returns.request"))]
Decider = Annotated[OrgContext, Depends(require_permission("returns.approve"))]
Receiver = Annotated[OrgContext, Depends(require_permission("returns.receive"))]
Completer = Annotated[OrgContext, Depends(require_permission("returns.complete"))]
DisputeViewer = Annotated[OrgContext, Depends(require_permission("disputes.view"))]
Opener = Annotated[OrgContext, Depends(require_permission("disputes.open"))]
Messenger = Annotated[OrgContext, Depends(require_permission("disputes.message"))]
Reviewer = Annotated[OrgContext, Depends(require_permission("disputes.review"))]
Resolver = Annotated[OrgContext, Depends(require_permission("disputes.resolve"))]
Withdrawer = Annotated[OrgContext, Depends(require_permission("disputes.withdraw"))]
# Cancelling is open to either side, and the service decides which permission applies.
Context = Annotated[OrgContext, Depends(get_org_context)]


class ReturnQuery(ListQuery):
    status: schemas.ReturnStatus | None = None
    ordering: Literal["created_at", "-created_at"] = "-created_at"
    filter_columns = {"status": Return.status}
    ordering_columns = {"created_at": Return.created_at}


class DisputeQuery(ListQuery):
    status: schemas.DisputeStatus | None = None
    type: schemas.DisputeType | None = None
    ordering: Literal["created_at", "-created_at"] = "-created_at"
    filter_columns = {"status": Dispute.status, "type": Dispute.type}
    ordering_columns = {"created_at": Dispute.created_at}


def _returns_of(ctx: OrgContext) -> Select[tuple[Return]]:
    """SEC-007: another tenant's return is indistinguishable from a missing one."""
    column = Return.company_id if ctx.organization.type == "COMPANY" else Return.store_id
    return select(Return).where(column == ctx.organization.id)


def _disputes_of(ctx: OrgContext) -> Select[tuple[Dispute]]:
    column = Dispute.company_id if ctx.organization.type == "COMPANY" else Dispute.store_id
    return select(Dispute).where(column == ctx.organization.id)


async def _return(session: SessionDep, ctx: OrgContext, return_id: UUID) -> Return:
    record: Return | None = await session.scalar(_returns_of(ctx).where(Return.id == return_id))
    if record is None:
        raise AppError("not_found", 404)
    return record


async def _dispute(session: SessionDep, ctx: OrgContext, dispute_id: UUID) -> Dispute:
    record: Dispute | None = await session.scalar(_disputes_of(ctx).where(Dispute.id == dispute_id))
    if record is None:
        raise AppError("not_found", 404)
    return record


async def return_detail(session: SessionDep, record: Return) -> schemas.ReturnDetail:
    items = list(
        await session.scalars(select(ReturnItem).where(ReturnItem.return_id == record.id).order_by(ReturnItem.id))
    )
    history = list(
        await session.scalars(
            select(ReturnStatusHistory)
            .where(ReturnStatusHistory.return_id == record.id)
            .order_by(ReturnStatusHistory.created_at, ReturnStatusHistory.id)
        )
    )
    return schemas.ReturnDetail(
        **schemas.ReturnOut.model_validate(record).model_dump(),
        items=[schemas.ReturnItemOut.model_validate(row) for row in items],
        history=[schemas.ReturnHistoryOut.model_validate(row) for row in history],
    )


async def dispute_detail(session: SessionDep, record: Dispute) -> schemas.DisputeDetail:
    messages = list(
        await session.scalars(
            select(DisputeMessage)
            .where(DisputeMessage.dispute_id == record.id)
            .order_by(DisputeMessage.created_at, DisputeMessage.id)
        )
    )
    return schemas.DisputeDetail(
        **schemas.DisputeOut.model_validate(record).model_dump(),
        messages=[schemas.DisputeMessageOut.model_validate(row) for row in messages],
    )


@router.get("/orders/{order_id}/returnable", response_model=list[schemas.ReturnableOut])
async def returnable(session: SessionDep, ctx: ReturnViewer, order_id: UUID) -> list[schemas.ReturnableOut]:
    lines = await returns.returnable(session, ctx, order_id)
    return [schemas.ReturnableOut.model_validate(line) for line in lines]


@router.get("/returns", response_model=Page[schemas.ReturnOut])
async def list_returns(
    session: SessionDep, ctx: ReturnViewer, query: Annotated[ReturnQuery, Query()]
) -> Page[schemas.ReturnOut]:
    count, rows = await query.fetch(session, _returns_of(ctx), tie_breaker=Return.id)
    return Page.of(query.page, count, [schemas.ReturnOut.model_validate(row) for row in rows.scalars()])


@router.post(
    "/returns",
    response_model=schemas.ReturnDetail,
    status_code=201,
    dependencies=[idempotent(permission="returns.request")],
)
async def request_return(session: SessionDep, ctx: Requester, payload: schemas.ReturnIn) -> schemas.ReturnDetail:
    record = await returns.request(
        session,
        ctx,
        payload.order_id,
        payload.reason_code,
        payload.note,
        [RequestLine(line.order_item_id, line.quantity) for line in payload.items],
    )
    return await return_detail(session, record)


@router.get("/returns/{return_id}", response_model=schemas.ReturnDetail)
async def read_return(session: SessionDep, ctx: ReturnViewer, return_id: UUID) -> schemas.ReturnDetail:
    return await return_detail(session, await _return(session, ctx, return_id))


@router.post(
    "/returns/{return_id}/approve",
    response_model=schemas.ReturnDetail,
    dependencies=[idempotent(permission="returns.approve")],
)
async def approve_return(
    session: SessionDep, ctx: Decider, return_id: UUID, payload: schemas.ApproveIn
) -> schemas.ReturnDetail:
    record = await returns.approve(
        session,
        ctx,
        return_id,
        [StepLine(line.id, line.approved_quantity) for line in payload.items],
        payload.version,
    )
    return await return_detail(session, record)


@router.post(
    "/returns/{return_id}/reject",
    response_model=schemas.ReturnDetail,
    dependencies=[idempotent(permission="returns.approve")],
)
async def reject_return(
    session: SessionDep, ctx: Decider, return_id: UUID, payload: schemas.ReasonIn
) -> schemas.ReturnDetail:
    record = await returns.reject(session, ctx, return_id, payload.reason, payload.version)
    return await return_detail(session, record)


@router.post("/returns/{return_id}/cancel", response_model=schemas.ReturnDetail, dependencies=[idempotent()])
async def cancel_return(
    session: SessionDep, ctx: Context, return_id: UUID, payload: schemas.CancelIn
) -> schemas.ReturnDetail:
    record = await returns.cancel(session, ctx, return_id, payload.reason, payload.version)
    return await return_detail(session, record)


@router.post(
    "/returns/{return_id}/receive",
    response_model=schemas.ReturnDetail,
    dependencies=[idempotent(permission="returns.receive")],
)
async def receive_return(
    session: SessionDep, ctx: Receiver, return_id: UUID, payload: schemas.ReceiveIn
) -> schemas.ReturnDetail:
    record = await returns.receive(
        session,
        ctx,
        return_id,
        [StepLine(line.id, line.received_quantity) for line in payload.items],
        payload.version,
    )
    return await return_detail(session, record)


def _preview_items(
    items: Annotated[
        list[str],
        Query(description="Each entry is `<return_item_id>:<accepted_quantity>:<restock_quantity>`."),
    ],
) -> list[CompletionRequest]:
    """The preview is a read, so its lines travel in the query string (P10 section 7)."""
    parsed = []
    for entry in items:
        parts = entry.split(":")
        if len(parts) != 3:
            raise AppError("validation_error", 422, {"field": "items"})
        try:
            parsed.append(CompletionRequest(UUID(parts[0]), Decimal(parts[1]), Decimal(parts[2])))
        except (ValueError, InvalidOperation) as error:
            raise AppError("validation_error", 422, {"field": "items"}) from error
    return parsed


PreviewItems = Annotated[list[CompletionRequest], Depends(_preview_items)]


@router.get("/returns/{return_id}/completion-preview", response_model=schemas.CompletionPreviewOut)
async def completion_preview(
    session: SessionDep, ctx: ReturnViewer, return_id: UUID, items: PreviewItems
) -> schemas.CompletionPreviewOut:
    credit = await returns.completion_preview(session, ctx, return_id, items)
    return schemas.CompletionPreviewOut(
        lines=[
            schemas.CreditLineOut(return_item_id=return_item_id, line_credit=amount)
            for return_item_id, amount in credit.lines
        ],
        total_credit=credit.total_credit,
    )


@router.post(
    "/returns/{return_id}/complete",
    response_model=schemas.ReturnDetail,
    dependencies=[idempotent(permission="returns.complete")],
)
async def complete_return(
    session: SessionDep, ctx: Completer, return_id: UUID, payload: schemas.CompleteIn
) -> schemas.ReturnDetail:
    record = await returns.complete(
        session,
        ctx,
        return_id,
        [CompletionRequest(line.id, line.accepted_quantity, line.restock_quantity) for line in payload.items],
        payload.version,
    )
    return await return_detail(session, record)


@router.get("/disputes", response_model=Page[schemas.DisputeOut])
async def list_disputes(
    session: SessionDep, ctx: DisputeViewer, query: Annotated[DisputeQuery, Query()]
) -> Page[schemas.DisputeOut]:
    count, rows = await query.fetch(session, _disputes_of(ctx), tie_breaker=Dispute.id)
    return Page.of(query.page, count, [schemas.DisputeOut.model_validate(row) for row in rows.scalars()])


@router.post(
    "/disputes",
    response_model=schemas.DisputeDetail,
    status_code=201,
    dependencies=[idempotent(permission="disputes.open")],
)
async def open_dispute(session: SessionDep, ctx: Opener, payload: schemas.DisputeIn) -> schemas.DisputeDetail:
    record = await disputes.open(
        session,
        ctx,
        payload.target_type,
        payload.type,
        payload.description,
        payload.order_id,
        payload.payment_id,
        payload.file_ids,
    )
    return await dispute_detail(session, record)


@router.get("/disputes/{dispute_id}", response_model=schemas.DisputeDetail)
async def read_dispute(session: SessionDep, ctx: DisputeViewer, dispute_id: UUID) -> schemas.DisputeDetail:
    return await dispute_detail(session, await _dispute(session, ctx, dispute_id))


@router.post(
    "/disputes/{dispute_id}/messages",
    response_model=schemas.DisputeMessageOut,
    status_code=201,
    dependencies=[idempotent(permission="disputes.message")],
)
async def add_message(
    session: SessionDep, ctx: Messenger, dispute_id: UUID, payload: schemas.MessageIn
) -> schemas.DisputeMessageOut:
    message = await disputes.message(session, ctx, dispute_id, payload.body, payload.file_id)
    return schemas.DisputeMessageOut.model_validate(message)


@router.post("/disputes/{dispute_id}/start-review", response_model=schemas.DisputeDetail)
async def start_review(session: SessionDep, ctx: Reviewer, dispute_id: UUID) -> schemas.DisputeDetail:
    return await dispute_detail(session, await disputes.start_review(session, ctx, dispute_id))


@router.post(
    "/disputes/{dispute_id}/resolve",
    response_model=schemas.DisputeDetail,
    dependencies=[idempotent(permission="disputes.resolve")],
)
async def resolve_dispute(
    session: SessionDep, ctx: Resolver, dispute_id: UUID, payload: schemas.DisputeResolveIn
) -> schemas.DisputeDetail:
    record = await disputes.resolve(
        session,
        ctx,
        dispute_id,
        payload.resolution_type,
        payload.resolution_note,
        payload.version,
        payload.amount,
        [RequestLine(line.order_item_id, line.quantity) for line in payload.return_items],
    )
    return await dispute_detail(session, record)


@router.post(
    "/disputes/{dispute_id}/reject",
    response_model=schemas.DisputeDetail,
    dependencies=[idempotent(permission="disputes.resolve")],
)
async def reject_dispute(
    session: SessionDep, ctx: Resolver, dispute_id: UUID, payload: schemas.DisputeRejectIn
) -> schemas.DisputeDetail:
    record = await disputes.reject(session, ctx, dispute_id, payload.resolution_note, payload.version)
    return await dispute_detail(session, record)


@router.post(
    "/disputes/{dispute_id}/withdraw",
    response_model=schemas.DisputeDetail,
    dependencies=[idempotent(permission="disputes.withdraw")],
)
async def withdraw_dispute(
    session: SessionDep, ctx: Withdrawer, dispute_id: UUID, payload: schemas.VersionIn
) -> schemas.DisputeDetail:
    record = await disputes.withdraw(session, ctx, dispute_id, payload.version)
    return await dispute_detail(session, record)
