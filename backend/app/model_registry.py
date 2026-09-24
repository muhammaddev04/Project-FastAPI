"""Imports every ORM model so Base.metadata is complete (Alembic, tests)."""

from app.core.audit import AuditLog
from app.core.db import Base
from app.modules.auth.models import OAuthIdentity, OtpCode, RefreshToken
from app.modules.identity.models import Membership, Organization, User

__all__ = ["AuditLog", "Base", "Membership", "OAuthIdentity", "Organization", "OtpCode", "RefreshToken", "User"]
