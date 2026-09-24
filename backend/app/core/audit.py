from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, Index, String, Text
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin
from app.core.request_context import get_client_ip, get_request_id, get_user_agent

# FND-015: never stored in old_data/new_data.
REDACTED_FIELDS = frozenset(
    {"password", "password_hash", "token", "access_token", "refresh_token", "code", "otp", "code_hash"}
)


class AuditLog(IdMixin, CreatedAtMixin, Base):
    """P00 §3.3 append-only audit log; UPDATE/DELETE are rejected by the forbid_mutation() trigger (FND-010)."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        CheckConstraint("actor_type IN ('USER','SYSTEM','SUPERADMIN')", name="actor_type"),
        Index("ix_audit_logs_org_created", "org_id", "created_at"),
        Index("ix_audit_logs_entity", "entity_type", "entity_id"),
        Index("ix_audit_logs_actor_created", "actor_id", "created_at"),
    )

    actor_id: Mapped[UUID | None]
    actor_type: Mapped[str] = mapped_column(String(16), default="USER")
    org_id: Mapped[UUID | None]
    action: Mapped[str] = mapped_column(String(64))
    entity_type: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[UUID]
    old_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    new_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    reason: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(512))
    request_id: Mapped[str | None] = mapped_column(String(64))


def _redact(data: dict[str, Any] | None) -> dict[str, Any] | None:
    if data is None:
        return None
    return {key: ("[REDACTED]" if key in REDACTED_FIELDS else value) for key, value in data.items()}


async def record(
    session: AsyncSession,
    action: str,
    entity_type: str,
    entity_id: UUID,
    *,
    actor_id: UUID | None = None,
    org_id: UUID | None = None,
    old: dict[str, Any] | None = None,
    new: dict[str, Any] | None = None,
    reason: str | None = None,
) -> None:
    """AUD-001: added to the caller's transaction; actor, IP, user agent and request id come from context."""
    session.add(
        AuditLog(
            actor_id=actor_id,
            actor_type="USER" if actor_id else "SYSTEM",
            org_id=org_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            old_data=_redact(old),
            new_data=_redact(new),
            reason=reason,
            ip=get_client_ip(),
            user_agent=get_user_agent(),
            request_id=get_request_id(),
        )
    )
