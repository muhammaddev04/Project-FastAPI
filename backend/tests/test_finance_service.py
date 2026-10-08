"""P09 persisted posting, approval, serialization and P07/P08 integration."""

import asyncio
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.db import get_sessionmaker
from app.core.errors import AppError
from app.core.events import DomainEvent, event_bus
from app.core.outbox import OutboxEvent
from app.core.permissions import permissions_for
from app.core.time import new_id
from app.modules.finance import ports
from app.modules.finance.models import (
    Adjustment,
    Allocation,
    Charge,
    Credit,
    CreditNote,
    LedgerEntry,
    PartnershipBalance,
    Payment,
    PaymentStatusHistory,
)
from app.modules.finance.service import SystemActor
from app.modules.finance.service import finance_service as finance
from app.modules.identity.deps import OrgContext
from app.modules.identity.models import Membership
from app.modules.inventory.models import Stock
from app.modules.orders.models import Order
from app.modules.orders.service import SystemActor as OrderActor
from app.modules.orders.service import order_service
from app.modules.partnerships.models import Partnership
from app.modules.partnerships.schemas import TermsIn
from app.modules.partnerships.service import terms_service
from app.modules.subscriptions.models import Subscription
from tests.factories import add_member, auth, make_user
from tests.test_delivery import dispatched
from tests.test_orders import confirmation, create, setup
from tests.test_partnerships import activated


async def prepared(client: AsyncClient, session: AsyncSession):
    owner, company, store, _, pid = await activated(client, session)
    membership = (await session.scalars(select(Membership).where(Membership.organization_id == company.id))).one()
    return OrgContext(owner, membership, company), store, UUID(pid)


async def member(session: AsyncSession, ctx: OrgContext, role: str) -> OrgContext:
    user = await make_user(session)
    membership = await add_member(session, ctx.organization, user, role)
    await session.commit()
    return OrgContext(user, membership, ctx.organization)


async def invariant(session: AsyncSession, pid: UUID, expected: Decimal):
    summary = await finance.balance(session, pid)
    ledger = list(
        await session.scalars(
            select(LedgerEntry)
            .where(LedgerEntry.partnership_id == pid)
            .order_by(LedgerEntry.created_at, LedgerEntry.id)
        )
    )
    running = Decimal("0")
    for entry in ledger:
        running += entry.amount if entry.direction == "DEBIT" else -entry.amount
        assert entry.balance_after == running
    assert summary.balance == running == expected == summary.outstanding - summary.unapplied
    for model, key in [(Charge, Allocation.charge_id), (Credit, Allocation.credit_id)]:
        for item in await session.scalars(select(model).where(model.partnership_id == pid)):
            allocated = await session.scalar(
                select(func.coalesce(func.sum(Allocation.amount), 0)).where(key == item.id)
            )
            assert item.allocated_amount == allocated
    return summary


async def test_fin_034_persisted_fifo_example(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    adjustments = [
        await finance.create_adjustment(session, ctx, pid, "DEBIT", Decimal(amount), "Fixture charge debt")
        for amount in ["1000", "700", "500"]
    ]
    preview = await finance.allocation_preview(session, pid, Decimal("1200"))
    assert [line.amount for line in preview] == [Decimal("1000"), Decimal("200")]
    assert await session.scalar(select(func.count()).select_from(Allocation)) == 0
    payment = await finance.record_payment(session, ctx, pid, Decimal("1200"), "CASH", confirm=True)
    assert payment.status == "CONFIRMED"
    await session.commit()
    charges = [(await session.scalars(select(Charge).where(Charge.source_id == a.id))).one() for a in adjustments]
    assert [(row.status, row.allocated_amount) for row in charges] == [
        ("PAID", Decimal("1000")),
        ("PARTIALLY_PAID", Decimal("200")),
        ("OPEN", Decimal("0")),
    ]
    assert charges[0].paid_at is not None and charges[1].paid_at is None
    assert [line.charge_id for line in preview] == [charges[0].id, charges[1].id]
    assert await session.scalar(select(func.count()).select_from(PaymentStatusHistory)) == 2
    await invariant(session, pid, Decimal("1000"))


async def test_fin_033_prepayment_applies_to_future_charge(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    payment = await finance.record_payment(session, ctx, pid, Decimal("1200"), "CASH", confirm=True)
    summary = await invariant(session, pid, Decimal("-1200"))
    assert summary.unapplied == 1200 and summary.outstanding == 0
    await finance.create_adjustment(session, ctx, pid, "DEBIT", Decimal("1000"), "New invoice correction")
    summary = await invariant(session, pid, Decimal("-200"))
    assert summary.unapplied == 200 and summary.outstanding == 0
    assert payment.status == "CONFIRMED"


@pytest.mark.parametrize("role", ["OWNER", "MANAGER", "OPERATOR", "COURIER", "WAREHOUSE"])
async def test_fin_040_adjustment_permissions_and_approval(client: AsyncClient, session: AsyncSession, role: str):
    owner, _, pid = await prepared(client, session)
    ctx = owner if role == "OWNER" else await member(session, owner, role)
    if role not in {"OWNER", "MANAGER"}:
        with pytest.raises(AppError, match="permission_denied"):
            await finance.create_adjustment(session, ctx, pid, "DEBIT", Decimal("50"), "Enough justification")
        return
    adjustment = await finance.create_adjustment(session, ctx, pid, "DEBIT", Decimal("50"), "Enough justification")
    if role == "MANAGER":
        assert adjustment.status == "PENDING_APPROVAL"
        await invariant(session, pid, Decimal("0"))
        with pytest.raises(AppError, match="permission_denied"):
            await finance.approve_adjustment(session, ctx, adjustment.id, adjustment.version)
        await finance.approve_adjustment(session, owner, adjustment.id, adjustment.version)
    assert adjustment.status == "APPROVED" and adjustment.self_approved == (role == "OWNER")
    await invariant(session, pid, Decimal("50"))


async def test_fin_042_043_credit_and_refund(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    await finance.create_adjustment(session, ctx, pid, "CREDIT", Decimal("300"), "Refundable prepayment")
    with pytest.raises(AppError, match="refund_exceeds_credit"):
        await finance.create_adjustment(session, ctx, pid, "REFUND", Decimal("301"), "Attempt excess refund")
    assert await session.scalar(select(func.count()).select_from(Adjustment)) == 1
    refund = await finance.create_adjustment(session, ctx, pid, "REFUND", Decimal("300"), "Return prepaid balance")
    charge = (await session.scalars(select(Charge).where(Charge.source_id == refund.id))).one()
    assert charge.kind == "REFUND" and charge.status == "PAID"
    summary = await invariant(session, pid, Decimal("0"))
    assert summary.unapplied == summary.outstanding == 0


async def test_fin_044_dispute_source_retains_owner_approval(client: AsyncClient, session: AsyncSession):
    """Exercise the P09 internal boundary without implementing P10 dispute workflows."""
    ctx, _, pid = await prepared(client, session)
    manager = await member(session, ctx, "MANAGER")
    source_id = new_id()
    adjustment = await finance.create_adjustment(
        session,
        manager,
        pid,
        "CREDIT",
        Decimal("20"),
        "Dispute boundary correction",
        source="DISPUTE",
        source_id=source_id,
    )
    assert adjustment.source == "DISPUTE" and adjustment.source_id == source_id
    assert adjustment.status == "PENDING_APPROVAL"
    await invariant(session, pid, Decimal("0"))
    with pytest.raises(AppError, match="permission_denied"):
        await finance.approve_adjustment(session, manager, adjustment.id, adjustment.version)
    await finance.approve_adjustment(session, ctx, adjustment.id, adjustment.version)
    await invariant(session, pid, Decimal("-20"))


async def test_refund_rechecks_available_credit_at_approval(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    manager = await member(session, ctx, "MANAGER")
    await finance.create_adjustment(session, ctx, pid, "CREDIT", Decimal("100"), "Prepaid account credit")
    refund = await finance.create_adjustment(session, manager, pid, "REFUND", Decimal("100"), "Return unused balance")
    await finance.create_adjustment(session, ctx, pid, "DEBIT", Decimal("80"), "New account charge now")
    with pytest.raises(AppError, match="refund_exceeds_credit"):
        await finance.approve_adjustment(session, ctx, refund.id, refund.version)
    await session.refresh(refund)
    assert refund.status == "PENDING_APPROVAL"
    await invariant(session, pid, Decimal("-20"))


async def test_fin_020_payment_validation(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    for amount, method, reference in [
        (Decimal("0"), "CASH", None),
        (Decimal("1.001"), "CASH", None),
        (Decimal("10000000.01"), "CASH", None),
        (Decimal("1"), "BANK_TRANSFER", None),
    ]:
        with pytest.raises(AppError, match="payment_amount_invalid" if amount != Decimal("1") else "validation_error"):
            await finance.record_payment(session, ctx, pid, amount, method, reference)
    assert await session.scalar(select(func.count()).select_from(Payment)) == 0


async def test_fin_022_pending_cancel_and_final_immutable(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    operator = await member(session, ctx, "OPERATOR")
    payment = await finance.record_payment(session, operator, pid, Decimal("50"), "CASH")
    assert payment.status == "PENDING"
    await invariant(session, pid, Decimal("0"))
    with pytest.raises(AppError, match="permission_denied"):
        await finance.confirm_payment(session, operator, payment.id, payment.version)
    with pytest.raises(AppError, match="permission_denied"):
        await finance.cancel_payment(session, ctx, payment.id, payment.version)
    await finance.cancel_payment(session, operator, payment.id, payment.version)
    assert payment.status == "CANCELLED"
    payment = await finance.record_payment(session, ctx, pid, Decimal("50"), "CASH", confirm=True)
    with pytest.raises(AppError, match="payment_not_pending"):
        await finance.cancel_payment(session, ctx, payment.id, payment.version)
    await invariant(session, pid, Decimal("-50"))


async def test_payment_rejection_and_stale_version(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    payment = await finance.record_payment(session, ctx, pid, Decimal("50"), "CASH")
    with pytest.raises(AppError, match="version_conflict"):
        await finance.confirm_payment(session, ctx, payment.id, payment.version + 1)
    await finance.reject_payment(session, ctx, payment.id, "No cash received", payment.version)
    assert payment.status == "REJECTED" and payment.rejected_reason == "No cash received"
    await invariant(session, pid, Decimal("0"))
    assert await session.scalar(select(func.count()).select_from(Credit)) == 0


async def test_payment_event_failure_rolls_back_all_effects(client: AsyncClient, session: AsyncSession, monkeypatch):
    ctx, _, pid = await prepared(client, session)

    async def fail(*args):
        raise AppError("validation_error", 422)

    monkeypatch.setitem(event_bus.handlers, "PAYMENT_CONFIRMED", [fail])
    with pytest.raises(AppError, match="validation_error"):
        await finance.record_payment(session, ctx, pid, Decimal("50"), "CASH", confirm=True)
    for model in [Payment, Credit, LedgerEntry, PaymentStatusHistory, Allocation]:
        assert await session.scalar(select(func.count()).select_from(model)) == 0
    assert not await session.scalar(select(AuditLog.id).where(AuditLog.action.like("payment.%")))
    assert not await session.scalar(select(OutboxEvent.id).where(OutboxEvent.event_type.like("PAYMENT_%")))
    await invariant(session, pid, Decimal("0"))


async def test_fin_003_concurrent_payments_preserve_running_balance(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    await finance.create_adjustment(session, ctx, pid, "DEBIT", Decimal("1000"), "Invoice before payments")
    await session.commit()

    async def pay(amount):
        async with get_sessionmaker()() as db, db.begin():
            await finance.record_payment(db, ctx, pid, amount, "CASH", confirm=True)

    await asyncio.wait_for(asyncio.gather(*(pay(Decimal(a)) for a in [100, 200, 300, 400])), timeout=30)
    await invariant(session, pid, Decimal("0"))
    assert await session.scalar(select(func.count()).select_from(Payment)) == 4


async def test_concurrent_first_credit_notes_and_replayed_source(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    source = new_id()
    await session.execute(delete(PartnershipBalance).where(PartnershipBalance.partnership_id == pid))
    await session.commit()

    async def credit():
        async with get_sessionmaker()() as db, db.begin():
            return (await finance.create_credit_note(db, SystemActor("RETURN"), pid, Decimal("50"), source)).id

    ids = await asyncio.wait_for(asyncio.gather(credit(), credit()), timeout=30)
    assert ids[0] == ids[1]
    await invariant(session, pid, Decimal("-50"))
    assert await session.scalar(select(func.count()).select_from(CreditNote)) == 1


async def test_fin_050_real_credit_port_blocks_order_and_counts_prepayment(client: AsyncClient, session: AsyncSession):
    ctx, _, pid, _, uid = await setup(client, session)
    await finance.create_adjustment(session, ctx, pid, "DEBIT", Decimal("80"), "Existing account invoice")
    await session.commit()
    order = await create(client, ctx, pid, uid)
    result = await client.post(
        f"/api/v1/orders/{order['id']}/confirm", headers=auth(ctx.user, ctx.organization), json=confirmation(order)
    )
    assert result.status_code == 409 and result.json()["error"]["code"] == "credit_limit_exceeded"
    assert result.json()["error"]["details"]["balance"] == "80.00"
    await finance.record_payment(session, ctx, pid, Decimal("100"), "CASH", confirm=True)
    await session.commit()
    credit = await finance.credit_check(session, pid, Decimal("50"))
    assert credit.allowed and credit.balance == -20 and credit.available == 120 and credit.unapplied == 20
    await session.commit()  # Release the finance read lock before another HTTP transaction.
    result = await client.post(
        f"/api/v1/orders/{order['id']}/confirm", headers=auth(ctx.user, ctx.organization), json=confirmation(order)
    )
    assert result.status_code == 200, result.text


async def test_fin_010_011_delivery_charge_is_atomic_and_replay_safe(client: AsyncClient, session: AsyncSession):
    ctx, _, data, delivery, _ = await dispatched(client, session)
    result = await client.post(
        f"/api/v1/deliveries/{delivery.id}/manual-confirm",
        headers=auth(ctx.user, ctx.organization),
        json={"reason": "Known owner handover verified"},
    )
    assert result.status_code == 200, result.text
    order = await session.get(Order, UUID(data["id"]))
    assert order is not None and order.delivered_at is not None
    charge = (await session.scalars(select(Charge).where(Charge.source_id == order.id))).one()
    assert charge.amount == order.total == 50
    from app.modules.finance.domain import order_due_date

    assert charge.due_date == order_due_date(order.delivered_at, 14)
    await ports.order_delivered(session, DomainEvent("ORDER_DELIVERED", {"order_id": str(order.id)}))
    assert await session.scalar(select(func.count()).select_from(Charge)) == 1
    assert await session.scalar(select(func.count()).select_from(LedgerEntry)) == 1
    await invariant(session, order.partnership_id, Decimal("50"))


async def test_fin_010_frozen_terms_and_dushanbe_boundary(client: AsyncClient, session: AsyncSession, monkeypatch):
    ctx, _, data, _, _ = await dispatched(client, session)
    order = await session.get(Order, UUID(data["id"]))
    assert order is not None and order.terms_snapshot is not None
    partner = await session.get(Partnership, order.partnership_id)
    assert partner is not None
    await terms_service.append(
        session,
        ctx,
        partner,
        TermsIn(
            price_list_id=UUID(order.terms_snapshot["price_list_id"]),
            credit_limit=Decimal("100"),
            credit_days=30,
            payment_methods=["CASH"],
        ),
    )
    delivered_at = datetime(2026, 10, 8, 21, 0, tzinfo=UTC)
    monkeypatch.setattr("app.modules.orders.service.utcnow", lambda: delivered_at + timedelta(hours=1))
    order = await order_service.deliver(session, OrderActor("DELIVERY"), UUID(data["id"]), delivered_at)
    charge = (await session.scalars(select(Charge).where(Charge.source_id == order.id))).one()
    assert charge.due_date == date(2026, 10, 23)


async def test_fin_010_zero_total_no_charge(client: AsyncClient, session: AsyncSession):
    ctx, _, pid, _, uid = await setup(client, session)
    data = await create(client, ctx, pid, uid)
    result = await client.post(
        f"/api/v1/orders/{data['id']}/confirm",
        headers=auth(ctx.user, ctx.organization),
        json=confirmation(data, discount="50", discount_reason="Full promotional discount"),
    )
    assert result.status_code == 200, result.text
    data = result.json()
    for endpoint in ["start-assembling", "mark-ready"]:
        result = await client.post(
            f"/api/v1/orders/{data['id']}/{endpoint}",
            headers=auth(ctx.user, ctx.organization),
            json={"version": data["version"]},
        )
        assert result.status_code == 200, result.text
        data = result.json()
    from app.core.time import utcnow

    await order_service.dispatch(session, OrderActor("DELIVERY"), UUID(data["id"]))
    await order_service.deliver(session, OrderActor("DELIVERY"), UUID(data["id"]), utcnow())
    assert await session.scalar(select(func.count()).select_from(Charge)) == 0
    assert await session.scalar(select(func.count()).select_from(LedgerEntry)) == 0
    await invariant(session, pid, Decimal("0"))


async def test_fin_020_bank_reference_with_current_allowed_method(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    partner = await session.get(Partnership, pid)
    terms = await terms_service.current(session, pid)
    assert partner is not None and terms is not None
    await terms_service.append(
        session,
        ctx,
        partner,
        TermsIn(price_list_id=terms.price_list_id, credit_limit=Decimal("100"), payment_methods=["BANK_TRANSFER"]),
    )
    for reference in [None, "", "  "]:
        with pytest.raises(AppError, match="validation_error"):
            await finance.record_payment(session, ctx, pid, Decimal("25"), "BANK_TRANSFER", reference)
    payment = await finance.record_payment(session, ctx, pid, Decimal("25"), "BANK_TRANSFER", "  BANK-123  ")
    assert payment.reference == "BANK-123"
    with pytest.raises(AppError, match="validation_error"):
        await finance.record_payment(session, ctx, pid, Decimal("25"), "CASH")


async def test_delivery_finance_failure_rolls_back_order_stock_and_delivery(
    client: AsyncClient, session: AsyncSession, monkeypatch
):
    ctx, _, data, delivery, _ = await dispatched(client, session)
    quantity = await session.scalar(select(Stock.quantity).where(Stock.company_id == ctx.organization.id))

    async def fail(*args):
        raise AppError("validation_error", 422)

    monkeypatch.setitem(event_bus.handlers, "CHARGE_CREATED", [fail])
    result = await client.post(
        f"/api/v1/deliveries/{delivery.id}/manual-confirm",
        headers=auth(ctx.user, ctx.organization),
        json={"reason": "Known owner handover verified"},
    )
    assert result.status_code == 422
    await session.refresh(delivery)
    order = await session.get(Order, UUID(data["id"]))
    assert order is not None and order.status == delivery.status == "IN_TRANSIT"
    assert await session.scalar(select(Stock.quantity).where(Stock.company_id == ctx.organization.id)) == quantity
    assert await session.scalar(select(func.count()).select_from(Charge)) == 0
    assert await session.scalar(select(func.count()).select_from(LedgerEntry)) == 0


async def test_fin_023_courier_cash_and_own_delivery(client: AsyncClient, session: AsyncSession):
    ctx, _, data, delivery, courier = await dispatched(client, session)
    membership = (await session.scalars(select(Membership).where(Membership.user_id == courier.id))).one()
    courier_ctx = OrgContext(courier, membership, ctx.organization)
    order = await session.get(Order, UUID(data["id"]))
    assert order is not None
    for method, delivery_id in [("CASH", None), ("BANK_TRANSFER", delivery.id)]:
        with pytest.raises(AppError, match="permission_denied"):
            await finance.record_payment(
                session, courier_ctx, order.partnership_id, Decimal("50"), method, delivery_id=delivery_id
            )
    payment = await finance.record_payment(
        session, courier_ctx, order.partnership_id, Decimal("50"), "CASH", delivery_id=delivery.id
    )
    assert payment.status == "PENDING" and payment.recorded_by == courier.id
    other = await member(session, ctx, "COURIER")
    with pytest.raises(AppError, match="not_found"):
        await finance.record_payment(
            session, other, order.partnership_id, Decimal("50"), "CASH", delivery_id=delivery.id
        )


@pytest.mark.parametrize("status", ["SUSPENDED", "TERMINATED"])
async def test_fin_020_collection_for_inactive_partnership(client: AsyncClient, session: AsyncSession, status: str):
    ctx, _, pid = await prepared(client, session)
    partner = await session.get(Partnership, pid)
    assert partner is not None
    partner.status = status
    await session.flush()
    payment = await finance.record_payment(session, ctx, pid, Decimal("10"), "CASH", confirm=True)
    assert payment.status == "CONFIRMED"


async def test_fin_024_payment_allowed_on_cancelled_subscription(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    subscription = (
        await session.scalars(select(Subscription).where(Subscription.company_id == ctx.organization.id))
    ).one()
    subscription.status = "CANCELLED"
    await session.flush()
    await finance.record_payment(session, ctx, pid, Decimal("10"), "CASH", confirm=True)
    await invariant(session, pid, Decimal("-10"))


async def test_wrong_partnership_payment_not_found(client: AsyncClient, session: AsyncSession):
    ctx, _, pid = await prepared(client, session)
    payment = await finance.record_payment(session, ctx, pid, Decimal("10"), "CASH")
    await session.commit()
    other, _, _ = await prepared(client, session)
    with pytest.raises(AppError, match="not_found"):
        await finance.confirm_payment(session, other, payment.id, payment.version)


@pytest.mark.parametrize(
    "side,role,expected",
    [
        (
            "COMPANY",
            "OWNER",
            {
                "finance.view",
                "payments.record",
                "payments.confirm",
                "payments.reject",
                "adjustments.create",
                "adjustments.approve",
            },
        ),
        (
            "COMPANY",
            "MANAGER",
            {"finance.view", "payments.record", "payments.confirm", "payments.reject", "adjustments.create"},
        ),
        ("COMPANY", "OPERATOR", {"finance.view", "payments.record"}),
        ("COMPANY", "COURIER", {"payments.record"}),
        ("COMPANY", "WAREHOUSE", set()),
        ("STORE", "OWNER", {"finance.view", "payments.record"}),
        ("STORE", "SELLER", set()),
    ],
)
def test_permission_matrix_p09(side: str, role: str, expected: set[str]):
    assert {
        p for p in permissions_for(side, role) if p.split(".")[0] in {"finance", "payments", "adjustments"}
    } == expected
