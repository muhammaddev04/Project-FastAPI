"""Imports every ORM model so Base.metadata is complete (Alembic autogenerate, tests)."""

from app.core.audit import AuditLog
from app.core.db import Base

__all__ = ["AuditLog", "Base"]
