"""Imports every ORM model so Base.metadata is complete (Alembic autogenerate, tests)."""

from app.core.audit import AuditLog
from app.core.db import Base
from app.modules.identity.models import Membership, OAuthIdentity, Organization, User

__all__ = ["AuditLog", "Base", "Membership", "OAuthIdentity", "Organization", "User"]
