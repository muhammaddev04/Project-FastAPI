"""P10 persisted return and dispute workflows, including P07/P09 integration."""

from datetime import timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.events import DomainEvent
from app.core.outbox import OutboxEvent
from app.core.permissions import permissions_for
from app.modules.delivery.models import Delivery
from app.modules.finance.models import Adjustment, Allocation, CreditNote, LedgerEntry
from app.modules.finance.service import finance_service as finance
from app.modules.finance.service import party
from app.modules.identity.deps import OrgContext
from app.modules.identity.models import Membership
from app.modules.inventory.models import StockMovement
from app.modules.orders.models import Order, OrderItem
from app.modules.orders.service import SystemActor as OrderActor
from app.modules.orders.service import order_service
from app.modules.returns.models import Dispute, DisputeMessage, Return, ReturnItem
from app.modules.returns.service import CompletionRequest, RequestLine, StepLine
from app.modules.returns.service import dispute_service as disputes
from app.modules.returns.service import return_service as returns
from app.modules.subscriptions.models import Subscription
from tests.factories import add_member, auth, make_user
from tests.test_delivery import courier_for, dispatched
from tests.test_orders import confirm, create, setup


async def delivered(client: AsyncClient, session: AsyncSession):
    """A delivered order with its P09 charge, plus a company and a store context."""
    ctx, store, data, delivery, _ = await dispatched(client, session)
    result = await client.post(
        f"/api/v1/deliveries/{delivery.id}/manual-confirm",
        headers=auth(ctx.user, ctx.organization),
        json={"reason": "Known owner handover verified"},
    )
    assert result.status_code == 200, result.text
    order = await session.get(Order, UUID(data["id"]))
    assert order is not None and order.delivered_at is not None
    membership = (await session.scalars(select(Membership).where(Membership.organization_id == store.id))).one()
    store_ctx = OrgContext(ctx.user, membership, store)
    item = (await session.scalars(select(OrderItem).where(OrderItem.order_id == order.id))).one()
    return ctx, store_ctx, order, item


async def member(session: AsyncSession, ctx: OrgContext, role: str) -> OrgContext:
    user = await make_user(session)
    membership = await add_member(session, ctx.organization, user, role)
    await session.commit()
    return OrgContext(user, membership, ctx.organization)


async def requested(client: AsyncClient, session: AsyncSession, quantity: str = "2"):
    ctx, store_ctx, order, item = await delivered(client, session)
    record = await returns.request(
        session, store_ctx, order.id, "DAMAGED", None, [RequestLine(item.id, Decimal(quantity))]
    )
    await session.commit()
    return ctx, store_ctx, order, item, record


async def received(client: AsyncClient, session: AsyncSession, quantity: str = "2"):
    ctx, store_ctx, order, item, record = await requested(client, session, quantity)
    line = (await session.scalars(select(ReturnItem).where(ReturnItem.return_id == record.id))).one()
    await returns.approve(session, ctx, record.id, [StepLine(line.id, Decimal(quantity))], record.version)
    await session.commit()
    await returns.receive(session, ctx, record.id, [StepLine(line.id, Decimal(quantity))], record.version)
    await session.commit()
    return ctx, store_ctx, order, item, record, line


async def test_ret_001_order_status_and_window(client: AsyncClient, session: AsyncSession, monkeypatch):
    ctx, store_ctx, order, item = await delivered(client, session)
    # RET-002: one second past the frozen return_days closes the window.
    assert order.terms_snapshot is not None
    days = int(order.terms_snapshot["return_days"])
    monkeypatch.setattr(
        "app.modules.returns.service.utcnow", lambda: order.delivered_at + timedelta(days=days, seconds=1)
    )
    with pytest.raises(AppError) as error:
        await returns.request(session, store_ctx, order.id, "DAMAGED", None, [RequestLine(item.id, Decimal("1"))])
    assert error.value.code == "return_window_closed"
    await session.rollback()


async def test_ret_002_zero_return_days_forbids_a_return(client: AsyncClient, session: AsyncSession, monkeypatch):
    ctx, store_ctx, order, item = await delivered(client, session)
    monkeypatch.setattr("app.modules.returns.service.ReturnService._window", lambda self, order: 0)
    with pytest.raises(AppError) as error:
        await returns.request(session, store_ctx, order.id, "DAMAGED", None, [RequestLine(item.id, Decimal("1"))])
    assert error.value.code == "return_window_closed"


async def test_ret_003_quantity_exceeds_considers_previous_returns(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item, record, line = await received(client, session, "2")
    await returns.complete(
        session, ctx, record.id, [CompletionRequest(line.id, Decimal("2"), Decimal("2"))], record.version
    )
    await session.commit()
    lines = await returns.returnable(session, store_ctx, order.id)
    assert lines[0].returned_quantity == Decimal("2.000")
    assert lines[0].max_returnable == Decimal("3.000")
    with pytest.raises(AppError) as error:
        await returns.request(session, store_ctx, order.id, "QUALITY", None, [RequestLine(item.id, Decimal("4"))])
    assert error.value.code == "return_quantity_exceeds"
    assert error.value.details["max_returnable"] == "3.000"


async def test_ret_004_one_open_return_per_order(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item, record = await requested(client, session)
    with pytest.raises(AppError) as error:
        await returns.request(session, store_ctx, order.id, "QUALITY", None, [RequestLine(item.id, Decimal("1"))])
    assert error.value.http_status == 409 and error.value.details["reason"] == "return_already_open"


async def test_return_state_machine_rejects_out_of_order_steps(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item, record = await requested(client, session)
    line = (await session.scalars(select(ReturnItem).where(ReturnItem.return_id == record.id))).one()
    expected, line_id, record_id = record.version, line.id, record.id
    with pytest.raises(AppError) as error:
        await returns.receive(session, ctx, record_id, [StepLine(line_id, Decimal("2"))], expected)
    assert error.value.code == "invalid_transition"
    # The refused transition left the transaction usable, so no rollback is needed here.
    # Approving every line as zero is a rejection and must be recorded as one.
    with pytest.raises(AppError) as error:
        await returns.approve(session, ctx, record_id, [StepLine(line_id, Decimal("0"))], expected)
    assert error.value.details["reason"] == "reject_instead"


async def test_ret_010_011_credit_note_ledger_and_fifo(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item, record, line = await received(client, session, "2")
    charge_balance = await finance.balance(session, order.partnership_id)
    assert charge_balance.balance == order.total
    await session.commit()
    preview = await returns.completion_preview(
        session, ctx, record.id, [CompletionRequest(line.id, Decimal("2"), Decimal("2"))]
    )
    completed = await returns.complete(
        session, ctx, record.id, [CompletionRequest(line.id, Decimal("2"), Decimal("2"))], record.version
    )
    await session.commit()
    # RET-010: two of five units at 10.00, with no order discount and no delivery fee refund.
    assert preview.total_credit == completed.total_credit == Decimal("20.00")
    assert completed.status == "COMPLETED" and completed.credit_note_id is not None
    note = (await session.scalars(select(CreditNote).where(CreditNote.source_id == record.id))).one()
    assert note.amount == Decimal("20.00")
    entry = (await session.scalars(select(LedgerEntry).where(LedgerEntry.entry_type == "CREDIT_NOTE"))).one()
    assert entry.direction == "CREDIT" and entry.amount == Decimal("20.00")
    # RET-011: FIFO put the credit straight against the delivery charge.
    allocated = await session.scalar(select(func.coalesce(func.sum(Allocation.amount), 0)))
    assert allocated == Decimal("20.00")
    summary = await finance.balance(session, order.partnership_id)
    assert summary.balance == (order.total or Decimal("0")) - Decimal("20.00")


async def delivered_with_discount(client: AsyncClient, session: AsyncSession, discount: str = "5.00"):
    """The same delivered order, but confirmed with an order-level discount (RET-010)."""
    ctx, store, pid, data, uid = await setup(client, session)
    order = await create(client, ctx, pid, uid, "5")
    order = await confirm(client, ctx, order, "5", discount=discount, discount_reason="Autumn promotion")
    headers = auth(ctx.user, ctx.organization)
    for endpoint in ("start-assembling", "mark-ready"):
        result = await client.post(
            f"/api/v1/orders/{order['id']}/{endpoint}", headers=headers, json={"version": order["version"]}
        )
        assert result.status_code == 200, result.text
        order = result.json()
    delivery = (await session.scalars(select(Delivery).where(Delivery.order_id == UUID(order["id"])))).one()
    courier = await courier_for(session, ctx.organization)
    await client.post(
        f"/api/v1/deliveries/{delivery.id}/assign",
        headers=headers,
        json={"courier_id": str(courier.id), "version": delivery.version},
    )
    await client.post(f"/api/v1/courier/deliveries/{delivery.id}/dispatch", headers=auth(courier, ctx.organization))
    await session.refresh(delivery)
    result = await client.post(
        f"/api/v1/deliveries/{delivery.id}/manual-confirm",
        headers=headers,
        json={"reason": "Known owner handover verified"},
    )
    assert result.status_code == 200, result.text
    stored = await session.get(Order, UUID(order["id"]))
    assert stored is not None
    membership = (await session.scalars(select(Membership).where(Membership.organization_id == store.id))).one()
    item = (await session.scalars(select(OrderItem).where(OrderItem.order_id == stored.id))).one()
    return ctx, OrgContext(ctx.user, membership, store), stored, item


async def test_ret_010_credit_shares_the_order_discount_and_never_the_delivery_fee(
    client: AsyncClient, session: AsyncSession
):
    ctx, store_ctx, order, item = await delivered_with_discount(client, session)
    assert order.subtotal == Decimal("50.00") and order.discount == Decimal("5.00")
    record = await returns.request(session, store_ctx, order.id, "DAMAGED", None, [RequestLine(item.id, Decimal("2"))])
    await session.commit()
    line = (await session.scalars(select(ReturnItem).where(ReturnItem.return_id == record.id))).one()
    await returns.approve(session, ctx, record.id, [StepLine(line.id, Decimal("2"))], record.version)
    await session.commit()
    await returns.receive(session, ctx, record.id, [StepLine(line.id, Decimal("2"))], record.version)
    await session.commit()
    preview = await returns.completion_preview(
        session, ctx, record.id, [CompletionRequest(line.id, Decimal("2"), Decimal("0"))]
    )
    # Goods 50.00 with a 5.00 discount -> factor 0.9; two units of 10.00 credit 18.00, not 20.00,
    # and the delivery fee is no part of the calculation at all.
    assert preview.total_credit == Decimal("18.00")
    completed = await returns.complete(
        session, ctx, record.id, [CompletionRequest(line.id, Decimal("2"), Decimal("0"))], record.version
    )
    assert completed.total_credit == Decimal("18.00")


async def test_ret_012_restock_movement_base_units_and_damaged_not_restocked(
    client: AsyncClient, session: AsyncSession
):
    ctx, store_ctx, order, item, record, line = await received(client, session, "2")
    await returns.complete(
        session, ctx, record.id, [CompletionRequest(line.id, Decimal("2"), Decimal("1"))], record.version
    )
    await session.commit()
    movements = list(await session.scalars(select(StockMovement).where(StockMovement.type == "RETURN_IN")))
    assert len(movements) == 1
    # One unit restocked, converted with the order's own coefficient; the other was damaged.
    assert movements[0].quantity_delta == item.unit_coefficient_snapshot * 1
    assert movements[0].source_type == "RETURN"
    stored = (await session.scalars(select(ReturnItem).where(ReturnItem.id == line.id))).one()
    assert stored.accepted_quantity == Decimal("2.000") and stored.restock_quantity == Decimal("1.000")


async def test_ret_013_return_does_not_change_the_order(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item, record, line = await received(client, session, "2")
    before = order.status
    await returns.complete(
        session, ctx, record.id, [CompletionRequest(line.id, Decimal("2"), Decimal("0"))], record.version
    )
    await session.commit()
    refreshed = await session.get(Order, order.id)
    assert refreshed is not None and refreshed.status == before


async def test_dsp_004_open_dispute_blocks_order_completion(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    dispute = await disputes.open(
        session, store_ctx, "ORDER", "QUANTITY", "Two boxes were missing on arrival", order.id
    )
    await session.commit()
    order_id, dispute_id = order.id, dispute.id
    refreshed = await session.get(Order, order_id)
    assert refreshed is not None and refreshed.status == "DISPUTED"
    # T17 refuses while the dispute is open, which is what the completion job relies on.
    with pytest.raises(AppError) as error:
        await order_service.complete(session, OrderActor("COMPLETION"), order_id)
    assert error.value.code == "invalid_transition"
    await session.rollback()
    assert await disputes.has_open(session, order_id) is True
    stored = await session.get(Dispute, dispute_id)
    assert stored is not None and stored.status == "OPEN"


async def test_dsp_020_dispute_does_not_touch_the_ledger(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    before = await session.scalar(select(func.count()).select_from(LedgerEntry))
    dispute = await disputes.open(
        session, store_ctx, "ORDER", "PRICE", "The unit price is not the agreed one", order.id
    )
    await session.commit()
    await disputes.start_review(session, ctx, dispute.id)
    await disputes.message(session, ctx, dispute.id, "We are checking the price list")
    await session.commit()
    assert await session.scalar(select(func.count()).select_from(LedgerEntry)) == before


async def test_dispute_resolution_completes_order(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    dispute = await disputes.open(session, store_ctx, "ORDER", "DELIVERY", "The courier arrived a day late", order.id)
    await session.commit()
    resolved = await disputes.resolve(
        session, ctx, dispute.id, "NO_ACTION", "Checked with the courier, delivery was on time", dispute.version
    )
    await session.commit()
    assert resolved.status == "RESOLVED" and resolved.resolved_at is not None
    refreshed = await session.get(Order, order.id)
    assert refreshed is not None and refreshed.status == "COMPLETED"


async def test_dsp_021_owner_adjustment_resolves_immediately(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    dispute = await disputes.open(session, store_ctx, "ORDER", "DAMAGED", "Half of the delivery is unusable", order.id)
    await session.commit()
    resolved = await disputes.resolve(
        session,
        ctx,
        dispute.id,
        "ADJUSTMENT_CREDIT",
        "Agreed to credit half of the order",
        dispute.version,
        amount=Decimal("25.00"),
    )
    await session.commit()
    assert resolved.status == "RESOLVED" and resolved.adjustment_id is not None
    adjustment = (await session.scalars(select(Adjustment).where(Adjustment.source_id == dispute.id))).one()
    assert adjustment.status == "APPROVED" and adjustment.type == "CREDIT"
    entry = (await session.scalars(select(LedgerEntry).where(LedgerEntry.entry_type == "ADJUSTMENT_CREDIT"))).one()
    assert entry.amount == Decimal("25.00")
    refreshed = await session.get(Order, order.id)
    assert refreshed is not None and refreshed.status == "COMPLETED"


async def test_dsp_021_amount_cannot_exceed_the_order(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    dispute = await disputes.open(session, store_ctx, "ORDER", "PRICE", "The total is higher than agreed", order.id)
    await session.commit()
    with pytest.raises(AppError) as error:
        await disputes.resolve(
            session,
            ctx,
            dispute.id,
            "ADJUSTMENT_CREDIT",
            "Crediting more than the order was worth",
            dispute.version,
            amount=(order.total or Decimal("0")) + Decimal("0.01"),
        )
    assert error.value.http_status == 422


async def test_dsp_021_manager_pending_then_approved_resolves(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    dispute = await disputes.open(session, store_ctx, "ORDER", "DAMAGED", "Several packs arrived crushed", order.id)
    await session.commit()
    manager = await member(session, ctx, "MANAGER")
    pending = await disputes.resolve(
        session,
        manager,
        dispute.id,
        "ADJUSTMENT_CREDIT",
        "Proposing a credit for the crushed packs",
        dispute.version,
        amount=Decimal("10.00"),
    )
    await session.commit()
    # The dispute waits for the owner instead of resolving itself.
    assert pending.status == "UNDER_REVIEW" and pending.pending_adjustment_id is not None
    assert pending.adjustment_id is None
    adjustment = (await session.scalars(select(Adjustment).where(Adjustment.source_id == dispute.id))).one()
    assert adjustment.status == "PENDING_APPROVAL"
    await finance.approve_adjustment(session, ctx, adjustment.id, adjustment.version)
    await session.commit()
    refreshed = await session.get(Dispute, dispute.id)
    assert refreshed is not None and refreshed.status == "RESOLVED"
    assert refreshed.adjustment_id == adjustment.id and refreshed.pending_adjustment_id is None
    order_row = await session.get(Order, order.id)
    assert order_row is not None and order_row.status == "COMPLETED"


async def test_dsp_021_rejected_adjustment_returns_the_dispute_to_review(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    dispute = await disputes.open(session, store_ctx, "ORDER", "OTHER", "The paperwork does not match", order.id)
    await session.commit()
    manager = await member(session, ctx, "MANAGER")
    await disputes.resolve(
        session,
        manager,
        dispute.id,
        "ADJUSTMENT_CREDIT",
        "Proposing a goodwill credit for the paperwork",
        dispute.version,
        amount=Decimal("5.00"),
    )
    await session.commit()
    adjustment = (await session.scalars(select(Adjustment).where(Adjustment.source_id == dispute.id))).one()
    await finance.reject_adjustment(session, ctx, adjustment.id, "No credit for paperwork", adjustment.version)
    await session.commit()
    refreshed = await session.get(Dispute, dispute.id)
    assert refreshed is not None and refreshed.status == "UNDER_REVIEW"
    assert refreshed.pending_adjustment_id is None and refreshed.resolution_type is None
    # The chat says what happened, with no user behind the message.
    message = (await session.scalars(select(DisputeMessage).where(DisputeMessage.author_side == "SYSTEM"))).one()
    assert str(adjustment.id) in message.body and message.author_id is None
    order_row = await session.get(Order, order.id)
    assert order_row is not None and order_row.status == "DISPUTED"


async def test_dsp_022_convert_to_return_bypasses_the_return_window(
    client: AsyncClient, session: AsyncSession, monkeypatch
):
    ctx, store_ctx, order, item = await delivered(client, session)
    dispute = await disputes.open(session, store_ctx, "ORDER", "DAMAGED", "The goods cannot be sold", order.id)
    await session.commit()
    assert order.terms_snapshot is not None
    # Long after the return window closed, but the dispute was opened inside it.
    late = order.delivered_at + timedelta(days=int(order.terms_snapshot["return_days"]) + 5)
    monkeypatch.setattr("app.modules.returns.service.utcnow", lambda: late)
    resolved = await disputes.resolve(
        session,
        ctx,
        dispute.id,
        "CONVERTED_TO_RETURN",
        "Converting the dispute into a return of the damaged goods",
        dispute.version,
        return_items=[RequestLine(item.id, Decimal("2"))],
    )
    await session.commit()
    assert resolved.status == "RESOLVED" and resolved.return_id is not None
    created = await session.get(Return, resolved.return_id)
    assert created is not None and created.status == "APPROVED" and created.source == "DISPUTE"
    assert created.dispute_id == dispute.id
    line = (await session.scalars(select(ReturnItem).where(ReturnItem.return_id == created.id))).one()
    assert line.approved_quantity == Decimal("2.000")
    # RET-003 still applies to the converted return.
    with pytest.raises(AppError) as error:
        await returns.create_from_dispute(
            session,
            dispute,
            await party(session, order.partnership_id),
            ctx.user.id,
            [RequestLine(item.id, Decimal("99"))],
        )
    assert error.value.http_status == 409


async def test_dsp_003_single_open_dispute_and_window(client: AsyncClient, session: AsyncSession, monkeypatch):
    ctx, store_ctx, order, item = await delivered(client, session)
    await disputes.open(session, store_ctx, "ORDER", "QUANTITY", "One pack was missing from the delivery", order.id)
    await session.commit()
    with pytest.raises(AppError) as error:
        await disputes.open(session, store_ctx, "ORDER", "PRICE", "And the price is wrong as well", order.id)
    assert error.value.code == "dispute_already_open"


async def test_dispute_withdrawn_by_the_store_closes_the_order(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    dispute = await disputes.open(session, store_ctx, "ORDER", "OTHER", "Opened by mistake, sorry", order.id)
    await session.commit()
    withdrawn = await disputes.withdraw(session, store_ctx, dispute.id, dispute.version)
    await session.commit()
    assert withdrawn.status == "WITHDRAWN"
    order_row = await session.get(Order, order.id)
    assert order_row is not None and order_row.status == "COMPLETED"
    # A withdrawal is audited but raises no domain event of its own.
    events = {row.event_type for row in await session.scalars(select(OutboxEvent))}
    assert "DISPUTE_OPENED" in events and not any(name.startswith("DISPUTE_WITH") for name in events)


async def test_permission_matrix_p10(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item, record = await requested(client, session)
    line = (await session.scalars(select(ReturnItem).where(ReturnItem.return_id == record.id))).one()
    expected = {
        ("COMPANY", "OPERATOR"): {"returns.view", "disputes.view", "disputes.message", "disputes.review"},
        ("COMPANY", "WAREHOUSE"): {"returns.view", "returns.receive"},
        ("COMPANY", "COURIER"): set(),
        ("STORE", "SELLER"): {"returns.view", "disputes.view"},
    }
    for (org_type, role), granted in expected.items():
        held = {name for name in permissions_for(org_type, role) if name.startswith(("returns.", "disputes."))}
        assert held == granted, (org_type, role)
    # An operator may read and discuss but not decide a return.
    operator = await member(session, ctx, "OPERATOR")
    with pytest.raises(AppError) as error:
        await returns.approve(session, operator, record.id, [StepLine(line.id, Decimal("2"))], record.version)
    assert error.value.code == "permission_denied"
    # A warehouse member receives goods without holding any partner permission.
    warehouse = await member(session, ctx, "WAREHOUSE")
    await returns.approve(session, ctx, record.id, [StepLine(line.id, Decimal("2"))], record.version)
    await session.commit()
    stored = await returns.receive(session, warehouse, record.id, [StepLine(line.id, Decimal("2"))], record.version)
    assert stored.status == "RECEIVED" and stored.received_by == warehouse.user.id
    # Only the store opens a dispute.
    with pytest.raises(AppError):
        await disputes.open(session, ctx, "ORDER", "QUANTITY", "A company cannot open a dispute", order.id)


async def test_dsp_002_payment_dispute_leaves_the_payment_alone(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    payment = await finance.record_payment(session, ctx, order.partnership_id, Decimal("10"), "CASH", confirm=True)
    await session.commit()
    dispute = await disputes.open(
        session, store_ctx, "PAYMENT", "PAYMENT", "This payment was counted twice", payment_id=payment.id
    )
    await session.commit()
    assert dispute.target_type == "PAYMENT" and dispute.order_id is None
    refreshed = await session.get(type(payment), payment.id)
    assert refreshed is not None and refreshed.status == "CONFIRMED"
    # The order is untouched: a payment dispute says nothing about delivery.
    order_row = await session.get(Order, order.id)
    assert order_row is not None and order_row.status == "DELIVERED"


async def test_adjustment_event_ignores_unrelated_adjustments(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    adjustment = await finance.create_adjustment(
        session, ctx, order.partnership_id, "CREDIT", Decimal("5"), "A manual goodwill credit"
    )
    await session.commit()
    # No dispute is waiting on it, so the handler does nothing at all.
    await disputes.adjustment_decided(session, DomainEvent("ADJUSTMENT_APPROVED", {"id": str(adjustment.id)}))
    assert await session.scalar(select(func.count()).select_from(Dispute)) == 0


async def test_ret_014_returns_work_without_a_live_subscription(client: AsyncClient, session: AsyncSession):
    """RET-014: RETURNS_DISPUTES is always allowed, even when the company stopped paying."""
    ctx, store_ctx, order, item, record, line = await received(client, session, "2")
    subscription = (
        await session.scalars(select(Subscription).where(Subscription.company_id == ctx.organization.id))
    ).one()
    subscription.status = "CANCELLED"
    await session.flush()
    completed = await returns.complete(
        session, ctx, record.id, [CompletionRequest(line.id, Decimal("2"), Decimal("0"))], record.version
    )
    assert completed.status == "COMPLETED" and completed.total_credit == Decimal("20.00")
