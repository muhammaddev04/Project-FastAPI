from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, EmailStr, Field, field_validator

from app.modules.identity.schemas import Language, MeResponse

# CR-001: one canonical email form everywhere - trimmed, then lowercased (matches the unique index on lower(email)).
NormalizedEmail = Annotated[
    EmailStr,
    BeforeValidator(lambda value: value.strip() if isinstance(value, str) else value),
    AfterValidator(str.lower),
    Field(max_length=254),
]


class RegisterRequest(BaseModel):
    """P01 §6 `POST /auth/register`: `{email, password, full_name, language}` (CR-001).

    The organization type/name the registration screen collects are used later by `/welcome` (ORG-001),
    so they are not part of this contract.
    """

    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail
    # The IAM-003 policy (8-128, letter + digit, not common) is applied by the service as `weak_password`;
    # this bound only keeps absurd inputs away from the password hasher.
    password: str = Field(max_length=1024)
    full_name: str = Field(min_length=2, max_length=150)
    language: Language

    @field_validator("full_name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("full_name too short")
        return value


class VerifyEmailRequest(BaseModel):
    """P01 §6 `POST /auth/email/verify`: `{token}` from the email link (IAM-002)."""

    model_config = ConfigDict(extra="forbid")

    # Issued tokens are 43 URL-safe characters; anything malformed simply never matches a stored hash.
    token: str = Field(min_length=1, max_length=512)


class ResendVerificationRequest(BaseModel):
    """P01 §6 `POST /auth/email/resend`: `{email}` (CR-001)."""

    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail


class PasswordResetStartRequest(BaseModel):
    """P01 §6 `POST /auth/password/reset/start`: `{email}` (IAM-015)."""

    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail


class PasswordResetCompleteRequest(BaseModel):
    """P01 §6 `POST /auth/password/reset/complete`: `{token, new_password}` (IAM-015)."""

    model_config = ConfigDict(extra="forbid")

    # Issued tokens are 43 URL-safe characters; anything malformed simply never matches a stored hash.
    token: str = Field(min_length=1, max_length=512)
    # The IAM-003 policy is applied by the service as `weak_password`; this bound only protects the hasher.
    new_password: str = Field(max_length=1024)


class LoginRequest(BaseModel):
    """P01 §6 `POST /auth/login`: `{email, password}` (F-1.2, CR-001)."""

    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail
    # Presence only: the password is checked against the stored hash, never against the policy (IAM-004).
    password: str = Field(min_length=1, max_length=1024)


class LoginResponse(BaseModel):
    """P01 §6: `{access_token, expires_in, user}`; the refresh token travels only in its httpOnly cookie (SEC-004).

    `user` is the same object `GET /me` returns.
    """

    access_token: str
    expires_in: int
    user: MeResponse


class RefreshResponse(BaseModel):
    """P01 §6 `POST /auth/refresh`: the new access token; the new refresh token travels only in its cookie."""

    access_token: str
    expires_in: int
