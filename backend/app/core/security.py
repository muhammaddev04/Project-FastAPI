from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings
from app.core.time import utcnow

_hasher = PasswordHasher()
# IAM-004: verified against unknown phones so failed logins take roughly the same time.
DUMMY_PASSWORD_HASH = _hasher.hash("tezfarmo-dummy-password-for-timing")


class TokenError(Exception):
    """Raised for any JWT problem; `code` is token_expired or token_invalid."""

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


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def otp_hash(phone: str, purpose: str, code: str) -> str:
    """otp_codes.code_hash = HMAC-SHA256(secret, phone + purpose + code) (P01 §2.2)."""
    secret = get_settings().otp_hmac_secret.encode("utf-8")
    return hmac.new(secret, f"{phone}{purpose}{code}".encode(), hashlib.sha256).hexdigest()


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def generate_opaque_token() -> str:
    return secrets.token_urlsafe(48)


def _encode(secret: str, claims: dict[str, Any], ttl: timedelta) -> str:
    now = utcnow()
    payload = {**claims, "iat": int(now.timestamp()), "exp": int((now + ttl).timestamp())}
    return jwt.encode(payload, secret, algorithm="HS256")


def _decode(secret: str, token: str, expected_type: str) -> dict[str, Any]:
    try:
        payload: dict[str, Any] = jwt.decode(token, secret, algorithms=["HS256"], options={"require": ["exp", "typ"]})
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("token_expired") from exc
    except jwt.PyJWTError as exc:
        raise TokenError("token_invalid") from exc
    if payload.get("typ") != expected_type:
        raise TokenError("token_invalid")
    return payload


def create_access_token(user_id: str, family_id: str, token_version: int) -> str:
    """IAM-005: sub, sid (family), tv (token_version), typ=access, 15 min."""
    settings = get_settings()
    claims = {"sub": user_id, "sid": family_id, "tv": token_version, "typ": "access"}
    return _encode(settings.jwt_access_secret, claims, timedelta(minutes=settings.access_token_ttl_minutes))


def decode_access_token(token: str) -> dict[str, Any]:
    return _decode(get_settings().jwt_access_secret, token, "access")


def create_flow_token(token_type: str, subject: str, jti: str, extra: dict[str, Any] | None = None) -> str:
    """Short-lived single-use tokens: registration (IAM-002), reset (IAM-015), google_link."""
    settings = get_settings()
    claims = {"sub": subject, "jti": jti, "typ": token_type, **(extra or {})}
    return _encode(settings.jwt_flow_secret, claims, timedelta(minutes=settings.flow_token_ttl_minutes))


def decode_flow_token(token: str, token_type: str) -> dict[str, Any]:
    return _decode(get_settings().jwt_flow_secret, token, token_type)
