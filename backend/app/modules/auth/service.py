"""P01 registration (IAM-001, IAM-003, IAM-016; CR-001).

Registration only creates the user: the organization comes later from `/welcome` (ORG-001). The response never
reveals whether an email is registered: a new address gets a verification link, a known one gets an
"you already have an account" email, and both requests answer `202` the same way.
"""

from __future__ import annotations

import hashlib

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.config import get_settings
from app.core.email import EmailDeliveryError, OutgoingEmail, get_email
from app.core.email_templates import render
from app.core.errors import AppError
from app.core.rate_limit import AUTH_EMAIL_SEND, hit
from app.core.security import hash_password
from app.modules.auth.password_policy import password_problems
from app.modules.auth.schemas import RegisterRequest
from app.modules.auth.tokens import TOKEN_LIFETIMES, issue_email_token
from app.modules.identity.models import User

VERIFY_EMAIL = "VERIFY_EMAIL"


def _rate_key(email: str) -> str:
    # Keyed by email (P00 §4.1) without storing the address itself in Redis.
    return hashlib.sha256(email.encode()).hexdigest()[:32]


def _link(path: str, token: str | None = None) -> str:
    base = get_settings().frontend_base_url.rstrip("/")
    return f"{base}{path}?token={token}" if token else f"{base}{path}"


async def _deliver(email: OutgoingEmail) -> None:
    """IAM-016: sent directly (not through the outbox); a failed delivery rolls the request back with 503."""
    try:
        await get_email().send(email)
    except EmailDeliveryError as exc:
        raise AppError("service_unavailable", 503) from exc


async def register(session: AsyncSession, payload: RegisterRequest) -> None:
    problems = password_problems(payload.password)
    if problems:
        raise AppError("weak_password", 422, {"fields": [{"field": "password", "code": code} for code in problems]})

    await hit(AUTH_EMAIL_SEND, _rate_key(payload.email))
    # Hash before looking the address up, so known and unknown emails cost about the same time (no enumeration).
    password_hash = hash_password(payload.password)

    existing = await session.scalar(select(User).where(func.lower(User.email) == payload.email))
    if existing is not None:
        await _deliver(
            render(
                "account_exists",
                existing.language,
                to=existing.email,
                name=existing.full_name,
                action_url=_link("/login"),
                minutes=0,
            )
        )
        return

    user = User(
        email=payload.email,
        full_name=payload.full_name,
        password_hash=password_hash,
        language=payload.language,
    )
    try:
        async with session.begin_nested():
            session.add(user)
            await session.flush()
    except IntegrityError:
        # The same address was registered concurrently; answer exactly like any known address.
        return

    token = await issue_email_token(session, user.id, VERIFY_EMAIL)
    await audit.record(
        session,
        "user.registered",
        "user",
        user.id,
        actor_id=user.id,
        new={"language": user.language, "email_verified": False},
    )
    lifetime_minutes = int(TOKEN_LIFETIMES[VERIFY_EMAIL].total_seconds() // 60)
    await _deliver(
        render(
            "verification",
            user.language,
            to=user.email,
            name=user.full_name,
            action_url=_link("/verify-email", token),
            minutes=lifetime_minutes,
        )
    )
