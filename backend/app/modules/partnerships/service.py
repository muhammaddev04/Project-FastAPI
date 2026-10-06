from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.errors import AppError
from app.core.events import DomainEvent, event_bus
from app.core.time import new_id, utcnow
from app.modules.catalog.models import PriceList
from app.modules.identity.deps import OrgContext
from app.modules.identity.team_service import lock_org
from app.modules.organizations.models import Company, Store
from app.modules.partnerships import ports
from app.modules.partnerships.models import Partnership, PartnershipTerms
from app.modules.partnerships.schemas import InviteIn, PatchIn, TermsIn, TermsOut
from app.modules.subscriptions import service as subscriptions
from app.modules.subscriptions.domain import SubAction


def require(context: OrgContext, permission: str, side: str | None = None) -> None:
    if permission not in context.permissions or (side and context.organization.type != side):
        raise AppError("permission_denied", 403)


async def get(session: AsyncSession, context: OrgContext, partnership_id: UUID, *, lock: bool = False) -> Partnership:
    require(context, "partners.view")
    column = Partnership.company_id if context.organization.type == "COMPANY" else Partnership.store_id
    query = select(Partnership).where(Partnership.id == partnership_id, column == context.organization.id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    result = await session.scalar(query)
    if result is None:
        raise AppError("not_found", 404)
    return result


async def locked(session: AsyncSession, context: OrgContext, partnership_id: UUID) -> Partnership:
    # All writes use company organization -> subscription -> partnership -> price list lock order.
    partner = await get(session, context, partnership_id)
    await lock_org(session, partner.company_id)
    await subscriptions.get_subscription(session, company_id=partner.company_id, lock=True)
    return await get(session, context, partnership_id, lock=True)


async def logged(
    session: AsyncSession,
    context: OrgContext,
    partner: Partnership,
    action: str,
    event: str | None = None,
    reason: str | None = None,
    previous: str | None = None,
) -> None:
    await session.flush()
    await audit.record(
        session,
        f"partnership.{action}",
        "partnerships",
        partner.id,
        actor_id=context.user.id,
        org_id=context.organization.id,
        old={"status": previous} if previous else None,
        new={"status": partner.status, "company_id": str(partner.company_id), "store_id": str(partner.store_id)},
        reason=reason,
    )
    if event:
        await event_bus.publish(
            session,
            DomainEvent(
                event,
                {
                    "partnership_id": str(partner.id),
                    "company_id": str(partner.company_id),
                    "store_id": str(partner.store_id),
                },
                org_id=partner.company_id,
            ),
        )


class TermsService:
    async def current(
        self, session: AsyncSession, partnership_id: UUID, at: datetime | None = None
    ) -> PartnershipTerms | None:
        return (
            await session.scalars(
                select(PartnershipTerms)
                .where(
                    PartnershipTerms.partnership_id == partnership_id,
                    PartnershipTerms.effective_from <= (at or utcnow()),
                )
                .order_by(PartnershipTerms.effective_from.desc(), PartnershipTerms.version_no.desc())
                .limit(1)
            )
        ).one_or_none()

    async def history(self, session: AsyncSession, partnership_id: UUID) -> list[PartnershipTerms]:
        return list(
            await session.scalars(
                select(PartnershipTerms)
                .where(PartnershipTerms.partnership_id == partnership_id)
                .order_by(PartnershipTerms.version_no)
            )
        )

    async def append(
        self,
        session: AsyncSession,
        context: OrgContext,
        partner: Partnership,
        payload: TermsIn,
        *,
        initial: bool = False,
    ) -> PartnershipTerms:
        require(context, "terms.manage", "COMPANY")
        latest = await session.scalar(
            select(PartnershipTerms)
            .where(PartnershipTerms.partnership_id == partner.id)
            .order_by(PartnershipTerms.version_no.desc())
            .limit(1)
        )
        now = utcnow()
        if payload.effective_from < now - timedelta(minutes=1) or (
            latest and payload.effective_from <= latest.effective_from
        ):
            raise AppError("terms_effective_from_invalid", 422)
        current = await self.current(session, partner.id, now)
        baseline = current or latest
        if "terms.manage_credit" not in context.permissions:
            credit_limit = baseline.credit_limit if baseline else 0
            credit_days = baseline.credit_days if baseline else 0
            if payload.credit_limit != credit_limit or payload.credit_days != credit_days:
                raise AppError("permission_denied", 403, {"permission": "terms.manage_credit"})
        price_list = await session.scalar(
            select(PriceList)
            .where(PriceList.id == payload.price_list_id, PriceList.company_id == partner.company_id)
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        )
        if price_list is None or not price_list.is_active:
            raise AppError("validation_error", 422, {"field": "price_list_id", "reason": "foreign_or_inactive"})
        terms = PartnershipTerms(
            id=new_id(),
            partnership_id=partner.id,
            version_no=(latest.version_no + 1 if latest else 1),
            created_by=context.user.id,
            **payload.model_dump(),
        )
        session.add(terms)
        await session.flush()
        old = TermsOut.model_validate(latest).model_dump(mode="json") if latest else None
        new = TermsOut.model_validate(terms).model_dump(mode="json")
        await audit.record(
            session,
            "terms.created",
            "partnership_terms",
            terms.id,
            actor_id=context.user.id,
            org_id=partner.company_id,
            old=old,
            new=new,
        )
        if not initial:
            await event_bus.publish(
                session,
                DomainEvent(
                    "TERMS_CHANGED",
                    {
                        "partnership_id": str(partner.id),
                        "company_id": str(partner.company_id),
                        "store_id": str(partner.store_id),
                        "version_no": terms.version_no,
                    },
                    org_id=partner.company_id,
                ),
            )
        return terms


terms_service = TermsService()


def require_active(partner: Partnership) -> None:
    """P07 uses this gate for new orders; existing orders and settlement keep their own policies."""
    if partner.status != "ACTIVE":
        raise AppError("partnership_not_active", 403)


async def new(
    session: AsyncSession, context: OrgContext, company_id: UUID, store_id: UUID, code: str | None = None
) -> Partnership:
    require(context, "partners.manage")
    await lock_org(session, company_id)
    await subscriptions.guard.require(session, company_id, SubAction.PARTNERSHIP_NEW)
    if await session.get(Store, store_id) is None:
        raise AppError("not_found", 404)
    existing = await session.scalar(
        select(Partnership.id).where(
            Partnership.company_id == company_id,
            Partnership.store_id == store_id,
            Partnership.status.in_(["PENDING", "ACTIVE", "SUSPENDED"]),
        )
    )
    if existing:
        raise AppError("partnership_exists", 409)
    partner = Partnership(
        id=new_id(),
        company_id=company_id,
        store_id=store_id,
        initiated_by_side=context.organization.type,
        initiated_by=context.user.id,
        customer_code=code,
    )
    session.add(partner)
    await session.flush()
    return partner


async def invite(session: AsyncSession, context: OrgContext, payload: InviteIn) -> Partnership:
    require(context, "partners.manage", "COMPANY")
    partner = await new(session, context, context.organization.id, payload.store_id, payload.customer_code)
    await terms_service.append(session, context, partner, payload.terms, initial=True)
    await logged(session, context, partner, "invited", "PARTNERSHIP_INVITED")
    return partner


async def request(session: AsyncSession, context: OrgContext, public_code: str) -> Partnership:
    require(context, "partners.manage", "STORE")
    company_id = await session.scalar(select(Company.id).where(Company.public_code == public_code))
    if company_id is None:
        raise AppError("not_found", 404)
    partner = await new(session, context, company_id, context.organization.id)
    await logged(session, context, partner, "requested", "PARTNERSHIP_REQUESTED")
    return partner


async def verified(session: AsyncSession, partner: Partnership) -> None:
    # Refresh profiles under shared locks so concurrent verification changes cannot bypass activation.
    profiles: list[tuple[str, type[Company] | type[Store], UUID]] = [
        ("COMPANY", Company, partner.company_id),
        ("STORE", Store, partner.store_id),
    ]
    for side, model, org_id in profiles:
        status = await session.scalar(
            select(model.verification_status).where(model.id == org_id).with_for_update(read=True)
        )
        if status != "APPROVED":
            raise AppError("organization_not_verified", 403, {"side": side})


async def transition(
    session: AsyncSession,
    context: OrgContext,
    partnership_id: UUID,
    action: str,
    reason: str | None = None,
    terms: TermsIn | None = None,
) -> Partnership:
    require(context, "partners.terminate" if action == "terminate" else "partners.manage")
    partner = await locked(session, context, partnership_id)
    before = partner.status
    targets = {
        "accept": ("PENDING", "ACTIVE"),
        "decline": ("PENDING", "DECLINED"),
        "cancel": ("PENDING", "CANCELLED"),
        "suspend": ("ACTIVE", "SUSPENDED"),
        "reactivate": ("SUSPENDED", "ACTIVE"),
    }
    if action == "terminate":
        if before not in {"ACTIVE", "SUSPENDED"}:
            raise AppError("invalid_transition", 409)
        target = "TERMINATED"
    else:
        source, target = targets[action]
        if before != source:
            raise AppError("invalid_transition", 409)
    side = context.organization.type
    if action in {"accept", "decline"} and side == partner.initiated_by_side:
        raise AppError("permission_denied", 403)
    if action == "cancel" and side != partner.initiated_by_side:
        raise AppError("permission_denied", 403)
    if action in {"suspend", "reactivate"}:
        require(context, "partners.manage", "COMPANY")
    if action in {"suspend", "terminate"} and not (reason and reason.strip()):
        raise AppError("validation_error", 422, {"field": "reason"})
    if target == "ACTIVE":
        await verified(session, partner)
        await subscriptions.guard.require(
            session, partner.company_id, SubAction.PARTNERSHIP_NEW if before == "PENDING" else SubAction.CATALOG_WRITE
        )
        await subscriptions.guard.check_limit(
            session, partner.company_id, "active_stores", adding=1 if before == "PENDING" else 0
        )
        history = await terms_service.history(session, partner.id)
        if not history:
            if terms is None:
                raise AppError("validation_error", 422, {"field": "terms", "reason": "required"})
            await terms_service.append(session, context, partner, terms, initial=True)
        elif terms is not None:
            raise AppError("validation_error", 422, {"field": "terms", "reason": "already_exists"})
        if before == "PENDING":
            partner.activated_at = utcnow()
    if target == "SUSPENDED":
        partner.suspended_at = utcnow()
    if target in {"TERMINATED", "DECLINED", "CANCELLED"}:
        partner.ended_at = utcnow()
        partner.end_reason = reason
    if target == "TERMINATED":
        await ports.order_cancellation.cancel_open_orders(session, partner.id, "PARTNERSHIP_TERMINATED")
    partner.status = target
    partner.version += 1
    action_name = {
        "accept": "activated",
        "decline": "declined",
        "cancel": "cancelled",
        "suspend": "suspended",
        "reactivate": "reactivated",
        "terminate": "terminated",
    }[action]
    event = {
        "accept": "PARTNERSHIP_ACTIVATED",
        "decline": "PARTNERSHIP_DECLINED",
        "suspend": "PARTNERSHIP_SUSPENDED",
        "reactivate": "PARTNERSHIP_ACTIVATED",
        "terminate": "PARTNERSHIP_TERMINATED",
    }.get(action)
    await logged(session, context, partner, action_name, event, reason, before)
    return partner


async def append_terms(
    session: AsyncSession, context: OrgContext, partnership_id: UUID, payload: TermsIn
) -> PartnershipTerms:
    require(context, "terms.manage", "COMPANY")
    partner = await locked(session, context, partnership_id)
    if partner.status not in {"PENDING", "ACTIVE", "SUSPENDED"}:
        raise AppError("invalid_transition", 409)
    await subscriptions.guard.require(session, partner.company_id, SubAction.CATALOG_WRITE)
    return await terms_service.append(session, context, partner, payload)


async def patch(session: AsyncSession, context: OrgContext, partnership_id: UUID, payload: PatchIn) -> Partnership:
    require(context, "partners.manage", "COMPANY")
    partner = await locked(session, context, partnership_id)
    if partner.version != payload.version:
        raise AppError("version_conflict", 409, {"current_version": partner.version})
    await subscriptions.guard.require(session, partner.company_id, SubAction.CATALOG_WRITE)
    old = partner.customer_code
    partner.customer_code = payload.customer_code
    partner.version += 1
    await session.flush()
    await audit.record(
        session,
        "partnership.updated",
        "partnerships",
        partner.id,
        actor_id=context.user.id,
        org_id=partner.company_id,
        old={"customer_code": old},
        new={"customer_code": partner.customer_code},
    )
    return partner


async def active_store_count(session: AsyncSession, company_id: UUID) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(Partnership)
            .where(Partnership.company_id == company_id, Partnership.status.in_(["ACTIVE", "SUSPENDED"]))
        )
    ).scalar_one()
