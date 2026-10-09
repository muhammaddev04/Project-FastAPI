from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin
from app.core.time import utcnow


class Notification(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index("uq_notifications_event_user", "event_id", "user_id", unique=True),
        Index("ix_notifications_user_unread_created", "user_id", "read_at", "created_at"),
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    organization_id: Mapped[UUID | None] = mapped_column(ForeignKey("organizations.id", ondelete="RESTRICT"))
    event_id: Mapped[UUID] = mapped_column(ForeignKey("outbox_events.id", ondelete="RESTRICT"))
    event_type: Mapped[str] = mapped_column(String(64))
    title_key: Mapped[str] = mapped_column(String(128))
    body_key: Mapped[str] = mapped_column(String(128))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB)
    link: Mapped[str | None] = mapped_column(String(255))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NotificationDelivery(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "notification_deliveries"
    __table_args__ = (
        CheckConstraint("channel IN ('TELEGRAM','SMS')", name="channel"),
        CheckConstraint("status IN ('PENDING','SENT','FAILED','SKIPPED')", name="status"),
        CheckConstraint("attempts BETWEEN 0 AND 3", name="attempts"),
        Index("uq_notification_deliveries_notification_channel", "notification_id", "channel", unique=True),
        Index("ix_notification_deliveries_pending", "status", "next_attempt_at"),
    )

    notification_id: Mapped[UUID] = mapped_column(ForeignKey("notifications.id", ondelete="RESTRICT"))
    channel: Mapped[str] = mapped_column(String(8))
    status: Mapped[str] = mapped_column(String(12), default="PENDING", server_default="PENDING")
    attempts: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    provider_message_id: Mapped[str | None] = mapped_column(String(128))
    last_error: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Persistent retry scheduling also recovers a worker/queue restart.
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (
        CheckConstraint("channel IN ('TELEGRAM','SMS')", name="channel"),
        CheckConstraint(
            "event_group IN ('admin','account','billing','catalog','stock','partners','orders',"
            "'delivery','finance','returns','disputes','exports')",
            name="event_group",
        ),
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True)
    event_group: Mapped[str] = mapped_column(String(16), primary_key=True)
    channel: Mapped[str] = mapped_column(String(8), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean)


class TelegramAccount(Base):
    __tablename__ = "telegram_accounts"

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True)
    telegram_user_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    chat_id: Mapped[int] = mapped_column(BigInteger)
    username: Mapped[str | None] = mapped_column(String(64))
    language: Mapped[str | None] = mapped_column(String(2))
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    is_blocked_by_user: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class TelegramLinkToken(CreatedAtMixin, Base):
    __tablename__ = "telegram_link_tokens"
    __table_args__ = (Index("ix_telegram_link_tokens_expires_at", "expires_at"),)

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TelegramUpdate(Base):
    __tablename__ = "telegram_updates"
    __table_args__ = (Index("ix_telegram_updates_received_at", "received_at"),)

    update_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
