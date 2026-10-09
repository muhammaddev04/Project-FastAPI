"""P09 transactional finance writer; callers own the outer transaction.

The balance row serializes every posting for a partnership. Finance follows the
existing company/subscription lock order before taking that row, and never takes
order/delivery locks. Savepoints undo posting even when a caller catches an error.
"""

import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import Select, case, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.errors import AppError
from app.core.events import DomainEvent, event_bus
from app.core.time import new_id, utcnow
from app.modules.delivery.models import Delivery
from app.modules.finance import domain
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
from app.modules.identity.deps import OrgContext
from app.modules.identity.team_service import lock_org
from app.modules.orders.models import Order
from app.modules.organizations.models import Company, Store
from app.modules.partnerships.models import Partnership, PartnershipTerms
from app.modules.partnerships.service import require, terms_service
from app.modules.subscriptions import service as subscriptions
from app.modules.subscriptions.domain import SubAction

logger = logging.getLogger("tezfarmo.finance")
AdjustmentType = Literal["DEBIT", "CREDIT", "REFUND"]
PaymentMethod = Literal["CASH", "BANK_TRANSFER"]


@dataclass(frozen=True)
class SystemActor:
    source: Literal["ORDER_DELIVERED", "RETURN"]


@dataclass(frozen=True)
class BalanceSummary:
    partnership_id: UUID
    balance: Decimal
    outstanding: Decimal
    unapplied: Decimal
    overdue: Decimal
    credit_limit: Decimal
    available: Decimal
    aging: dict[domain.AgingBucket, Decimal]


def financial_amount(value: Decimal) -> Decimal:
    if not value.is_finite() or not 0 < value <= Decimal("9999999999.99") or value % domain.CENT:
        raise AppError("validation_error", 422, {"field": "amount"})
    return value.quantize(domain.CENT)


def version(record: Payment | Adjustment, expected: int) -> None:
    if record.version != expected:
        raise AppError("version_conflict", 409, {"current_version": record.version})


async def party(session: AsyncSession, partnership_id: UUID, ctx: OrgContext | None = None) -> Partnership:
    query = select(Partnership).where(Partnership.id == partnership_id)
    if ctx:
        column = Partnership.company_id if ctx.organization.type == "COMPANY" else Partnership.store_id
        query = query.where(column == ctx.organization.id)
    result = await session.scalar(query)
    if result is None:
        raise AppError("not_found", 404)
    return result


class FinanceService:
    async def _lock(self, session: AsyncSession, partnership_id: UUID) -> PartnershipBalance:
        partner = await party(session, partnership_id)
        await lock_org(session, partner.company_id)
        await subscriptions.get_subscription(session, company_id=partner.company_id, lock=True)
        # ON CONFLICT handles simultaneous first postings/activation without a lost row.
        await session.execute(insert(PartnershipBalance).values(partnership_id=partnership_id).on_conflict_do_nothing())
        return (
            await session.scalars(
                select(PartnershipBalance)
                .where(PartnershipBalance.partnership_id == partnership_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).one()

    async def _post_ledger(
        self,
        session: AsyncSession,
        partner: Partnership,
        balance: PartnershipBalance,
        entry_type: domain.EntryType,
        amount: Decimal,
        currency: str,
        source_type: str,
        source_id: UUID,
        description: str,
        actor_id: UUID | None,
    ) -> LedgerEntry:
        after = domain.posted_balance(balance.balance, amount, entry_type)
        entry = LedgerEntry(
            id=new_id(),
            partnership_id=partner.id,
            company_id=partner.company_id,
            store_id=partner.store_id,
            entry_type=entry_type,
            direction=domain.ENTRY_DIRECTIONS[entry_type],
            amount=amount,
            currency=currency,
            source_type=source_type,
            source_id=source_id,
            balance_after=after,
            description=description,
            created_by=actor_id,
            created_at=utcnow(),
        )
        session.add(entry)
        await session.flush()
        balance.balance, balance.last_entry_id = after, entry.id
        balance.version += 1
        await session.flush()
        return entry

    async def _allocate_fifo(self, session: AsyncSession, partnership_id: UUID) -> None:
        charges = list(
            await session.scalars(
                select(Charge)
                .where(Charge.partnership_id == partnership_id, Charge.allocated_amount < Charge.amount)
                .order_by(Charge.due_date, Charge.created_at, Charge.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        credits = list(
            await session.scalars(
                select(Credit)
                .where(Credit.partnership_id == partnership_id, Credit.allocated_amount < Credit.amount)
                .order_by(Credit.created_at, Credit.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        charge_map, credit_map = {row.id: row for row in charges}, {row.id: row for row in credits}
        plan = domain.allocate_fifo(self._charges(charges), self._credits(credits))
        now = utcnow()
        for line in plan:
            charge, credit = charge_map[line.charge_id], credit_map[line.credit_id]
            session.add(
                Allocation(partnership_id=partnership_id, charge_id=charge.id, credit_id=credit.id, amount=line.amount)
            )
            charge.allocated_amount += line.amount
            credit.allocated_amount += line.amount
            charge.status = domain.charge_status(charge.amount, charge.allocated_amount)
            if charge.status == "PAID":
                charge.paid_at = now
        await session.flush()

    @staticmethod
    def _charges(rows: list[Charge]) -> list[domain.ChargeInput]:
        return [domain.ChargeInput(r.id, r.amount, r.allocated_amount, r.due_date, r.created_at) for r in rows]

    @staticmethod
    def _credits(rows: list[Credit]) -> list[domain.CreditInput]:
        return [domain.CreditInput(r.id, r.amount, r.allocated_amount, r.created_at) for r in rows]

    async def _logged(
        self,
        session: AsyncSession,
        partner: Partnership,
        action: str,
        table: str,
        record_id: UUID,
        actor_id: UUID | None,
        event: str | None = None,
        recipient: UUID | None = None,
        reason: str | None = None,
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

    async def create_order_charge(self, session: AsyncSession, actor: SystemActor, order: Order) -> Charge | None:
        if not isinstance(actor, SystemActor) or actor.source != "ORDER_DELIVERED":
            raise AppError("permission_denied", 403)
        if order.status not in {"DELIVERED", "DISPUTED", "COMPLETED"} or order.total is None or not order.delivered_at:
            raise AppError("invalid_transition", 409)
        async with session.begin_nested():
            partner = await party(session, order.partnership_id)
            balance = await self._lock(session, partner.id)
            existing = await session.scalar(select(Charge).where(Charge.kind == "ORDER", Charge.source_id == order.id))
            if existing:
                return existing
            if order.total == domain.ZERO:
                logger.info("Zero-total delivered order has no charge", extra={"order_id": str(order.id)})
                return None
            value = financial_amount(order.total)
            charge = Charge(
                partnership_id=partner.id,
                company_id=partner.company_id,
                store_id=partner.store_id,
                kind="ORDER",
                source_id=order.id,
                amount=value,
                currency=order.currency,
                due_date=domain.order_due_date(order.delivered_at, int((order.terms_snapshot or {})["credit_days"])),
            )
            session.add(charge)
            await session.flush()
            await self._post_ledger(
                session,
                partner,
                balance,
                "CHARGE",
                value,
                order.currency,
                "ORDER",
                order.id,
                f"Order {order.order_number}",
                None,
            )
            await self._allocate_fifo(session, partner.id)
            await self._logged(session, partner, "charge.created", "charges", charge.id, None, "CHARGE_CREATED")
            return charge

    async def _payment(self, session: AsyncSession, ctx: OrgContext, payment_id: UUID) -> tuple[Partnership, Payment]:
        payment = await session.get(Payment, payment_id)
        if payment is None:
            raise AppError("not_found", 404)
        partner = await party(session, payment.partnership_id, ctx)
        await lock_org(session, partner.company_id)
        await subscriptions.guard.require(session, partner.company_id, SubAction.PAYMENT)
        await self._lock(session, partner.id)
        await session.refresh(payment, with_for_update=True)
        return partner, payment

    async def record_payment(
        self,
        session: AsyncSession,
        ctx: OrgContext,
        partnership_id: UUID,
        amount: Decimal,
        method: PaymentMethod,
        reference: str | None = None,
        note: str | None = None,
        delivery_id: UUID | None = None,
        confirm: bool = False,
    ) -> Payment:
        require(ctx, "payments.record")
        value = domain.payment_amount(amount)
        if confirm:
            require(ctx, "payments.confirm", "COMPANY")
        async with session.begin_nested():
            partner = await party(session, partnership_id, ctx)
            await lock_org(session, partner.company_id)
            await subscriptions.guard.require(session, partner.company_id, SubAction.PAYMENT)
            await self._lock(session, partner.id)
            if partner.status not in {"ACTIVE", "SUSPENDED", "TERMINATED"}:
                raise AppError("partnership_not_active", 403)
            if ctx.membership.role == "COURIER" and (method != "CASH" or delivery_id is None):
                raise AppError("permission_denied", 403)
            terms = await terms_service.current(session, partner.id)
            if terms is None or method not in terms.payment_methods:
                raise AppError("validation_error", 422, {"field": "method"})
            reference = reference.strip() if reference else None
            if method == "BANK_TRANSFER" and not reference:
                raise AppError("validation_error", 422, {"field": "reference"})
            if reference and len(reference) > 100:
                raise AppError("validation_error", 422, {"field": "reference"})
            if delivery_id is not None:
                delivery = await session.get(Delivery, delivery_id)
                order = await session.get(Order, delivery.order_id) if delivery else None
                if delivery is None or order is None or order.partnership_id != partner.id:
                    raise AppError("not_found", 404)
                if ctx.membership.role == "COURIER" and delivery.courier_id != ctx.user.id:
                    raise AppError("not_found", 404)
            payment = Payment(
                partnership_id=partner.id,
                company_id=partner.company_id,
                store_id=partner.store_id,
                amount=value,
                currency="TJS",
                method=method,
                reference=reference,
                note=note,
                delivery_id=delivery_id,
                recorded_by=ctx.user.id,
                recorded_side=ctx.organization.type,
            )
            session.add(payment)
            await session.flush()
            session.add(
                PaymentStatusHistory(payment_id=payment.id, from_status=None, to_status="PENDING", actor_id=ctx.user.id)
            )
            await self._logged(
                session, partner, "payment.recorded", "payments", payment.id, ctx.user.id, "PAYMENT_RECORDED"
            )
            if confirm:
                await self.confirm_payment(session, ctx, payment.id, payment.version)
            return payment

    async def confirm_payment(self, session: AsyncSession, ctx: OrgContext, payment_id: UUID, expected: int) -> Payment:
        require(ctx, "payments.confirm", "COMPANY")
        async with session.begin_nested():
            partner, payment = await self._payment(session, ctx, payment_id)
            version(payment, expected)
            if payment.status != "PENDING":
                raise AppError("payment_not_pending", 409)
            balance = await self._lock(session, partner.id)
            payment.status, payment.confirmed_by, payment.confirmed_at = "CONFIRMED", ctx.user.id, utcnow()
            payment.version += 1
            session.add(
                PaymentStatusHistory(
                    payment_id=payment.id, from_status="PENDING", to_status="CONFIRMED", actor_id=ctx.user.id
                )
            )
            session.add(
                Credit(
                    partnership_id=partner.id,
                    company_id=partner.company_id,
                    store_id=partner.store_id,
                    kind="PAYMENT",
                    source_id=payment.id,
                    amount=payment.amount,
                )
            )
            await session.flush()
            await self._post_ledger(
                session,
                partner,
                balance,
                "PAYMENT",
                payment.amount,
                payment.currency,
                "PAYMENT",
                payment.id,
                f"Payment {payment.id}",
                ctx.user.id,
            )
            await self._allocate_fifo(session, partner.id)
            await self._logged(
                session,
                partner,
                "payment.confirmed",
                "payments",
                payment.id,
                ctx.user.id,
                "PAYMENT_CONFIRMED",
                partner.store_id,
            )
            return payment

    async def reject_payment(
        self, session: AsyncSession, ctx: OrgContext, payment_id: UUID, reason: str, expected: int
    ) -> Payment:
        require(ctx, "payments.reject", "COMPANY")
        return await self._finish_payment(session, ctx, payment_id, expected, "REJECTED", reason)

    async def cancel_payment(self, session: AsyncSession, ctx: OrgContext, payment_id: UUID, expected: int) -> Payment:
        return await self._finish_payment(session, ctx, payment_id, expected, "CANCELLED", None)

    async def _finish_payment(
        self,
        session: AsyncSession,
        ctx: OrgContext,
        payment_id: UUID,
        expected: int,
        target: Literal["REJECTED", "CANCELLED"],
        reason: str | None,
    ) -> Payment:
        async with session.begin_nested():
            partner, payment = await self._payment(session, ctx, payment_id)
            if target == "CANCELLED" and payment.recorded_by != ctx.user.id:
                raise AppError("permission_denied", 403)
            version(payment, expected)
            if payment.status != "PENDING":
                raise AppError("payment_not_pending", 409)
            if target == "REJECTED" and not (reason and reason.strip()):
                raise AppError("validation_error", 422, {"field": "reason"})
            payment.status = target
            payment.version += 1
            if target == "CANCELLED":
                payment.cancelled_at = utcnow()
            else:
                payment.rejected_reason = reason
            session.add(
                PaymentStatusHistory(
                    payment_id=payment.id, from_status="PENDING", to_status=target, actor_id=ctx.user.id, reason=reason
                )
            )
            await self._logged(
                session,
                partner,
                f"payment.{target.lower()}",
                "payments",
                payment.id,
                ctx.user.id,
                "PAYMENT_REJECTED" if target == "REJECTED" else None,
                partner.store_id,
                reason,
            )
            return payment

    async def create_adjustment(
        self,
        session: AsyncSession,
        ctx: OrgContext,
        partnership_id: UUID,
        type: AdjustmentType,
        amount: Decimal,
        reason: str,
        source: Literal["MANUAL", "DISPUTE"] = "MANUAL",
        source_id: UUID | None = None,
    ) -> Adjustment:
        require(ctx, "adjustments.create", "COMPANY")
        value = financial_amount(amount)
        if len(reason.strip()) < 10 or type not in {"DEBIT", "CREDIT", "REFUND"}:
            raise AppError("validation_error", 422)
        if source not in {"MANUAL", "DISPUTE"} or (source == "DISPUTE" and source_id is None):
            raise AppError("validation_error", 422, {"field": "source"})
        async with session.begin_nested():
            partner = await party(session, partnership_id, ctx)
            await self._lock(session, partner.id)
            adjustment = Adjustment(
                partnership_id=partner.id,
                type=type,
                amount=value,
                reason=reason.strip(),
                source=source,
                source_id=source_id,
                created_by=ctx.user.id,
            )
            session.add(adjustment)
            await session.flush()
            await self._logged(
                session,
                partner,
                "adjustment.created",
                "adjustments",
                adjustment.id,
                ctx.user.id,
                None if ctx.membership.role == "OWNER" else "ADJUSTMENT_PENDING_APPROVAL",
                reason=reason,
            )
            if ctx.membership.role == "OWNER":
                await self.approve_adjustment(session, ctx, adjustment.id, adjustment.version)
            return adjustment

    async def _adjustment(
        self, session: AsyncSession, ctx: OrgContext, record_id: UUID, expected: int
    ) -> tuple[Partnership, Adjustment, PartnershipBalance]:
        require(ctx, "adjustments.approve", "COMPANY")
        adjustment = await session.get(Adjustment, record_id)
        if adjustment is None:
            raise AppError("not_found", 404)
        partner = await party(session, adjustment.partnership_id, ctx)
        balance = await self._lock(session, partner.id)
        await session.refresh(adjustment, with_for_update=True)
        version(adjustment, expected)
        if adjustment.status != "PENDING_APPROVAL":
            raise AppError("invalid_transition", 409)
        return partner, adjustment, balance

    async def approve_adjustment(
        self, session: AsyncSession, ctx: OrgContext, record_id: UUID, expected: int
    ) -> Adjustment:
        async with session.begin_nested():
            partner, adjustment, balance = await self._adjustment(session, ctx, record_id, expected)
            if adjustment.type == "REFUND":
                summary = await self.balance(session, partner.id)
                if adjustment.amount > summary.unapplied:
                    raise AppError("refund_exceeds_credit", 422)
            adjustment.status, adjustment.approved_by, adjustment.approved_at = "APPROVED", ctx.user.id, utcnow()
            adjustment.self_approved = adjustment.created_by == ctx.user.id
            adjustment.version += 1
            entry_type: domain.EntryType
            if adjustment.type == "CREDIT":
                session.add(
                    Credit(
                        partnership_id=partner.id,
                        company_id=partner.company_id,
                        store_id=partner.store_id,
                        kind="ADJUSTMENT",
                        source_id=adjustment.id,
                        amount=adjustment.amount,
                    )
                )
                entry_type = "ADJUSTMENT_CREDIT"
            else:
                session.add(
                    Charge(
                        partnership_id=partner.id,
                        company_id=partner.company_id,
                        store_id=partner.store_id,
                        kind="REFUND" if adjustment.type == "REFUND" else "ADJUSTMENT",
                        source_id=adjustment.id,
                        amount=adjustment.amount,
                        currency="TJS",
                        due_date=domain.local_date(utcnow()),
                    )
                )
                entry_type = "REFUND" if adjustment.type == "REFUND" else "ADJUSTMENT_DEBIT"
            await session.flush()
            await self._post_ledger(
                session,
                partner,
                balance,
                entry_type,
                adjustment.amount,
                "TJS",
                "ADJUSTMENT",
                adjustment.id,
                adjustment.reason[:255],
                ctx.user.id,
            )
            await self._allocate_fifo(session, partner.id)
            await self._logged(
                session,
                partner,
                "adjustment.approved",
                "adjustments",
                adjustment.id,
                ctx.user.id,
                "ADJUSTMENT_APPROVED",
                partner.store_id,
                adjustment.reason,
            )
            return adjustment

    async def reject_adjustment(
        self, session: AsyncSession, ctx: OrgContext, record_id: UUID, reason: str, expected: int
    ) -> Adjustment:
        if not reason.strip():
            raise AppError("validation_error", 422, {"field": "reason"})
        async with session.begin_nested():
            partner, adjustment, _ = await self._adjustment(session, ctx, record_id, expected)
            adjustment.status, adjustment.rejected_reason = "REJECTED", reason.strip()
            adjustment.version += 1
            await self._logged(
                session,
                partner,
                "adjustment.rejected",
                "adjustments",
                adjustment.id,
                ctx.user.id,
                "ADJUSTMENT_REJECTED",
                partner.store_id,
                reason,
            )
            return adjustment

    async def create_credit_note(
        self,
        session: AsyncSession,
        actor: SystemActor,
        partnership_id: UUID,
        amount: Decimal,
        source_id: UUID,
        created_by: UUID | None = None,
    ) -> CreditNote:
        if not isinstance(actor, SystemActor) or actor.source != "RETURN":
            raise AppError("permission_denied", 403)
        value = financial_amount(amount)
        async with session.begin_nested():
            partner = await party(session, partnership_id)
            balance = await self._lock(session, partner.id)
            existing = await session.scalar(select(CreditNote).where(CreditNote.source_id == source_id))
            if existing:
                if existing.partnership_id != partner.id or existing.amount != value:
                    raise AppError("validation_error", 422, {"field": "source_id"})
                return existing
            note = CreditNote(partnership_id=partner.id, amount=value, source_id=source_id, created_by=created_by)
            session.add(note)
            await session.flush()
            session.add(
                Credit(
                    partnership_id=partner.id,
                    company_id=partner.company_id,
                    store_id=partner.store_id,
                    kind="CREDIT_NOTE",
                    source_id=note.id,
                    amount=value,
                )
            )
            await session.flush()
            await self._post_ledger(
                session,
                partner,
                balance,
                "CREDIT_NOTE",
                value,
                "TJS",
                "CREDIT_NOTE",
                note.id,
                f"Return {source_id}",
                created_by,
            )
            await self._allocate_fifo(session, partner.id)
            await self._logged(session, partner, "credit_note.created", "credit_notes", note.id, created_by)
            return note

    async def balance(self, session: AsyncSession, partnership_id: UUID, today: date | None = None) -> BalanceSummary:
        await party(session, partnership_id)
        balance = await self._lock(session, partnership_id)
        charges = list(
            await session.scalars(
                select(Charge)
                .where(Charge.partnership_id == partnership_id, Charge.allocated_amount < Charge.amount)
                .execution_options(populate_existing=True)
            )
        )
        credits = list(
            await session.scalars(
                select(Credit)
                .where(Credit.partnership_id == partnership_id, Credit.allocated_amount < Credit.amount)
                .execution_options(populate_existing=True)
            )
        )
        outstanding = sum((r.amount - r.allocated_amount for r in charges), domain.ZERO)
        unapplied = sum((r.amount - r.allocated_amount for r in credits), domain.ZERO)
        terms = await terms_service.current(session, partnership_id)
        limit = terms.credit_limit if terms else domain.ZERO
        buckets = domain.aging(self._charges(charges), today or domain.local_date(utcnow()))
        overdue = sum((value for key, value in buckets.items() if key != "current"), domain.ZERO)
        return BalanceSummary(
            partnership_id, balance.balance, outstanding, unapplied, overdue, limit, limit - balance.balance, buckets
        )

    async def credit_check(self, session: AsyncSession, partnership_id: UUID, amount: Decimal) -> domain.CreditCheck:
        if not amount.is_finite() or amount < domain.ZERO or amount % domain.CENT:
            raise AppError("validation_error", 422, {"field": "amount"})
        summary = await self.balance(session, partnership_id)
        return domain.CreditCheck(
            summary.balance + amount <= summary.credit_limit,
            summary.credit_limit,
            summary.balance,
            summary.outstanding,
            summary.unapplied,
            summary.available,
        )

    async def allocation_preview(
        self, session: AsyncSession, partnership_id: UUID, amount: Decimal
    ) -> list[domain.AllocationLine]:
        value = domain.payment_amount(amount)
        await party(session, partnership_id)
        await self._lock(session, partnership_id)
        charges = list(
            await session.scalars(
                select(Charge)
                .where(Charge.partnership_id == partnership_id, Charge.allocated_amount < Charge.amount)
                .execution_options(populate_existing=True)
            )
        )
        credits = list(
            await session.scalars(
                select(Credit)
                .where(Credit.partnership_id == partnership_id, Credit.allocated_amount < Credit.amount)
                .execution_options(populate_existing=True)
            )
        )
        hypothetical = domain.CreditInput(new_id(), value, domain.ZERO, utcnow())
        return [
            line
            for line in domain.allocate_fifo(self._charges(charges), self._credits(credits) + [hypothetical])
            if line.credit_id == hypothetical.id
        ]

    def balances_query(self, ctx: OrgContext) -> Select[Any]:
        """One SQL snapshot for tenant summaries/lists; aggregate each side before joining."""
        today = domain.local_date(utcnow())
        remaining = Charge.amount - Charge.allocated_amount
        buckets = {
            "current": Charge.due_date >= today,
            "1-30": (Charge.due_date < today) & (Charge.due_date >= today - timedelta(days=30)),
            "31-60": (Charge.due_date < today - timedelta(days=30)) & (Charge.due_date >= today - timedelta(days=60)),
            "61-90": (Charge.due_date < today - timedelta(days=60)) & (Charge.due_date >= today - timedelta(days=90)),
            "90+": Charge.due_date < today - timedelta(days=90),
        }
        charges = (
            select(
                Charge.partnership_id,
                func.sum(remaining).label("outstanding"),
                *(
                    func.sum(case((predicate, remaining), else_=domain.ZERO)).label(key)
                    for key, predicate in buckets.items()
                ),
            )
            .group_by(Charge.partnership_id)
            .subquery()
        )
        credits = (
            select(Credit.partnership_id, func.sum(Credit.amount - Credit.allocated_amount).label("unapplied"))
            .group_by(Credit.partnership_id)
            .subquery()
        )
        limit = func.coalesce(
            select(PartnershipTerms.credit_limit)
            .where(PartnershipTerms.partnership_id == Partnership.id, PartnershipTerms.effective_from <= utcnow())
            .order_by(PartnershipTerms.effective_from.desc(), PartnershipTerms.version_no.desc())
            .limit(1)
            .scalar_subquery(),
            domain.ZERO,
        )
        balance = func.coalesce(PartnershipBalance.balance, domain.ZERO)
        overdue = (
            func.coalesce(charges.c["1-30"], domain.ZERO)
            + func.coalesce(charges.c["31-60"], domain.ZERO)
            + func.coalesce(charges.c["61-90"], domain.ZERO)
            + func.coalesce(charges.c["90+"], domain.ZERO)
        )
        company_side = ctx.organization.type == "COMPANY"
        scoped = Partnership.company_id if company_side else Partnership.store_id
        name = Store.legal_name if company_side else Company.legal_name
        return (
            select(
                Partnership.id.label("partnership_id"),
                Partnership.company_id,
                Partnership.store_id,
                name.label("partner_name"),
                balance.label("balance"),
                func.coalesce(charges.c.outstanding, domain.ZERO).label("outstanding"),
                func.coalesce(credits.c.unapplied, domain.ZERO).label("unapplied"),
                overdue.label("overdue"),
                limit.label("credit_limit"),
                (limit - balance).label("available"),
                *(func.coalesce(charges.c[key], domain.ZERO).label(key) for key in buckets),
            )
            .select_from(Partnership)
            .join(Company, Company.id == Partnership.company_id)
            .join(Store, Store.id == Partnership.store_id)
            .outerjoin(PartnershipBalance, PartnershipBalance.partnership_id == Partnership.id)
            .outerjoin(charges, charges.c.partnership_id == Partnership.id)
            .outerjoin(credits, credits.c.partnership_id == Partnership.id)
            .where(scoped == ctx.organization.id, Partnership.status.in_(["ACTIVE", "SUSPENDED", "TERMINATED"]))
        )

    @staticmethod
    def balance_output(row: RowMapping) -> dict[str, Any]:
        buckets = ["current", "1-30", "31-60", "61-90", "90+"]
        return {key: value for key, value in row.items() if key not in buckets} | {
            "aging": {key: row[key] for key in buckets}
        }

    async def summary(self, session: AsyncSession, ctx: OrgContext) -> dict[str, Any]:
        rows = (await session.execute(self.balances_query(ctx))).mappings().all()
        totals = {
            key: sum((r[key] for r in rows), domain.ZERO) for key in ["balance", "outstanding", "unapplied", "overdue"]
        }
        return totals | {
            "aging": {
                key: sum((r[key] for r in rows), domain.ZERO) for key in ["current", "1-30", "31-60", "61-90", "90+"]
            }
        }

    async def payment_preview(self, session: AsyncSession, partnership_id: UUID, amount: Decimal) -> dict[str, Any]:
        lines = await self.allocation_preview(session, partnership_id, amount)
        charges = {
            r.id: r
            for r in await session.scalars(select(Charge).where(Charge.id.in_([line.charge_id for line in lines])))
        }
        allocated = sum((line.amount for line in lines), domain.ZERO)
        return {
            "amount": amount,
            "allocated": allocated,
            "unapplied": amount - allocated,
            "lines": [
                {
                    "charge_id": line.charge_id,
                    "amount": line.amount,
                    "due_date": charges[line.charge_id].due_date,
                    "source_id": charges[line.charge_id].source_id,
                }
                for line in lines
            ],
        }

    async def statement(
        self, session: AsyncSession, partnership_id: UUID, date_from: date | None, date_to: date | None
    ) -> dict[str, Any]:
        if date_from and date_to and date_from > date_to:
            raise AppError("validation_error", 422, {"field": "date_from"})
        await self._lock(session, partnership_id)
        query = select(LedgerEntry).where(LedgerEntry.partnership_id == partnership_id)
        signed = case((LedgerEntry.direction == "DEBIT", LedgerEntry.amount), else_=-LedgerEntry.amount)
        opening = domain.ZERO
        if date_from:
            start = datetime.combine(date_from, time.min, tzinfo=domain.FINANCE_TIMEZONE)
            opening = (
                await session.execute(
                    select(func.coalesce(func.sum(signed), domain.ZERO)).where(
                        LedgerEntry.partnership_id == partnership_id, LedgerEntry.created_at < start
                    )
                )
            ).scalar_one()
            query = query.where(LedgerEntry.created_at >= start)
        if date_to and date_to < date.max:
            end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=domain.FINANCE_TIMEZONE)
            query = query.where(LedgerEntry.created_at < end)
        entries = list(await session.scalars(query.order_by(LedgerEntry.created_at, LedgerEntry.id)))
        closing = opening + sum((e.amount if e.direction == "DEBIT" else -e.amount for e in entries), domain.ZERO)
        return {
            "partnership_id": partnership_id,
            "date_from": date_from,
            "date_to": date_to,
            "opening_balance": opening,
            "closing_balance": closing,
            "entries": entries,
        }


finance_service = FinanceService()
