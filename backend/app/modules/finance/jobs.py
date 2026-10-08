"""FIN-053/060: transactional reminders and detection without financial repairs."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.core.events import DomainEvent, event_bus
from app.core.time import new_id, utcnow
from app.modules.finance import domain
from app.modules.finance.models import (
    Allocation,
    Charge,
    Credit,
    DebtReminder,
    LedgerEntry,
    PartnershipBalance,
    Payment,
    ReconciliationIssue,
)
from app.modules.identity.team_service import lock_org
from app.modules.orders.models import Order
from app.modules.organizations.models import Company
from app.modules.partnerships.models import Partnership


async def send_reminders(session: AsyncSession, now: datetime | None = None) -> int:
    now = now or utcnow()
    today = domain.local_date(now)
    count = 0
    partners = list(await session.scalars(select(Partnership).order_by(Partnership.company_id, Partnership.id)))
    for partner in partners:
        # Follow posting's company-first lock order, then read fresh committed debt.
        await lock_org(session, partner.company_id)
        enabled = await session.scalar(select(Company.debt_reminders_enabled).where(Company.id == partner.company_id))
        if not enabled:
            continue
        charges = await session.scalars(
            select(Charge)
            .where(Charge.partnership_id == partner.id, Charge.status != "PAID")
            .execution_options(populate_existing=True)
        )
        for charge in charges:
            kind = domain.reminder_kind(charge.due_date, today)
            if kind is None:
                continue
            event = "DEBT_DUE_SOON" if kind == "DUE_SOON" else "DEBT_OVERDUE"
            reminder_id = await session.scalar(
                insert(DebtReminder)
                .values(id=new_id(), charge_id=charge.id, kind=event, anchor_date=today, created_at=now)
                .on_conflict_do_nothing(index_elements=["charge_id", "kind", "anchor_date"])
                .returning(DebtReminder.id)
            )
            if reminder_id is None:
                continue
            await event_bus.publish(
                session,
                DomainEvent(
                    event,
                    {
                        "id": str(reminder_id),
                        "charge_id": str(charge.id),
                        "partnership_id": str(partner.id),
                        "company_id": str(partner.company_id),
                        "store_id": str(partner.store_id),
                        "due_date": charge.due_date.isoformat(),
                        "amount": str(charge.amount - charge.allocated_amount),
                    },
                    org_id=partner.store_id,
                ),
            )
            count += 1
    return count


async def reconcile(session: AsyncSession, now: datetime | None = None) -> int:
    """Check all six FIN-060 invariants under the same company lock as posting.

    Missing projections are reported rather than initialized. No finance rows
    are changed: only issues and durable mismatch events are created.
    """
    now = now or utcnow()
    count = 0
    partners = list(await session.scalars(select(Partnership).order_by(Partnership.company_id, Partnership.id)))
    for partner in partners:
        await lock_org(session, partner.company_id)

        async def mismatch(code: str, expected: object, actual: object, partner: Partnership = partner) -> None:
            nonlocal count
            if expected == actual:
                return
            issue = ReconciliationIssue(
                partnership_id=partner.id, check_code=code, expected=str(expected), actual=str(actual), detected_at=now
            )
            session.add(issue)
            await session.flush()
            await event_bus.publish(
                session,
                DomainEvent(
                    "FINANCE_RECONCILIATION_MISMATCH",
                    {
                        "id": str(issue.id),
                        "partnership_id": str(partner.id),
                        "check_code": code,
                        "expected": str(expected),
                        "actual": str(actual),
                    },
                    org_id=partner.company_id,
                ),
            )
            count += 1

        ledger_total = await session.scalar(
            select(
                func.coalesce(
                    func.sum(case((LedgerEntry.direction == "DEBIT", LedgerEntry.amount), else_=-LedgerEntry.amount)),
                    domain.ZERO,
                )
            ).where(LedgerEntry.partnership_id == partner.id)
        )
        projection = await session.get(PartnershipBalance, partner.id, populate_existing=True)
        # Invited/rejected partnerships need no projection before activation/posting.
        needs_projection = partner.status in {"ACTIVE", "SUSPENDED", "TERMINATED"} or ledger_total != domain.ZERO
        if projection is not None or needs_projection:
            await mismatch("BALANCE_LEDGER", ledger_total, projection.balance if projection else "MISSING")
        charges = list(
            await session.scalars(
                select(Charge).where(Charge.partnership_id == partner.id).execution_options(populate_existing=True)
            )
        )
        credits = list(
            await session.scalars(
                select(Credit).where(Credit.partnership_id == partner.id).execution_options(populate_existing=True)
            )
        )
        outstanding = sum((c.amount - c.allocated_amount for c in charges), domain.ZERO)
        unapplied = sum((c.amount - c.allocated_amount for c in credits), domain.ZERO)
        if projection is not None or needs_projection:
            await mismatch(
                "BALANCE_OUTSTANDING", outstanding - unapplied, projection.balance if projection else "MISSING"
            )
        groups: list[tuple[str, list[Charge] | list[Credit], InstrumentedAttribute[UUID]]] = [
            ("CHARGE", charges, Allocation.charge_id),
            ("CREDIT", credits, Allocation.credit_id),
        ]
        for label, rows, allocation_key in groups:
            totals = dict(
                (
                    await session.execute(
                        select(allocation_key, func.sum(Allocation.amount))
                        .where(Allocation.partnership_id == partner.id)
                        .group_by(allocation_key)
                    )
                )
                .tuples()
                .all()
            )
            for row in rows:
                allocated: Decimal = totals.get(row.id, domain.ZERO)
                await mismatch(f"{label}_ALLOCATION:{row.id}", allocated, row.allocated_amount)
        order_ids = await session.scalars(
            select(Order.id).where(
                Order.partnership_id == partner.id,
                Order.status.in_(["DELIVERED", "DISPUTED", "COMPLETED"]),
                Order.total > 0,
            )
        )
        sources = {c.source_id for c in charges if c.kind == "ORDER"}
        for order_id in order_ids:
            await mismatch(f"ORDER_CHARGE:{order_id}", True, order_id in sources)
        payment_ids = await session.scalars(
            select(Payment.id).where(Payment.partnership_id == partner.id, Payment.status == "CONFIRMED")
        )
        credit_sources = {c.source_id for c in credits if c.kind == "PAYMENT"}
        ledger_sources = set(
            await session.scalars(
                select(LedgerEntry.source_id).where(
                    LedgerEntry.partnership_id == partner.id, LedgerEntry.entry_type == "PAYMENT"
                )
            )
        )
        for payment_id in payment_ids:
            await mismatch(f"PAYMENT_CREDIT:{payment_id}", True, payment_id in credit_sources)
            await mismatch(f"PAYMENT_LEDGER:{payment_id}", True, payment_id in ledger_sources)
    return count
