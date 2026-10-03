from uuid import UUID

from sqlalchemy import JSON, CheckConstraint, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin


class SupportTicket(IdMixin, TimestampMixin, Base):
    __tablename__ = "support_tickets"
    __table_args__ = (
        CheckConstraint("kind IN ('BUG','FEEDBACK')", name="kind"),
        CheckConstraint("status IN ('OPEN','IN_PROGRESS','RESOLVED')", name="status"),
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    subject: Mapped[str] = mapped_column(String(160))
    message: Mapped[str] = mapped_column(Text)
    page_url: Mapped[str | None] = mapped_column(String(500))
    image_key: Mapped[str | None] = mapped_column(String(512))
    additional_image_keys: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")

    @property
    def image_keys(self) -> list[str]:
        return ([self.image_key] if self.image_key else []) + (self.additional_image_keys or [])

    @property
    def image_count(self) -> int:
        return len(self.image_keys)

    @property
    def has_image(self) -> bool:
        return self.image_key is not None

    status: Mapped[str] = mapped_column(String(16), default="OPEN", server_default="OPEN")
    reply: Mapped[str | None] = mapped_column(Text)
