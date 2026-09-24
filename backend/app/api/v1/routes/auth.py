from __future__ import annotations

import random
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, field_validator

from app.config import settings
from app.models import User, build_user
from app.security import create_token, decode_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
profile_router = APIRouter(tags=["profile"])
bearer_scheme = HTTPBearer(auto_error=False)

USERS: dict[str, User] = {}
USER_BY_ID: dict[str, User] = {}
OTP_CODES: dict[str, dict[str, Any]] = {}

PHONE_REGEX = re.compile(r"^\+[1-9][0-9]{7,14}$")
COMMON_PASSWORDS = {
    "Password123",
    "Password1",
    "Qwerty123",
    "StrongPass123",
    "Admin123",
    "Welcome123",
}


class RegisterStartRequest(BaseModel):
    phone: str

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        if not PHONE_REGEX.match(value):
            raise ValueError("phone must be a valid E.164 number")
        return value


class RegisterVerifyRequest(BaseModel):
    phone: str
    code: str

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        if not PHONE_REGEX.match(value):
            raise ValueError("phone must be a valid E.164 number")
        return value


class RegisterCompleteRequest(BaseModel):
    registration_token: str
    full_name: str
    password: str
    language: str = "en"

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("password must be at least 8 characters")
        if not any(ch.isalpha() for ch in value) or not any(ch.isdigit() for ch in value):
            raise ValueError("password must contain letters and numbers")
        if value in COMMON_PASSWORDS:
            raise ValueError("password is too common")
        return value

    @field_validator("language")
    @classmethod
    def validate_language(cls, value: str) -> str:
        if value not in {"en", "ru", "tg"}:
            raise ValueError("language must be one of en, ru or tg")
        return value


class LoginRequest(BaseModel):
    phone: str
    password: str

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        if not PHONE_REGEX.match(value):
            raise ValueError("phone must be a valid E.164 number")
        return value


class ProfileUpdateRequest(BaseModel):
    full_name: str | None = None
    language: str | None = None

    model_config = ConfigDict(extra="ignore")


class ApiError(BaseModel):
    code: str
    message: str


def build_error(code: str, message: str, status_code: int = 401) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _phone_exists(phone: str) -> bool:
    return phone in USERS


def _issue_otp(phone: str) -> str:
    code = str(random.randint(100000, 999999))
    OTP_CODES[phone] = {
        "code": code,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
        "attempts": 0,
    }
    return code


def _decode_registration_token(token: str) -> str:
    try:
        payload = decode_token(token)
    except ValueError as exc:
        raise build_error("invalid_registration_token", "Registration token is invalid or expired", status.HTTP_401_UNAUTHORIZED) from exc
    if payload.get("typ") != "registration":
        raise build_error("invalid_registration_token", "Registration token type is invalid", status.HTTP_401_UNAUTHORIZED)
    phone = payload.get("sub")
    if not isinstance(phone, str):
        raise build_error("invalid_registration_token", "Registration token is invalid", status.HTTP_401_UNAUTHORIZED)
    return phone


def _get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> User:
    if credentials is None or not credentials.scheme.lower() == "bearer":
        raise build_error("authentication_required", "Bearer token is required", status.HTTP_401_UNAUTHORIZED)
    try:
        payload = decode_token(credentials.credentials)
    except ValueError as exc:
        raise build_error("token_expired", "Access token is invalid or expired", status.HTTP_401_UNAUTHORIZED) from exc
    if payload.get("typ") != "access":
        raise build_error("token_expired", "Access token type is invalid", status.HTTP_401_UNAUTHORIZED)
    user = USER_BY_ID.get(str(payload.get("sub")))
    if user is None:
        raise build_error("user_not_found", "User no longer exists", status.HTTP_404_NOT_FOUND)
    return user


@router.post("/register/start", status_code=status.HTTP_202_ACCEPTED)
def register_start(payload: RegisterStartRequest):
    phone = payload.phone
    if _phone_exists(phone):
        _issue_otp(phone)
        return {"status": "queued", "message": "You already have an account. We have sent a code to your phone.", "debug_code": OTP_CODES[phone]["code"]}
    code = _issue_otp(phone)
    return {"status": "queued", "message": "OTP sent", "debug_code": code}


@router.post("/register/verify")
def register_verify(payload: RegisterVerifyRequest):
    record = OTP_CODES.get(payload.phone)
    if record is None:
        raise build_error("invalid_code", "No active OTP was found for this phone", status.HTTP_401_UNAUTHORIZED)
    if datetime.now(timezone.utc) > record["expires_at"]:
        raise build_error("otp_expired", "OTP expired", status.HTTP_401_UNAUTHORIZED)
    if record["attempts"] >= 5:
        raise build_error("too_many_attempts", "Too many OTP attempts", status.HTTP_429_TOO_MANY_REQUESTS)
    if record["code"] != payload.code:
        record["attempts"] += 1
        raise build_error("invalid_code", "OTP code is invalid", status.HTTP_401_UNAUTHORIZED)
    record["attempts"] = 0
    token = create_token(payload.phone, "registration", ttl_minutes=15)
    return {"registration_token": token}


@router.post("/register/complete", status_code=status.HTTP_201_CREATED)
def register_complete(payload: RegisterCompleteRequest):
    phone = _decode_registration_token(payload.registration_token)
    if _phone_exists(phone):
        raise build_error("phone_already_registered", "This phone is already registered", status.HTTP_409_CONFLICT)
    user = build_user(phone, payload.full_name, hash_password(payload.password), payload.language)
    USERS[phone] = user
    USER_BY_ID[user.id] = user
    access_token = create_token(user.id, "access", ttl_minutes=settings.access_token_expire_minutes)
    return {"access_token": access_token, "expires_in": settings.access_token_expire_minutes * 60, "user": user.to_public_dict()}


@router.post("/login")
def login(payload: LoginRequest):
    user = USERS.get(payload.phone)
    if not user or not verify_password(payload.password, user.password_hash):
        raise build_error("invalid_credentials", "Invalid phone or password", status.HTTP_401_UNAUTHORIZED)
    access_token = create_token(user.id, "access", ttl_minutes=settings.access_token_expire_minutes)
    return {"access_token": access_token, "expires_in": settings.access_token_expire_minutes * 60, "user": user.to_public_dict()}


@profile_router.get("/me")
def current_user(user: User = Depends(_get_current_user)):
    return user.to_public_dict()


@profile_router.patch("/me")
def update_me(payload: ProfileUpdateRequest, user: User = Depends(_get_current_user)):
    if payload.full_name:
        user.full_name = payload.full_name
    if payload.language:
        user.language = payload.language
    user.updated_at = datetime.now(timezone.utc)
    return user.to_public_dict()


@router.get("/health")
def auth_health() -> dict[str, str]:
    return {"status": "ok", "service": "auth"}
