"""P10 return and dispute workflows.

Every write takes the project's lock order (company organization, subscription,
partnership) before touching a return or dispute, and shares the caller's transaction so
a failed credit note or restock undoes the whole completion.

A return is the only P10 operation with a financial effect: completing one posts a credit
note through the finance service and returns goods to stock. A dispute never writes to the
ledger (DSP-020); its resolution either does nothing, asks finance for an adjustment, or
creates a return, and it is those records that carry the money.
"""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.errors import AppError
from app.core.events import DomainEvent, event_bus
from app.core.sequences import SequenceService
from app.core.time import utcnow
from app.modules.files.service import get_owned
from app.modules.finance import service as finance
from app.modules.finance.models import Payment
from app.modules.identity.deps import OrgContext
from app.modules.identity.team_service import lock_org
from app.modules.inventory import service as inventory
from app.modules.orders import service as orders
from app.modules.orders.models import Order, OrderItem
from app.modules.partnerships import service as partners
from app.modules.partnerships.models import Partnership
from app.modules.returns import domain
from app.modules.returns.models import (
    DISPUTE_TYPES,
    RESOLUTION_TYPES,
    RETURN_REASONS,
    Dispute,
    DisputeMessage,
    Return,
    ReturnItem,
    ReturnStatusHistory,
)
from app.modules.subscriptions import service as subscriptions
from app.modules.subscriptions.domain import SubAction

MAX_LINES = 200
MAX_FILES = 10
ZERO = Decimal("0.00")
ZERO_QUANTITY = Decimal("0.000")


async def _attachment(session: AsyncSession, ctx: OrgContext, file_id: UUID) -> None:
    stored = await get_owned(session, ctx.organization.id, file_id)
    if stored.category != "DISPUTE":
        raise AppError("file_type_not_allowed", 422)


@dataclass(frozen=True)
class RequestLine:
    order_item_id: UUID
    quantity: Decimal


@dataclass(frozen=True)
class StepLine:
    """One decision about a return item: the quantity for the step being applied."""

    return_item_id: UUID
    quantity: Decimal


@dataclass(frozen=True)
class CompletionRequest:
    return_item_id: UUID
    accepted_quantity: Decimal
    restock_quantity: Decimal


@dataclass(frozen=True)
class ReturnableLine:
    order_item_id: UUID
    product_name: str
    unit_code: str
    allow_fraction: bool
    confirmed_quantity: Decimal
    returned_quantity: Decimal
    max_returnable: Decimal
    return_deadline: datetime | None


def _version(record: Return | Dispute, expected: int) -> None:
    if record.version != expected:
        raise AppError("version_conflict", 409, {"current_version": record.version})


async def _lock_party(session: AsyncSession, ctx: OrgContext, partnership_id: UUID) -> Partnership:
    """The project lock order, without demanding `partners.view`.

    A warehouse member may receive a return (P10 section 6) but has no partner permission,
    so the partnership is read and locked here rather than through `partners.locked`.
    """
    partner = await finance.party(session, partnership_id, ctx)
    await lock_org(session, partner.company_id)
    await subscriptions.get_subscription(session, company_id=partner.company_id, lock=True)
    # RET-014: RETURNS_DISPUTES is always allowed, and asking keeps the rule in one place.
    await subscriptions.guard.require(session, partner.company_id, SubAction.RETURNS_DISPUTES)
    return await finance.party(session, partnership_id, ctx)


def _unique_lines(lines: list[RequestLine] | list[StepLine] | list[CompletionRequest]) -> None:
    identifiers = [line.order_item_id if isinstance(line, RequestLine) else line.return_item_id for line in lines]
    if not lines or len(lines) > MAX_LINES or len(set(identifiers)) != len(identifiers):
        raise AppError("validation_error", 422, {"field": "items"})


class ReturnService:
    async def _order(self, session: AsyncSession, ctx: OrgContext, order_id: UUID) -> tuple[Order, Partnership]:
        column = Order.company_id if ctx.organization.type == "COMPANY" else Order.store_id
        order = await session.scalar(select(Order).where(Order.id == order_id, column == ctx.organization.id))
        if order is None:
            raise AppError("not_found", 404)
        return order, await finance.party(session, order.partnership_id, ctx)

    async def _accepted_by_item(self, session: AsyncSession, order_id: UUID) -> dict[UUID, Decimal]:
        """RET-003: how much of each line earlier completed returns already took back."""
        rows = await session.execute(
            select(ReturnItem.order_item_id, func.coalesce(func.sum(ReturnItem.accepted_quantity), 0))
            .join(Return, Return.id == ReturnItem.return_id)
            .where(Return.order_id == order_id, Return.status == "COMPLETED")
            .group_by(ReturnItem.order_item_id)
        )
        return {order_item_id: Decimal(total) for order_item_id, total in rows}

    def _window(self, order: Order) -> int:
        """RET-002 uses the terms frozen onto the order, not today's terms."""
        return int((order.terms_snapshot or {}).get("return_days", 14))

    async def returnable(self, session: AsyncSession, ctx: OrgContext, order_id: UUID) -> list[ReturnableLine]:
        partners.require(ctx, "returns.view")
        order, _ = await self._order(session, ctx, order_id)
        domain.ensure_returnable_order(order.status)
        accepted = await self._accepted_by_item(session, order.id)
        deadline = domain.return_deadline(order.delivered_at, self._window(order)) if order.delivered_at else None
        items = list(await session.scalars(select(OrderItem).where(OrderItem.order_id == order.id)))
        lines = []
        for item in sorted(items, key=lambda row: row.product_name_snapshot):
            confirmed = item.confirmed_quantity if item.confirmed_quantity is not None else item.requested_quantity
            returned = accepted.get(item.id, ZERO_QUANTITY)
            lines.append(
                ReturnableLine(
                    item.id,
                    item.product_name_snapshot,
                    item.unit_code_snapshot,
                    item.allow_fraction_snapshot,
                    confirmed,
                    returned,
                    domain.max_returnable(confirmed, returned),
                    deadline,
                )
            )
        return lines

    async def _logged(
        self,
        session: AsyncSession,
        partner: Partnership,
        action: str,
        table: str,
        record_id: UUID,
        actor_id: UUID | None,
        event: str | None = None,
        reason: str | None = None,
        recipient: UUID | None = None,
    ) -> None:
        await session.flush()
        await audit.record(
            session,
            action,
            table,
            record_id,
            actor_id=actor_id,
            org_id=partner.company_id,
            reason=reason,
            new={"partnership_id": str(partner.id)},
        )
        if event:
            await event_bus.publish(
                session,
                DomainEvent(
                    event,
                    {
                        "id": str(record_id),
                        "partnership_id": str(partner.id),
                        "company_id": str(partner.company_id),
                        "store_id": str(partner.store_id),
                    },
                    org_id=recipient or partner.company_id,
                ),
            )

    async def _history(
        self,
        session: AsyncSession,
        record: Return,
        from_status: str | None,
        to_status: str,
        actor_id: UUID | None,
        reason: str | None = None,
    ) -> None:
        session.add(
            ReturnStatusHistory(
                return_id=record.id,
                from_status=from_status,
                to_status=to_status,
                actor_id=actor_id,
                actor_type="USER" if actor_id else "SYSTEM",
                reason=reason,
            )
        )

    async def _number(self, session: AsyncSession, company_id: UUID, now: datetime) -> str:
        number = await SequenceService(session).next("return_number", f"{company_id}:{now.year}")
        if number > 999999:
            raise AppError("validation_error", 409, {"reason": "return_number_exhausted"})
        return f"RET-{now.year}-{number:06}"

    async def _locked(self, session: AsyncSession, ctx: OrgContext, return_id: UUID, expected: int) -> Return:
        column = Return.company_id if ctx.organization.type == "COMPANY" else Return.store_id
        record = await session.scalar(select(Return).where(Return.id == return_id, column == ctx.organization.id))
        if record is None:
            raise AppError("not_found", 404)
        await _lock_party(session, ctx, record.partnership_id)
        await session.refresh(record, with_for_update=True)
        _version(record, expected)
        return record

    async def _items(self, session: AsyncSession, return_id: UUID) -> dict[UUID, ReturnItem]:
        rows = await session.scalars(select(ReturnItem).where(ReturnItem.return_id == return_id))
        return {row.id: row for row in rows}

    async def request(
        self,
        session: AsyncSession,
        ctx: OrgContext,
        order_id: UUID,
        reason_code: str,
        note: str | None,
        lines: list[RequestLine],
    ) -> Return:
        """RET-001..004: the store asks for a return against a delivered order."""
        partners.require(ctx, "returns.request", "STORE")
        _unique_lines(lines)
        if reason_code not in RETURN_REASONS:
            raise AppError("validation_error", 422, {"field": "reason_code"})
        if reason_code == "OTHER" and not (note or "").strip():
            raise AppError("validation_error", 422, {"field": "note"})
        order, _ = await self._order(session, ctx, order_id)
        partner = await _lock_party(session, ctx, order.partnership_id)
        domain.ensure_returnable_order(order.status)
        if order.delivered_at is None:
            raise AppError("invalid_transition", 409, {"reason": "order_not_delivered"})
        domain.ensure_return_window(order.delivered_at, self._window(order), utcnow())
        if await self.has_open(session, order.id):
            raise AppError("invalid_transition", 409, {"reason": "return_already_open"})
        accepted = await self._accepted_by_item(session, order.id)
        items = {
            item.id: item for item in await session.scalars(select(OrderItem).where(OrderItem.order_id == order.id))
        }
        now = utcnow()
        record = Return(
            return_number=await self._number(session, partner.company_id, now),
            company_id=partner.company_id,
            store_id=partner.store_id,
            partnership_id=partner.id,
            order_id=order.id,
            status="REQUESTED",
            reason_code=reason_code,
            note=(note or "").strip() or None,
            source="STORE_REQUEST",
            requested_by=ctx.user.id,
            requested_at=now,
        )
        session.add(record)
        try:
            await session.flush()
        except IntegrityError as error:
            # The partial unique index is the race backstop for the check above.
            raise AppError("invalid_transition", 409, {"reason": "return_already_open"}) from error
        for line in lines:
            item = items.get(line.order_item_id)
            if item is None:
                raise AppError("not_found", 404, {"field": "order_item_id"})
            orders.check_quantity(line.quantity, item.allow_fraction_snapshot, positive=True)
            confirmed = item.confirmed_quantity if item.confirmed_quantity is not None else item.requested_quantity
            quantity = domain.ensure_return_quantity(line.quantity, confirmed, accepted.get(item.id, ZERO_QUANTITY))
            session.add(ReturnItem(return_id=record.id, order_item_id=item.id, requested_quantity=quantity))
        await session.flush()
        await self._history(session, record, None, "REQUESTED", ctx.user.id)
        await self._logged(session, partner, "return.requested", "returns", record.id, ctx.user.id, "RETURN_REQUESTED")
        return record

    async def has_open(self, session: AsyncSession, order_id: UUID) -> bool:
        return bool(
            await session.scalar(
                select(Return.id)
                .where(Return.order_id == order_id, Return.status.in_(sorted(domain.OPEN_RETURN_STATUSES)))
                .limit(1)
            )
        )

    async def _step(
        self,
        session: AsyncSession,
        ctx: OrgContext,
        return_id: UUID,
        expected: int,
        action: Literal["approve", "receive"],
        lines: list[StepLine],
        permission: str,
    ) -> Return:
        partners.require(ctx, permission, "COMPANY")
        _unique_lines(lines)
        record = await self._locked(session, ctx, return_id, expected)
        target = domain.ensure_return_transition(record.status, action)
        partner = await finance.party(session, record.partnership_id)
        items = await self._items(session, record.id)
        if {line.return_item_id for line in lines} != set(items):
            raise AppError("validation_error", 422, {"field": "items"})
        decided = ZERO_QUANTITY
        for line in lines:
            item = items[line.return_item_id]
            ceiling = item.requested_quantity if action == "approve" else (item.approved_quantity or ZERO_QUANTITY)
            field = "approved_quantity" if action == "approve" else "received_quantity"
            quantity = domain.ensure_within(line.quantity, ceiling, field)
            setattr(item, field, quantity)
            decided += quantity
        if action == "approve" and decided <= ZERO_QUANTITY:
            # "Every line approved as zero" is a rejection, and must be recorded as one.
            raise AppError("validation_error", 422, {"field": "items", "reason": "reject_instead"})
        from_status = record.status
        record.status = target
        record.version += 1
        if action == "approve":
            record.approved_by, record.approved_at = ctx.user.id, utcnow()
        else:
            record.received_by, record.received_at = ctx.user.id, utcnow()
        await self._history(session, record, from_status, target, ctx.user.id)
        await self._logged(
            session,
            partner,
            f"return.{target.lower()}",
            "returns",
            record.id,
            ctx.user.id,
            f"RETURN_{target}",
            recipient=partner.store_id,
        )
        return record

    async def approve(
        self, session: AsyncSession, ctx: OrgContext, return_id: UUID, lines: list[StepLine], expected: int
    ) -> Return:
        return await self._step(session, ctx, return_id, expected, "approve", lines, "returns.approve")

    async def receive(
        self, session: AsyncSession, ctx: OrgContext, return_id: UUID, lines: list[StepLine], expected: int
    ) -> Return:
        return await self._step(session, ctx, return_id, expected, "receive", lines, "returns.receive")

    async def reject(
        self, session: AsyncSession, ctx: OrgContext, return_id: UUID, reason: str, expected: int
    ) -> Return:
        partners.require(ctx, "returns.approve", "COMPANY")
        if len(reason.strip()) < 3:
            raise AppError("validation_error", 422, {"field": "reason"})
        record = await self._locked(session, ctx, return_id, expected)
        target = domain.ensure_return_transition(record.status, "reject")
        partner = await finance.party(session, record.partnership_id)
        from_status, record.status = record.status, target
        record.rejection_reason = reason.strip()
        record.version += 1
        await self._history(session, record, from_status, target, ctx.user.id, reason.strip())
        await self._logged(
            session,
            partner,
            "return.rejected",
            "returns",
            record.id,
            ctx.user.id,
            "RETURN_REJECTED",
            reason.strip(),
            recipient=partner.store_id,
        )
        return record

    async def cancel(
        self, session: AsyncSession, ctx: OrgContext, return_id: UUID, reason: str | None, expected: int
    ) -> Return:
        """The store cancels its own request; the company cancels an approved return with a reason."""
        store_side = ctx.organization.type == "STORE"
        partners.require(ctx, "returns.cancel_own" if store_side else "returns.approve")
        record = await self._locked(session, ctx, return_id, expected)
        if store_side and record.status != "REQUESTED":
            raise AppError("invalid_transition", 409, {"status": record.status})
        if not store_side and (reason is None or len(reason.strip()) < 3):
            raise AppError("validation_error", 422, {"field": "reason"})
        target = domain.ensure_return_transition(record.status, "cancel")
        partner = await finance.party(session, record.partnership_id)
        from_status, record.status = record.status, target
        record.cancel_reason = (reason or "").strip() or None
        record.version += 1
        await self._history(session, record, from_status, target, ctx.user.id, record.cancel_reason)
        await self._logged(
            session, partner, "return.cancelled", "returns", record.id, ctx.user.id, None, record.cancel_reason
        )
        return record

    async def _completion_lines(
        self, session: AsyncSession, record: Return, requests: list[CompletionRequest]
    ) -> tuple[list[domain.CompletionLine], dict[UUID, ReturnItem], Order]:
        order = await session.get(Order, record.order_id)
        if order is None or order.subtotal is None:
            raise AppError("invalid_transition", 409, {"reason": "order_not_confirmed"})
        items = await self._items(session, record.id)
        if {line.return_item_id for line in requests} != set(items):
            raise AppError("validation_error", 422, {"field": "items"})
        order_items = {
            item.id: item for item in await session.scalars(select(OrderItem).where(OrderItem.order_id == order.id))
        }
        lines = []
        for request in requests:
            item = items[request.return_item_id]
            received = item.received_quantity or ZERO_QUANTITY
            accepted = domain.ensure_within(request.accepted_quantity, received, "accepted_quantity")
            restock = domain.ensure_within(request.restock_quantity, accepted, "restock_quantity")
            source = order_items[item.order_item_id]
            lines.append(
                domain.CompletionLine(item.id, source.unit_price, source.unit_coefficient_snapshot, accepted, restock)
            )
        return lines, items, order

    async def completion_preview(
        self, session: AsyncSession, ctx: OrgContext, return_id: UUID, requests: list[CompletionRequest]
    ) -> domain.CompletionCredit:
        """RET-010 without writing anything: the company sees the credit before it posts."""
        partners.require(ctx, "returns.view")
        _unique_lines(requests)
        column = Return.company_id if ctx.organization.type == "COMPANY" else Return.store_id
        record = await session.scalar(select(Return).where(Return.id == return_id, column == ctx.organization.id))
        if record is None:
            raise AppError("not_found", 404)
        lines, _, order = await self._completion_lines(session, record, requests)
        return domain.completion_credit(lines, order.subtotal or ZERO, order.discount)

    async def complete(
        self, session: AsyncSession, ctx: OrgContext, return_id: UUID, requests: list[CompletionRequest], expected: int
    ) -> Return:
        """RET-010..013: credit note, restock and nothing else - the order itself is untouched."""
        partners.require(ctx, "returns.complete", "COMPANY")
        _unique_lines(requests)
        async with session.begin_nested():
            record = await self._locked(session, ctx, return_id, expected)
            target = domain.ensure_return_transition(record.status, "complete")
            partner = await finance.party(session, record.partnership_id)
            lines, items, order = await self._completion_lines(session, record, requests)
            credit = domain.completion_credit(lines, order.subtotal or ZERO, order.discount)
            for line, amount in zip(lines, [amount for _, amount in credit.lines], strict=True):
                item = items[line.return_item_id]
                item.accepted_quantity = line.accepted_quantity
                item.restock_quantity = line.restock_quantity
                item.line_credit = amount
            note_id: UUID | None = None
            if credit.total_credit > ZERO:
                # RET-011: the credit note, its ledger entry and the FIFO allocation all happen
                # inside this transaction, so a failure here leaves the return uncompleted.
                note = await finance.finance_service.create_credit_note(
                    session,
                    finance.SystemActor("RETURN"),
                    partner.id,
                    credit.total_credit,
                    record.id,
                    ctx.user.id,
                )
                note_id = note.id
            # RET-012: only the restock part reaches the warehouse; the rest was damaged.
            if credit.restock:
                order_items = {
                    item.id: item
                    for item in await session.scalars(select(OrderItem).where(OrderItem.order_id == order.id))
                }
                stock_lines = [
                    (
                        order_items[items[return_item_id].order_item_id].product_id,
                        domain.restock_base_quantity(
                            items[return_item_id].restock_quantity or ZERO_QUANTITY,
                            order_items[items[return_item_id].order_item_id].unit_coefficient_snapshot,
                        ),
                    )
                    for return_item_id, _ in credit.restock
                ]
                await inventory.stock_service.return_in(
                    session,
                    partner.company_id,
                    stock_lines,
                    inventory.SourceRef(partner.company_id, record.id, "RETURN"),
                    ctx.user.id,
                )
            from_status = record.status
            # The trigger freezes a completed return, so its final state is written at once.
            record.status = target
            record.total_credit = credit.total_credit
            record.credit_note_id = note_id
            record.completed_by, record.completed_at = ctx.user.id, utcnow()
            record.version += 1
            await self._history(session, record, from_status, target, ctx.user.id)
            await self._logged(
                session,
                partner,
                "return.completed",
                "returns",
                record.id,
                ctx.user.id,
                "RETURN_COMPLETED",
                recipient=partner.store_id,
            )
            return record

    async def create_from_dispute(
        self,
        session: AsyncSession,
        dispute: Dispute,
        partner: Partnership,
        actor_id: UUID,
        lines: list[RequestLine],
    ) -> Return:
        """DSP-022: an approved return from a dispute resolution.

        RET-003 still applies, RET-002 deliberately does not: the dispute was opened while
        the window was open, and resolving it must not be blocked by the clock.
        """
        _unique_lines(lines)
        if dispute.order_id is None:
            raise AppError("validation_error", 422, {"field": "target_type"})
        if await self.has_open(session, dispute.order_id):
            raise AppError("invalid_transition", 409, {"reason": "return_already_open"})
        accepted = await self._accepted_by_item(session, dispute.order_id)
        order_items = {
            item.id: item
            for item in await session.scalars(select(OrderItem).where(OrderItem.order_id == dispute.order_id))
        }
        now = utcnow()
        record = Return(
            return_number=await self._number(session, partner.company_id, now),
            company_id=partner.company_id,
            store_id=partner.store_id,
            partnership_id=partner.id,
            order_id=dispute.order_id,
            status="APPROVED",
            reason_code="QUALITY" if dispute.type == "QUANTITY" else "DAMAGED",
            source="DISPUTE",
            dispute_id=dispute.id,
            requested_by=dispute.opened_by,
            requested_at=now,
            approved_by=actor_id,
            approved_at=now,
        )
        session.add(record)
        await session.flush()
        for line in lines:
            item = order_items.get(line.order_item_id)
            if item is None:
                raise AppError("not_found", 404, {"field": "order_item_id"})
            orders.check_quantity(line.quantity, item.allow_fraction_snapshot, positive=True)
            confirmed = item.confirmed_quantity if item.confirmed_quantity is not None else item.requested_quantity
            quantity = domain.ensure_return_quantity(line.quantity, confirmed, accepted.get(item.id, ZERO_QUANTITY))
            session.add(
                ReturnItem(
                    return_id=record.id,
                    order_item_id=item.id,
                    requested_quantity=quantity,
                    approved_quantity=quantity,
                )
            )
        await session.flush()
        await self._history(session, record, None, "APPROVED", None, f"Dispute {dispute.dispute_number}")
        await self._logged(session, partner, "return.approved", "returns", record.id, actor_id, "RETURN_APPROVED")
        return record


return_service = ReturnService()


class DisputeService:
    """DSP-001..024. A dispute is a conversation with an outcome, never a ledger entry."""

    async def has_open(self, session: AsyncSession, order_id: UUID) -> bool:
        """DSP-004: the real port behind the order completion job and T17."""
        return bool(
            await session.scalar(
                select(Dispute.id)
                .where(Dispute.order_id == order_id, Dispute.status.in_(sorted(domain.OPEN_DISPUTE_STATUSES)))
                .limit(1)
            )
        )

    async def _number(self, session: AsyncSession, company_id: UUID, now: datetime) -> str:
        number = await SequenceService(session).next("dispute_number", f"{company_id}:{now.year}")
        if number > 999999:
            raise AppError("validation_error", 409, {"reason": "dispute_number_exhausted"})
        return f"DSP-{now.year}-{number:06}"

    async def _locked(self, session: AsyncSession, ctx: OrgContext, dispute_id: UUID, expected: int | None) -> Dispute:
        column = Dispute.company_id if ctx.organization.type == "COMPANY" else Dispute.store_id
        record = await session.scalar(select(Dispute).where(Dispute.id == dispute_id, column == ctx.organization.id))
        if record is None:
            raise AppError("not_found", 404)
        await _lock_party(session, ctx, record.partnership_id)
        await session.refresh(record, with_for_update=True)
        if expected is not None:
            _version(record, expected)
        return record

    async def open(
        self,
        session: AsyncSession,
        ctx: OrgContext,
        target_type: str,
        type: str,
        description: str,
        order_id: UUID | None = None,
        payment_id: UUID | None = None,
        file_ids: list[UUID] | None = None,
    ) -> Dispute:
        """DSP-001..004: the store opens a dispute about one delivered order or one payment."""
        partners.require(ctx, "disputes.open", "STORE")
        files = file_ids or []
        if target_type not in {"ORDER", "PAYMENT"} or type not in DISPUTE_TYPES:
            raise AppError("validation_error", 422, {"field": "type"})
        if len(description.strip()) < 10 or len(files) > MAX_FILES or len(set(files)) != len(files):
            raise AppError("validation_error", 422, {"field": "description"})
        now = utcnow()
        if target_type == "ORDER":
            if order_id is None or payment_id is not None:
                raise AppError("validation_error", 422, {"field": "order_id"})
            order, _ = await return_service._order(session, ctx, order_id)
            partner = await _lock_party(session, ctx, order.partnership_id)
            # Checked before the order status: opening the first dispute already moved the order
            # to DISPUTED, so this is what a second attempt is really blocked by (DSP-003).
            if await self.has_open(session, order.id):
                raise AppError("dispute_already_open", 409)
            domain.ensure_disputable_order(order.status)
            if order.delivered_at is None:
                raise AppError("invalid_transition", 409, {"reason": "order_not_delivered"})
            domain.ensure_dispute_window(
                order.delivered_at, int((order.terms_snapshot or {}).get("dispute_window_hours", 48)), now
            )
        else:
            if payment_id is None or order_id is not None:
                raise AppError("validation_error", 422, {"field": "payment_id"})
            payment = await session.get(Payment, payment_id)
            if payment is None:
                raise AppError("not_found", 404)
            partner = await _lock_party(session, ctx, payment.partnership_id)
            # DSP-002: any payment status, for 30 days, and the payment itself is left alone.
            domain.ensure_payment_dispute_window(payment.created_at, now)
        record = Dispute(
            dispute_number=await self._number(session, partner.company_id, now),
            company_id=partner.company_id,
            store_id=partner.store_id,
            partnership_id=partner.id,
            target_type=target_type,
            order_id=order_id,
            payment_id=payment_id,
            type=type,
            description=description.strip(),
            status="OPEN",
            opened_by=ctx.user.id,
        )
        session.add(record)
        try:
            await session.flush()
        except IntegrityError as error:
            # DSP-003 race backstop: the partial unique index decides.
            raise AppError("dispute_already_open", 409) from error
        for file_id in files:
            await _attachment(session, ctx, file_id)
            # Each attachment is its own chat entry carrying the opening statement, so the
            # company sees what the photo is meant to show (DSP-010, VER-002 file rules).
            session.add(
                DisputeMessage(
                    dispute_id=record.id,
                    author_id=ctx.user.id,
                    author_side="STORE",
                    body=description.strip(),
                    file_id=file_id,
                )
            )
        if target_type == "ORDER" and order_id is not None:
            # T15: the order itself records that it is disputed.
            await orders.order_service.mark_disputed(session, orders.SystemActor("DISPUTE"), order_id)
        await return_service._logged(
            session, partner, "dispute.opened", "disputes", record.id, ctx.user.id, "DISPUTE_OPENED"
        )
        return record

    async def start_review(self, session: AsyncSession, ctx: OrgContext, dispute_id: UUID) -> Dispute:
        partners.require(ctx, "disputes.review", "COMPANY")
        record = await self._locked(session, ctx, dispute_id, None)
        target = domain.ensure_dispute_transition(record.status, "start_review")
        partner = await finance.party(session, record.partnership_id)
        record.status = target
        record.version += 1
        await return_service._logged(session, partner, "dispute.review_started", "disputes", record.id, ctx.user.id)
        return record

    async def message(
        self, session: AsyncSession, ctx: OrgContext, dispute_id: UUID, body: str, file_id: UUID | None = None
    ) -> DisputeMessage:
        """DSP-010: both sides write, and a message is never edited or deleted."""
        partners.require(ctx, "disputes.message")
        text = body.strip()
        if not text or len(text) > 2000:
            raise AppError("validation_error", 422, {"field": "body"})
        record = await self._locked(session, ctx, dispute_id, None)
        if record.status not in domain.OPEN_DISPUTE_STATUSES:
            raise AppError("invalid_transition", 409, {"status": record.status})
        if file_id is not None:
            await _attachment(session, ctx, file_id)
        partner = await finance.party(session, record.partnership_id)
        message = DisputeMessage(
            dispute_id=record.id,
            author_id=ctx.user.id,
            author_side=ctx.organization.type,
            body=text,
            file_id=file_id,
        )
        session.add(message)
        await return_service._logged(
            session,
            partner,
            "dispute.message_added",
            "dispute_messages",
            record.id,
            ctx.user.id,
            "DISPUTE_MESSAGE",
            recipient=partner.store_id if ctx.organization.type == "COMPANY" else partner.company_id,
        )
        return message

    async def _close_order(self, session: AsyncSession, record: Dispute) -> None:
        """T17: a disputed order is completed once nothing is open against it."""
        if record.order_id is not None:
            await session.flush()
            await orders.order_service.complete(session, orders.SystemActor("DISPUTE"), record.order_id)

    async def resolve(
        self,
        session: AsyncSession,
        ctx: OrgContext,
        dispute_id: UUID,
        resolution_type: str,
        resolution_note: str,
        expected: int,
        amount: Decimal | None = None,
        return_items: list[RequestLine] | None = None,
    ) -> Dispute:
        """DSP-020..022: no action, a finance adjustment, or a return - never a direct ledger write."""
        partners.require(ctx, "disputes.resolve", "COMPANY")
        if resolution_type not in RESOLUTION_TYPES:
            raise AppError("validation_error", 422, {"field": "resolution_type"})
        note = resolution_note.strip()
        if len(note) < 10:
            raise AppError("validation_error", 422, {"field": "resolution_note"})
        async with session.begin_nested():
            record = await self._locked(session, ctx, dispute_id, expected)
            domain.ensure_dispute_transition(record.status, "resolve")
            partner = await finance.party(session, record.partnership_id)
            record.resolution_type, record.resolution_note = resolution_type, note
            record.version += 1
            if resolution_type == "ADJUSTMENT_CREDIT":
                return await self._resolve_with_adjustment(session, ctx, record, partner, note, amount)
            if resolution_type == "CONVERTED_TO_RETURN":
                created = await return_service.create_from_dispute(
                    session, record, partner, ctx.user.id, return_items or []
                )
                record.return_id = created.id
            record.status = "RESOLVED"
            record.resolved_by, record.resolved_at = ctx.user.id, utcnow()
            await self._close_order(session, record)
            await return_service._logged(
                session,
                partner,
                "dispute.resolved",
                "disputes",
                record.id,
                ctx.user.id,
                "DISPUTE_RESOLVED",
                note,
                recipient=partner.store_id,
            )
            return record

    async def _resolve_with_adjustment(
        self,
        session: AsyncSession,
        ctx: OrgContext,
        record: Dispute,
        partner: Partnership,
        note: str,
        amount: Decimal | None,
    ) -> Dispute:
        """DSP-021: an owner resolves at once; a manager leaves it waiting for owner approval."""
        if amount is None or record.order_id is None:
            raise AppError("validation_error", 422, {"field": "amount"})
        order = await session.get(Order, record.order_id)
        if order is None or order.total is None:
            raise AppError("invalid_transition", 409, {"reason": "order_not_confirmed"})
        value = domain.ensure_dispute_adjustment(amount, order.total)
        adjustment = await finance.finance_service.create_adjustment(
            session,
            ctx,
            partner.id,
            "CREDIT",
            value,
            f"Dispute {record.dispute_number}: {note}",
            "DISPUTE",
            record.id,
        )
        if adjustment.status == "APPROVED":
            record.adjustment_id = adjustment.id
            record.status = "RESOLVED"
            record.resolved_by, record.resolved_at = ctx.user.id, utcnow()
            await self._close_order(session, record)
            await return_service._logged(
                session,
                partner,
                "dispute.resolved",
                "disputes",
                record.id,
                ctx.user.id,
                "DISPUTE_RESOLVED",
                note,
                recipient=partner.store_id,
            )
            return record
        # A manager's credit waits: the dispute stays under review with the pending adjustment.
        record.status = "UNDER_REVIEW"
        record.pending_adjustment_id = adjustment.id
        await return_service._logged(
            session, partner, "dispute.adjustment_proposed", "disputes", record.id, ctx.user.id, None, note
        )
        return record

    async def reject(
        self, session: AsyncSession, ctx: OrgContext, dispute_id: UUID, resolution_note: str, expected: int
    ) -> Dispute:
        partners.require(ctx, "disputes.resolve", "COMPANY")
        note = resolution_note.strip()
        if len(note) < 10:
            raise AppError("validation_error", 422, {"field": "resolution_note"})
        record = await self._locked(session, ctx, dispute_id, expected)
        target = domain.ensure_dispute_transition(record.status, "reject")
        partner = await finance.party(session, record.partnership_id)
        record.status, record.resolution_note = target, note
        record.resolved_by, record.resolved_at = ctx.user.id, utcnow()
        record.version += 1
        await self._close_order(session, record)
        await return_service._logged(
            session,
            partner,
            "dispute.rejected",
            "disputes",
            record.id,
            ctx.user.id,
            "DISPUTE_REJECTED",
            note,
            recipient=partner.store_id,
        )
        return record

    async def withdraw(self, session: AsyncSession, ctx: OrgContext, dispute_id: UUID, expected: int) -> Dispute:
        partners.require(ctx, "disputes.withdraw", "STORE")
        record = await self._locked(session, ctx, dispute_id, expected)
        target = domain.ensure_dispute_transition(record.status, "withdraw")
        partner = await finance.party(session, record.partnership_id)
        record.status = target
        record.resolved_by, record.resolved_at = ctx.user.id, utcnow()
        record.version += 1
        await self._close_order(session, record)
        await return_service._logged(session, partner, "dispute.withdrawn", "disputes", record.id, ctx.user.id)
        return record

    async def adjustment_decided(self, session: AsyncSession, event: DomainEvent) -> None:
        """DSP-021: the owner's decision on a manager's dispute credit finishes the dispute."""
        adjustment_id = UUID(event.payload["id"])
        record = await session.scalar(
            select(Dispute).where(Dispute.pending_adjustment_id == adjustment_id).with_for_update()
        )
        if record is None or record.status not in domain.OPEN_DISPUTE_STATUSES:
            return
        partner = await finance.party(session, record.partnership_id)
        if event.event_type == "ADJUSTMENT_APPROVED":
            record.pending_adjustment_id = None
            record.adjustment_id = adjustment_id
            record.status = "RESOLVED"
            record.resolved_at = utcnow()
            record.version += 1
            await self._close_order(session, record)
            await return_service._logged(
                session,
                partner,
                "dispute.resolved",
                "disputes",
                record.id,
                None,
                "DISPUTE_RESOLVED",
                recipient=partner.store_id,
            )
            return
        # Rejected: the dispute goes back to plain review and says so in the chat.
        record.pending_adjustment_id = None
        record.resolution_type = None
        record.version += 1
        session.add(
            DisputeMessage(
                dispute_id=record.id,
                author_side="SYSTEM",
                body=f"Adjustment {adjustment_id} was rejected by the owner.",
            )
        )
        await return_service._logged(session, partner, "dispute.adjustment_rejected", "disputes", record.id, None)


dispute_service = DisputeService()
