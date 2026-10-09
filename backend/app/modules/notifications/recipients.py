"""NTF-005: resolve the current ACTIVE membership and permission, never a cached role."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.events import DomainEvent
from app.core.permissions import permissions_for
from app.modules.delivery.models import Delivery
from app.modules.identity.models import Membership, User
from app.modules.notifications.policy import POLICIES
from app.modules.orders.models import Order
from app.modules.partnerships.models import Partnership


@dataclass(frozen=True)
class Recipient:
    user_id: UUID
    organization_id: UUID | None


def identifier(event: DomainEvent, key: str) -> UUID | None:
    value = event.payload.get(key)
    try:
        return UUID(str(value)) if value else None
    except ValueError:
        return None


async def resolve(session: AsyncSession, event: DomainEvent) -> list[Recipient]:
    name = event.event_type
    if name not in POLICIES:
        return []
    if POLICIES[name].group == "admin":
        users = await session.scalars(select(User.id).where(User.is_superadmin.is_(True), User.status == "ACTIVE"))
        return [Recipient(user_id, None) for user_id in users]
    if name == "EXPORT_READY":
        # EXP-008: only the member who asked for the file hears about it, and an admin export has no organization.
        requester = identifier(event, "requested_by")
        if requester is None:
            return []
        if event.org_id is None:
            return [Recipient(requester, None)]

    company, store = identifier(event, "company_id"), identifier(event, "store_id")
    partner_id = identifier(event, "partnership_id")
    partner = await session.get(Partnership, partner_id) if partner_id else None
    if partner:
        company, store = partner.company_id, partner.store_id
    order_id = identifier(event, "order_id")
    order = await session.get(Order, order_id) if order_id else None
    delivery_id = identifier(event, "delivery_id")
    delivery = await session.get(Delivery, delivery_id) if delivery_id else None
    if delivery:
        company, store = delivery.company_id, delivery.store_id
    if order:
        company, store = order.company_id, order.store_id

    targets: list[tuple[UUID | None, set[str], str, UUID | None]] = []

    def add(org: UUID | None, roles: str, permission: str, user: UUID | None = None) -> None:
        targets.append((org, set(roles.split()), permission, user))

    if name == "EXPORT_READY":
        every_role = "OWNER MANAGER OPERATOR WAREHOUSE COURIER SELLER"
        add(event.org_id, every_role, "org.view", identifier(event, "requested_by"))
    elif name.startswith("VERIFICATION_"):
        add(event.org_id, "OWNER", "verification.view")
    elif name.startswith("SUBSCRIPTION_"):
        status = event.payload.get("status") or event.payload.get("to_status") or event.payload.get("to")
        add(
            company or event.org_id,
            "OWNER MANAGER" if status in {"SOFT_BLOCK", "FULL_BLOCK"} else "OWNER",
            "subscription.view",
        )
    elif name.startswith("IMPORT_"):
        creator = identifier(event, "created_by")
        if creator:
            add(company or event.org_id, "OWNER MANAGER", "import.run", creator)
    elif name == "LOW_STOCK":
        add(company or event.org_id, "OWNER MANAGER WAREHOUSE", "stock.view")
    elif name in {"PARTNERSHIP_INVITED", "PARTNERSHIP_REQUESTED"}:
        if partner:
            add(store if partner.initiated_by_side == "COMPANY" else company, "OWNER MANAGER", "partners.view")
    elif POLICIES[name].group == "partners":
        add(company, "OWNER MANAGER", "partners.view")
        add(store, "OWNER", "partners.view")
    elif name == "ORDER_CREATED":
        add(company, "OWNER MANAGER OPERATOR", "orders.view")
        if order and order.source == "COMPANY_ON_BEHALF":
            add(store, "OWNER", "orders.view")
    elif name in {"ORDER_CONFIRMED", "ORDER_PARTIALLY_CONFIRMED", "ORDER_REJECTED", "ORDER_CANCELLED"}:
        add(store, "OWNER", "orders.view")
        if order:
            add(store, "OWNER SELLER", "orders.view", order.created_by)
            if name == "ORDER_CANCELLED":
                actor = await session.scalar(
                    select(AuditLog.actor_id)
                    .where(
                        AuditLog.entity_id == order.id,
                        AuditLog.action == "order.transition",
                        AuditLog.new_data["status"].astext == "CANCELLED",
                    )
                    .order_by(AuditLog.created_at.desc())
                    .limit(1)
                )
                if actor and await session.scalar(
                    select(Membership.id).where(
                        Membership.user_id == actor, Membership.organization_id == store, Membership.status == "ACTIVE"
                    )
                ):
                    add(company, "OWNER MANAGER OPERATOR", "orders.view")
    elif name == "ORDER_READY":
        add(company, "OWNER MANAGER", "delivery.plan")
    elif name == "DELIVERY_ASSIGNED":
        courier = identifier(event, "courier_id")
        if courier:
            add(company, "OWNER MANAGER COURIER", "delivery.act_own", courier)
    elif name == "DELIVERY_DISPATCHED":
        add(store, "OWNER SELLER", "delivery.view_store")
    elif name in {"DELIVERY_COMPLETED", "DELIVERY_FAILED"}:
        add(store, "OWNER", "delivery.view_store")
        add(company, "MANAGER", "delivery.view_all")
    elif name in {"DELIVERY_CODE_LOCKED", "DELIVERY_MANUAL_CONFIRMED"}:
        add(company, "OWNER MANAGER", "delivery.view_all")
        if name == "DELIVERY_MANUAL_CONFIRMED":
            add(store, "OWNER", "delivery.view_store")
    elif name == "PAYMENT_RECORDED":
        add(company, "OWNER MANAGER", "finance.view")
    elif name in {"PAYMENT_CONFIRMED", "PAYMENT_REJECTED", "ADJUSTMENT_APPROVED", "DEBT_DUE_SOON", "DEBT_OVERDUE"}:
        add(store, "OWNER", "finance.view")
        if name == "DEBT_OVERDUE":
            add(company, "MANAGER", "finance.view")
    elif name == "ADJUSTMENT_PENDING_APPROVAL":
        add(company, "OWNER", "adjustments.approve")
    elif name.startswith(("RETURN_", "DISPUTE_")):
        # P10 uses org_id as the recipient for most transitions; creation is sent to company.
        org = event.org_id or company
        if name == "RETURN_RECEIVED":
            add(company, "OWNER MANAGER WAREHOUSE", "returns.view")
        elif name == "DISPUTE_SLA_WARNING":
            add(company, "OWNER MANAGER", "disputes.view")
        else:
            add(org, "OWNER MANAGER", "returns.view" if name.startswith("RETURN_") else "disputes.view")

    found: dict[UUID, Recipient] = {}
    for org_id, roles, permission, specific in targets:
        if org_id is None:
            continue
        memberships = await session.scalars(
            select(Membership).where(Membership.organization_id == org_id, Membership.status == "ACTIVE")
        )
        for member in memberships:
            if (
                member.user.status == "ACTIVE"
                and member.organization.status != "BLOCKED"
                and member.role in roles
                and permission in permissions_for(member.organization.type, member.role)
                and (specific is None or member.user_id == specific)
            ):
                found[member.user_id] = Recipient(member.user_id, org_id)
    return list(found.values())
