from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    organization_id: UUID | None
    event_type: str
    title_key: str
    body_key: str
    params: dict[str, Any]
    link: str | None
    read_at: datetime | None
    created_at: datetime


class UnreadCount(BaseModel):
    count: int


class PreferenceIn(BaseModel):
    event_group: Literal[
        "admin",
        "account",
        "billing",
        "catalog",
        "stock",
        "partners",
        "orders",
        "delivery",
        "finance",
        "returns",
        "disputes",
    ]
    channel: Literal["TELEGRAM"]
    enabled: bool


class PreferenceOut(BaseModel):
    event_group: str
    channel: Literal["IN_APP", "TELEGRAM"]
    enabled: bool
    locked: bool


class TelegramLinkOut(BaseModel):
    configured: bool
    linked: bool
    username: str | None = None
    linked_at: datetime | None = None
    blocked: bool = False


class TelegramTokenOut(BaseModel):
    deep_link: str
    expires_at: datetime
