"""P12 §3 SUPERADMIN request and response models."""

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.modules.organizations.schemas import Phone, TaxIdentifier

#: §3: every state-changing admin action says why, and the reason is kept in the audit row. The length rule
#: lives in the service, so a missing reason answers `override_reason_required` rather than `validation_error`.
Reason = Annotated[str | None, Field(default=None, max_length=500)]


class ReasonIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: Reason = None


class AdminDashboardOut(BaseModel):
    """ADM-001."""

    organizations: dict[str, int]
    subscriptions: dict[str, int]
    mrr: Decimal
    verifications_pending: int
    outbox_failed: int
    reconciliation_issues: int
    notifications_failed_24h: int


class AdminMembershipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    full_name: str
    organization_id: UUID
    organization_name: str
    organization_type: Literal["COMPANY", "STORE"]
    role: str
    status: str


class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    full_name: str
    email: str
    phone: str | None
    status: str
    is_superadmin: bool
    language: str
    last_login_at: datetime | None
    created_at: datetime


class AdminUserDetail(AdminUserOut):
    memberships: list[AdminMembershipOut]


class AdminOrganizationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    type: Literal["COMPANY", "STORE"]
    status: str
    legal_name: str | None = None
    verification_status: str | None = None
    created_at: datetime


class SubscriptionSummaryOut(BaseModel):
    status: str
    plan_code: str
    current_period_end: datetime | None


class AdminOrganizationDetail(AdminOrganizationOut):
    phone: str | None = None
    email: str | None = None
    city: str | None = None
    address: str | None = None
    tax_identifier: str | None = None
    members: list[AdminMembershipOut]
    partnerships: int
    subscription: SubscriptionSummaryOut | None = None
    version: int


class TransferOwnershipIn(ReasonIn):
    """ADM-003: the new owner must already be an active member; the old owner stays on as MANAGER or leaves."""

    user_id: UUID
    previous_owner_role: Literal["MANAGER", "REVOKED"] = "MANAGER"


class LegalPatch(ReasonIn):
    """ADM-003 / ORG-005: the legal fields a tenant may not change themselves."""

    legal_name: Annotated[str, Field(min_length=2, max_length=255)] | None = None
    tax_identifier: TaxIdentifier | None = None
    phone: Phone | None = None
    city: Annotated[str, Field(min_length=2, max_length=100)] | None = None
    address: Annotated[str, Field(min_length=3, max_length=500)] | None = None
    version: int


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    actor_id: UUID | None
    actor_type: str
    org_id: UUID | None
    action: str
    entity_type: str
    entity_id: UUID
    old_data: dict[str, Any] | None
    new_data: dict[str, Any] | None
    reason: str | None
    request_id: str | None


class OutboxEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_type: str
    org_id: UUID | None
    status: str
    attempts: int
    last_error: str | None
    created_at: datetime
    next_attempt_at: datetime
    processed_at: datetime | None


class NotificationFailureOut(BaseModel):
    id: UUID
    notification_id: UUID
    user_id: UUID
    channel: str
    event_type: str
    attempts: int
    last_error: str | None
    created_at: datetime


class AdminOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    order_number: str
    company_id: UUID
    store_id: UUID
    status: str
    total: Decimal | None
    created_at: datetime
    delivered_at: datetime | None
