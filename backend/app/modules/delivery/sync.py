"""DEL-020…026: replaying a courier's offline queue.

The queue is the courier's phone talking about work it did while it had no signal, so three things
decide the outcome and none of them is the client's opinion of the world:

* the `operation_id` is the primary key of the log, so a queue replayed twice acts once (DEL-023);
* each operation gets its own transaction, so an earlier success is never undone by a later failure
  in the same batch (DEL-022);
* the server's current state wins. An operation that the current state still permits is applied even
  if the client expected something else (DEL-025); one it does not permit comes back as a conflict
  carrying the real state, and the client is expected to show it rather than retry (DEL-024).
"""

from typing import Any
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import UnitOfWork
from app.core.errors import AppError
from app.core.time import utcnow
from app.modules.delivery.models import CourierSyncOperation, Delivery
from app.modules.delivery.schemas import DeliveryOut, SyncOperationIn, SyncResult, SyncResultOut
from app.modules.delivery.service import Actor, delivery_service
from app.modules.identity.deps import OrgContext

#  DEL-024/026: a conflict means "the server moved on, here is where it is"; a rejection means the
# operation itself was never acceptable. The client clears both from the queue but shows them apart.
CONFLICT_CODES = {"invalid_transition", "version_conflict"}


def _classify(error: AppError) -> tuple[SyncResult, str]:
    return ("CONFLICT", "sync_conflict") if error.code in CONFLICT_CODES else ("REJECTED", error.code)


async def _state(session: AsyncSession, ctx: OrgContext, delivery_id: UUID) -> DeliveryOut | None:
    delivery = await session.scalar(
        select(Delivery).where(Delivery.id == delivery_id, Delivery.company_id == ctx.organization.id)
    )
    if delivery is not None and "delivery.act_any" not in ctx.permissions and delivery.courier_id != ctx.user.id:
        return None
    return DeliveryOut.model_validate(delivery) if delivery else None


async def _perform(session: AsyncSession, actor: Actor, operation: SyncOperationIn) -> None:
    if operation.operation_type == "PAYMENT_RECORD":
        raise AppError("not_supported", 422)
    delivery = await session.scalar(
        select(Delivery).where(Delivery.id == operation.entity_id, Delivery.company_id == actor.ctx.organization.id)
    )
    if delivery is None or (
        "delivery.act_any" not in actor.ctx.permissions and delivery.courier_id != actor.ctx.user.id
    ):
        raise AppError("not_found", 404)
    if operation.operation_type == "DELIVERY_ARRIVE":
        await delivery_service.arrive(session, actor, delivery)
    elif operation.operation_type == "DELIVERY_CONFIRM":
        code = str(operation.payload.get("code") or "")
        if not code:
            raise AppError("validation_error", 422, {"field": "code"})
        from app.core import rate_limit

        await rate_limit.hit(rate_limit.DELIVERY_CONFIRM, f"{actor.ctx.user.id}:{delivery.id}")
        await delivery_service.confirm(session, actor, delivery, code)
    elif operation.operation_type == "DELIVERY_FAIL":
        reason = str(operation.payload.get("reason_code") or "")
        note = operation.payload.get("note")
        await delivery_service.fail(session, actor, delivery, reason, str(note) if note else None)
    else:  # PAYMENT_RECORD arrives before P09 exists.
        raise AppError("not_supported", 422)


def _stored_payload(operation: SyncOperationIn) -> dict[str, Any]:
    """DEL-021: whatever the client sent, the code is not what gets written down."""
    # Allowlist avoids retaining codes hidden in arbitrary extra/nested fields.
    return {key: value for key, value in operation.payload.items() if key in {"reason_code", "note"}} | {
        "expected_status": operation.expected_status
    }


class SyncService:
    async def apply(self, ctx: OrgContext, operations: list[SyncOperationIn]) -> list[SyncResultOut]:
        results: list[SyncResultOut] = []
        # DEL-022: the client's own ordering is the causal one — arrive before confirm.
        for operation in sorted(operations, key=lambda item: item.client_created_at):
            results.append(await self._one(ctx, operation))
        return results

    async def _one(self, ctx: OrgContext, operation: SyncOperationIn) -> SyncResultOut:
        """One operation, one transaction. The log row is written whatever the outcome."""
        async with UnitOfWork() as uow:
            session = uow.session
            # Serialize retries before any business effects, including rejected code
            # attempts committed outside this transaction.
            await session.execute(
                text("SELECT pg_advisory_xact_lock(:key)"),
                {"key": int.from_bytes(operation.operation_id.bytes[:8], "big", signed=True)},
            )
            seen = await session.get(CourierSyncOperation, operation.operation_id)
            if seen is not None:
                if seen.courier_id != ctx.user.id or await _state(session, ctx, seen.entity_id) is None:
                    return SyncResultOut(
                        operation_id=operation.operation_id, result_status="REJECTED", error="not_found"
                    )
                stored_state = seen.result.get("server_state")
                return SyncResultOut(
                    operation_id=operation.operation_id,
                    result_status="DUPLICATE",
                    error=seen.result.get("error"),
                    server_state=DeliveryOut.model_validate(stored_state) if stored_state else None,
                )
            status: SyncResult = "APPLIED"
            error: str | None = None
            try:
                # A savepoint, so a refused operation still leaves the log row behind to commit.
                async with session.begin_nested():
                    await _perform(session, Actor(ctx, "OFFLINE_SYNC"), operation)
            except AppError as refused:
                status, error = _classify(refused)
            state = await _state(session, ctx, operation.entity_id)
            session.add(
                CourierSyncOperation(
                    id=operation.operation_id,
                    courier_id=ctx.user.id,
                    operation_type=operation.operation_type,
                    entity_id=operation.entity_id,
                    payload=_stored_payload(operation),
                    client_created_at=operation.client_created_at,
                    received_at=utcnow(),
                    result_status=status,
                    result={
                        "error": error,
                        "server_state": state.model_dump(mode="json") if state and status == "CONFLICT" else None,
                    },
                )
            )
            await session.flush()
        return SyncResultOut(
            operation_id=operation.operation_id,
            result_status=status,
            error=error,
            server_state=state if status == "CONFLICT" else None,
        )


sync_service = SyncService()
