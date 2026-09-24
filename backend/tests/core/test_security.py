from __future__ import annotations

import jwt
import pytest

from app.core.config import get_settings
from app.core.security import (
    TokenError,
    create_access_token,
    create_flow_token,
    decode_access_token,
    decode_flow_token,
    generate_otp,
    hash_password,
    otp_hash,
    verify_password,
)


def test_sec_002_argon2id_hash_and_verify() -> None:
    hashed = hash_password("Tezfarmo2026")
    assert hashed.startswith("$argon2id$")
    assert verify_password("Tezfarmo2026", hashed)
    assert not verify_password("wrong", hashed)
    assert not verify_password("anything", "not-a-hash")


def test_iam_005_access_token_claims() -> None:
    token = create_access_token("user-1", "family-1", 3)
    claims = decode_access_token(token)
    assert claims["sub"] == "user-1"
    assert claims["sid"] == "family-1"
    assert claims["tv"] == 3
    assert claims["typ"] == "access"
    assert claims["exp"] - claims["iat"] == 15 * 60


def test_sec_003_access_and_flow_tokens_use_separate_secrets() -> None:
    flow = create_flow_token("registration", "+992900000000", "jti-1")
    with pytest.raises(TokenError):
        decode_access_token(flow)
    access = create_access_token("user-1", "family-1", 1)
    with pytest.raises(TokenError):
        decode_flow_token(access, "registration")


def test_flow_token_type_is_enforced() -> None:
    token = create_flow_token("reset", "+992900000000", "jti-1")
    assert decode_flow_token(token, "reset")["jti"] == "jti-1"
    with pytest.raises(TokenError) as exc:
        decode_flow_token(token, "registration")
    assert exc.value.code == "token_invalid"


def test_expired_token_reports_token_expired() -> None:
    expired = jwt.encode(
        {"sub": "u", "typ": "access", "iat": 1, "exp": 2}, get_settings().jwt_access_secret, algorithm="HS256"
    )
    with pytest.raises(TokenError) as exc:
        decode_access_token(expired)
    assert exc.value.code == "token_expired"


def test_otp_is_six_digits_and_hash_is_bound_to_phone_and_purpose() -> None:
    code = generate_otp()
    assert len(code) == 6 and code.isdigit()
    assert otp_hash("+992900000000", "REGISTER", code) != otp_hash("+992900000001", "REGISTER", code)
    assert otp_hash("+992900000000", "REGISTER", code) != otp_hash("+992900000000", "RESET_PASSWORD", code)


def test_fnd_002_production_refuses_insecure_defaults() -> None:
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(app_env="production")
    strong = "x" * 40
    settings = Settings(
        app_env="production",
        jwt_access_secret=strong + "a",
        jwt_refresh_secret=strong + "r",
        jwt_flow_secret=strong + "f",
        otp_hmac_secret=strong + "o",
    )
    assert settings.app_env == "production"
