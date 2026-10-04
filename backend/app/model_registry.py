"""Imports every ORM model so Base.metadata is complete (Alembic autogenerate, tests)."""

from app.core.audit import AuditLog
from app.core.db import Base
from app.core.idempotency import IdempotencyRecord
from app.core.outbox import OutboxEvent
from app.core.sequences import NumberSequence
from app.modules.auth.models import EmailToken, RefreshToken
from app.modules.files.models import StoredFile
from app.modules.identity.models import Membership, MembershipInvitation, OAuthIdentity, Organization, User
from app.modules.organizations.models import Company, Store
from app.modules.support.models import SupportTicket
from app.modules.verification.models import VerificationDocument, VerificationRequest

__all__ = [
    "AuditLog",
    "Base",
    "Company",
    "EmailToken",
    "IdempotencyRecord",
    "Membership",
    "MembershipInvitation",
    "NumberSequence",
    "OAuthIdentity",
    "Organization",
    "OutboxEvent",
    "RefreshToken",
    "Store",
    "StoredFile",
    "SupportTicket",
    "User",
    "VerificationDocument",
    "VerificationRequest",
]
