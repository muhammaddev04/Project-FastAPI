from __future__ import annotations

from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings

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
    """IAM-005: validate signature, expiry and `typ=access`; claims sub/sid/tv are checked by the caller.

    Issuing tokens belongs to the P01 session service, which is deferred; this module only verifies them.
    """
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
