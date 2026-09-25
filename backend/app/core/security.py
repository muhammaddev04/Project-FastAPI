from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings
from app.core.time import utcnow

_hasher = PasswordHasher()


class TokenError(Exception):
    """Invalid access token; `code` is token_expired or token_invalid (02_ERROR_CODES, P01)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def hash_password(password: str) -> str:
    """SEC-002: argon2id."""
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def decode_access_token(token: str) -> dict[str, Any]:
    """IAM-005: validate signature, expiry and `typ=access`; claims sub/sid/tv are checked by the caller."""
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            get_settings().jwt_access_secret,
            algorithms=["HS256"],
            options={"require": ["exp", "sub", "typ"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("token_expired") from exc
    except jwt.PyJWTError as exc:
        raise TokenError("token_invalid") from exc
    if claims.get("typ") != "access":
        raise TokenError("token_invalid")
    return claims


def create_access_token(user_id: UUID, session_family_id: UUID, token_version: int) -> tuple[str, int]:
    """IAM-005 claims: `sub`, `sid` (refresh family), `tv`, `typ=access`, `iat`, `exp` (SEC-003).

    Returns the token and its lifetime in seconds (`expires_in`).
    """
    settings = get_settings()
    now = utcnow()
    lifetime = timedelta(minutes=settings.access_token_ttl_minutes)
    claims = {
        "sub": str(user_id),
        "sid": str(session_family_id),
        "tv": token_version,
        "typ": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + lifetime).timestamp()),
    }
    return jwt.encode(claims, settings.jwt_access_secret, algorithm="HS256"), int(lifetime.total_seconds())


def create_refresh_token(user_id: UUID, session_family_id: UUID, token_id: UUID, expires_at: datetime) -> str:
    """SEC-003 / P01 §2.3: refresh JWT signed with its own secret; `jti` is the `refresh_tokens` row id."""
    claims = {
        "sub": str(user_id),
        "sid": str(session_family_id),
        "jti": str(token_id),
        "typ": "refresh",
        "iat": int(utcnow().timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(claims, get_settings().jwt_refresh_secret, algorithm="HS256")


def decode_refresh_token(token: str) -> dict[str, Any]:
    """IAM-006: signature (refresh secret, HS256 only), expiry, `typ=refresh` and the `sub`/`sid`/`jti` claims.

    Raises `TokenError` (`token_expired` / `token_invalid`); the database row stays the authority for revocation.
    """
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            get_settings().jwt_refresh_secret,
            algorithms=["HS256"],
            options={"require": ["exp", "sub", "sid", "jti", "typ"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("token_expired") from exc
    except jwt.PyJWTError as exc:
        raise TokenError("token_invalid") from exc
    if claims.get("typ") != "refresh":
        raise TokenError("token_invalid")
    return claims
