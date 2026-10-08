"""Exercise P09 protections on migrated PostgreSQL, including direct SQL writes."""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import new_id, utcnow
from app.modules.finance.models import (
    Adjustment,
    Allocation,
    Charge,
    Credit,
    CreditNote,
    DebtReminder,
    LedgerEntry,
    Payment,
    PaymentStatusHistory,
)
from app.modules.partnerships.models import Partnership
from tests.factories import make_org, make_user


async def records(session: AsyncSession):
    user = await make_user(session)
    company = await make_org(session, user)
    store = await make_org(session, user, "STORE")
    partnership = Partnership(
        company_id=company.id, store_id=store.id, initiated_by=user.id, initiated_by_side="COMPANY"
    )
    session.add(partnership)
    await session.flush()
    party = dict(partnership_id=partnership.id, company_id=company.id, store_id=store.id)
    charge = Charge(
        **party, kind="ORDER", source_id=new_id(), amount=Decimal("100"), currency="TJS", due_date=date(2026, 10, 8)
    )
    credit = Credit(**party, kind="PAYMENT", source_id=new_id(), amount=Decimal("100"))
    entry = LedgerEntry(
        **party,
        entry_type="CHARGE",
        direction="DEBIT",
        amount=Decimal("100"),
        currency="TJS",
        source_type="ORDER",
        source_id=charge.source_id,
        balance_after=Decimal("100"),
        description="Fixture charge",
    )
    payment = Payment(
        **party, amount=Decimal("100"), currency="TJS", method="CASH", recorded_by=user.id, recorded_side="COMPANY"
    )
    session.add_all([charge, credit, entry, payment])
    await session.flush()
    allocation = Allocation(
        partnership_id=partnership.id, charge_id=charge.id, credit_id=credit.id, amount=Decimal("100")
    )
    session.add(allocation)
    await session.commit()
    return charge, credit, entry, payment, allocation, user


@pytest.mark.parametrize("table,index", [("charges", 0), ("credits", 1), ("ledger_entries", 2), ("allocations", 4)])
@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
async def test_fin_004_posting_update_delete_forbidden(session: AsyncSession, table: str, index: int, operation: str):
    rows = await records(session)
    query = (
        f"UPDATE {table} SET amount = 1 WHERE id = :id"
        if operation == "UPDATE"
        else f"DELETE FROM {table} WHERE id = :id"
    )
    expected = (
        ("financial posting facts are immutable" if operation == "UPDATE" else "financial items cannot be deleted")
        if table in {"charges", "credits"}
        else "append-only table"
    )
    with pytest.raises(DBAPIError, match=expected):
        async with session.begin_nested():
            await session.execute(text(query), {"id": rows[index].id})


async def test_fin_004_allocation_projection_update_allowed(session: AsyncSession):
    charge, credit, *_ = await records(session)
    charge.allocated_amount = credit.allocated_amount = Decimal("100")
    charge.status, charge.paid_at = "PAID", utcnow()
    await session.flush()
    with pytest.raises(DBAPIError, match="financial allocations cannot decrease"):
        async with session.begin_nested():
            await session.execute(
                text("UPDATE charges SET allocated_amount=0, status='OPEN', paid_at=NULL WHERE id=:id"),
                {"id": charge.id},
            )


@pytest.mark.parametrize("direction,entry_type", [("CREDIT", "CHARGE"), ("DEBIT", "PAYMENT"), ("OTHER", "REFUND")])
async def test_fin_001_direction_matches_entry_type_check(session: AsyncSession, direction: str, entry_type: str):
    _, _, entry, *_ = await records(session)
    with pytest.raises(DBAPIError, match="ck_ledger_entries_entry_direction"):
        async with session.begin_nested():
            session.add(
                LedgerEntry(
                    partnership_id=entry.partnership_id,
                    company_id=entry.company_id,
                    store_id=entry.store_id,
                    direction=direction,
                    entry_type=entry_type,
                    amount=Decimal("1"),
                    currency="TJS",
                    source_type="PAYMENT",
                    source_id=new_id(),
                    balance_after=Decimal("1"),
                    description="Invalid direction",
                )
            )
            await session.flush()


async def test_fin_004_allocation_cross_partnership_rejected(session: AsyncSession):
    charge, credit, _, _, _, user = await records(session)
    other_store = await make_org(session, user, "STORE")
    other = Partnership(
        company_id=charge.company_id, store_id=other_store.id, initiated_by=user.id, initiated_by_side="COMPANY"
    )
    session.add(other)
    await session.flush()
    with pytest.raises(DBAPIError, match="allocation partnership mismatch"):
        async with session.begin_nested():
            session.add(
                Allocation(partnership_id=other.id, charge_id=charge.id, credit_id=credit.id, amount=Decimal("1"))
            )
            await session.flush()


async def test_financial_party_mismatch_rejected(session: AsyncSession):
    charge, *_, user = await records(session)
    other_store = await make_org(session, user, "STORE")
    with pytest.raises(DBAPIError, match="financial partnership ownership mismatch"):
        async with session.begin_nested():
            session.add(
                Credit(
                    partnership_id=charge.partnership_id,
                    company_id=charge.company_id,
                    store_id=other_store.id,
                    kind="PAYMENT",
                    source_id=new_id(),
                    amount=Decimal("1"),
                )
            )
            await session.flush()


async def test_fin_011_duplicate_source_rejected(session: AsyncSession):
    charge, *_ = await records(session)
    with pytest.raises(DBAPIError, match="uq_charges_kind_source_id"):
        async with session.begin_nested():
            session.add(
                Charge(
                    partnership_id=charge.partnership_id,
                    company_id=charge.company_id,
                    store_id=charge.store_id,
                    kind=charge.kind,
                    source_id=charge.source_id,
                    amount=charge.amount,
                    currency="TJS",
                    due_date=charge.due_date,
                )
            )
            await session.flush()


async def test_fin_022_confirmed_payment_cannot_change(session: AsyncSession):
    _, _, _, payment, _, user = await records(session)
    payment.status, payment.confirmed_by, payment.confirmed_at = "CONFIRMED", user.id, utcnow()
    await session.flush()
    with pytest.raises(DBAPIError, match="final payments are immutable"):
        async with session.begin_nested():
            await session.execute(text("UPDATE payments SET status='CANCELLED' WHERE id=:id"), {"id": payment.id})


@pytest.mark.parametrize("table", ["credit_notes", "payment_status_history", "debt_reminders"])
@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
async def test_financial_history_is_append_only(session: AsyncSession, table: str, operation: str):
    charge, _, _, payment, _, user = await records(session)
    note = CreditNote(partnership_id=charge.partnership_id, amount=Decimal("1"), source_id=new_id(), created_by=user.id)
    history = PaymentStatusHistory(payment_id=payment.id, from_status=None, to_status="PENDING", actor_id=user.id)
    reminder = DebtReminder(charge_id=charge.id, kind="DEBT_DUE_SOON", anchor_date=date(2026, 10, 7))
    session.add_all([note, history, reminder])
    await session.commit()
    row_id = {"credit_notes": note.id, "payment_status_history": history.id, "debt_reminders": reminder.id}[table]
    query = (
        f"UPDATE {table} SET created_at=now() WHERE id=:id"
        if operation == "UPDATE"
        else f"DELETE FROM {table} WHERE id=:id"
    )
    with pytest.raises(DBAPIError, match="append-only table"):
        async with session.begin_nested():
            await session.execute(text(query), {"id": row_id})


async def test_fin_040_approved_adjustment_is_immutable(session: AsyncSession):
    charge, _, _, _, _, user = await records(session)
    adjustment = Adjustment(
        partnership_id=charge.partnership_id,
        type="CREDIT",
        amount=Decimal("1"),
        reason="Correction of fixture",
        created_by=user.id,
    )
    session.add(adjustment)
    await session.flush()
    adjustment.status, adjustment.approved_by, adjustment.approved_at = "APPROVED", user.id, utcnow()
    await session.flush()
    with pytest.raises(DBAPIError, match="final adjustments are immutable"):
        async with session.begin_nested():
            await session.execute(text("UPDATE adjustments SET amount=2 WHERE id=:id"), {"id": adjustment.id})


async def test_fin_053_reminder_identity_is_unique(session: AsyncSession):
    charge, *_ = await records(session)
    session.add(DebtReminder(charge_id=charge.id, kind="DEBT_OVERDUE", anchor_date=date(2026, 10, 9)))
    await session.flush()
    with pytest.raises(DBAPIError, match="uq_debt_reminders_charge_id_kind_anchor_date"):
        async with session.begin_nested():
            session.add(DebtReminder(charge_id=charge.id, kind="DEBT_OVERDUE", anchor_date=date(2026, 10, 9)))
            await session.flush()
