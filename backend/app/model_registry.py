"""Imports every ORM model so Base.metadata is complete (Alembic autogenerate, tests)."""

from app.core.audit import AuditLog
from app.core.db import Base
from app.modules.files.models import StoredFile
from app.modules.identity.models import Membership, OAuthIdentity, Organization, User
from app.modules.organizations.models import Company, Store
from app.modules.verification.models import VerificationDocument, VerificationRequest

__all__ = [
    "AuditLog",
    "Base",
    "Company",
    "Membership",
    "OAuthIdentity",
    "Organization",
    "Store",
    "StoredFile",
    "User",
    "VerificationDocument",
    "VerificationRequest",
]
