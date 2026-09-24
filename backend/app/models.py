from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from uuid import uuid4


@dataclass
class Membership:
    id: str
    organization_id: str
    organization_type: str
    organization_name: str
    role: str
    status: str = "ACTIVE"

    def to_public_dict(self) -> dict:
        return {
            "id": self.id,
            "organization_id": self.organization_id,
            "organization_type": self.organization_type,
            "organization_name": self.organization_name,
            "role": self.role,
            "status": self.status,
        }


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
    roles: list[str] = field(default_factory=lambda: ["OWNER"])
    account_type: str = "COMPANY"
    memberships: list[Membership] = field(default_factory=list)
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
            "roles": self.roles,
            "account_type": self.account_type,
            "memberships": [membership.to_public_dict() for membership in self.memberships],
            "permissions": sorted({permission for role in self.roles for permission in get_role_permissions(role)}),
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


def get_role_permissions(role: str) -> list[str]:
    role_permissions = {
        "OWNER": ["members.view", "members.invite", "members.change_role", "members.suspend", "members.revoke"],
        "MANAGER": ["members.view"],
        "OPERATOR": [],
        "WAREHOUSE": [],
        "COURIER": [],
        "SELLER": [],
    }
    return role_permissions.get(role, [])


def build_user(phone: str, full_name: str, password_hash: str, language: str = "en", roles: list[str] | None = None, account_type: str = "COMPANY") -> User:
    organization_name = f"{full_name}'s {account_type.lower()}"
    membership = Membership(
        id=str(uuid4()),
        organization_id=str(uuid4()),
        organization_type=account_type,
        organization_name=organization_name,
        role="OWNER",
    )
    return User(
        id=str(uuid4()),
        phone=phone,
        full_name=full_name,
        password_hash=password_hash,
        language=language,
        roles=roles or ["OWNER"],
        account_type=account_type,
        memberships=[membership],
    )
