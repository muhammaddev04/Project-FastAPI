from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from uuid import uuid4


@dataclass
class User:
    id: str
    phone: str
    full_name: str
    password_hash: str
    language: str = "en"
    status: str = "ACTIVE"
    is_superadmin: bool = False
    token_version: int = 1
    phone_verified_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_login_at: datetime | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_public_dict(self) -> dict:
        return {
            "id": self.id,
            "phone": self.phone,
            "full_name": self.full_name,
            "language": self.language,
            "status": self.status,
            "is_superadmin": self.is_superadmin,
            "phone_verified_at": self.phone_verified_at.isoformat(),
            "last_login_at": self.last_login_at.isoformat() if self.last_login_at else None,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class OTPCode:
    phone: str
    purpose: str
    code_hash: str
    attempts: int = 0
    expires_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc) + timedelta(minutes=5))
    consumed_at: datetime | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class RefreshTokenRecord:
    id: str
    user_id: str
    family_id: str
    token_hash: str
    expires_at: datetime
    revoked_at: datetime | None = None
    replaced_by_id: str | None = None
    ip: str | None = None
    user_agent: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class RegistrationTokenPayload:
    user_phone: str
    purpose: str = "register"
    expires_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc) + timedelta(minutes=15))


def build_user(phone: str, full_name: str, password_hash: str, language: str = "en") -> User:
    return User(
        id=str(uuid4()),
        phone=phone,
        full_name=full_name,
        password_hash=password_hash,
        language=language,
    )
