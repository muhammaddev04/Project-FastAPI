from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.modules.identity.schemas import Language, MeResponse, OrgType

# CR-001: one canonical email form everywhere - trimmed, then lowercased (matches the unique index on lower(email)).
NormalizedEmail = Annotated[
    EmailStr,
    BeforeValidator(lambda value: value.strip() if isinstance(value, str) else value),
    AfterValidator(str.lower),
    Field(max_length=254),
]


class RegisterRequest(BaseModel):
    """P01 §6 `POST /auth/register`: `{email, password, full_name, language}` (CR-001), plus the optional onboarding
    intent the P01 §10 registration screen collects (`org_type`, `org_name`). The intent is only remembered for
    `/welcome/company|store` after the first sign-in (ORG-001); registration never creates an organization.
    """

    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail
    # The IAM-003 policy (8-128, letter + digit, not common) is applied by the service as `weak_password`;
    # this bound only keeps absurd inputs away from the password hasher.
    password: str = Field(max_length=1024)
    full_name: str = Field(min_length=2, max_length=150)
    language: Language
    org_type: OrgType | None = None
    org_name: str | None = Field(default=None, min_length=2, max_length=200)

    @field_validator("full_name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("full_name too short")
        return value

    @field_validator("org_name")
    @classmethod
    def _strip_org_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("org_name too short")
        return value

    @model_validator(mode="after")
    def _name_needs_type(self) -> RegisterRequest:
        if self.org_name is not None and self.org_type is None:
            raise ValueError("org_name needs org_type")
        return self


class VerifyEmailRequest(BaseModel):
    """`POST /auth/email/verify`: `{email, code}` - the 6-digit code from the verification email (IAM-002, owner
    change: a code instead of a link).

    The email names whose pending code this is: verification happens before sign-in, so there is no session, and a
    bare 6-digit code must never be matched against every user's codes.
    """

    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail
    code: str = Field(pattern=r"^[0-9]{6}$")


class ResendVerificationRequest(BaseModel):
    """P01 §6 `POST /auth/email/resend`: `{email}` (CR-001)."""

    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail


class PasswordResetStartRequest(BaseModel):
    """P01 §6 `POST /auth/password/reset/start`: `{email}` (IAM-015)."""

    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail


class PasswordResetVerifyRequest(BaseModel):
    """`POST /auth/password/reset/verify`: `{email, code}` - the 6-digit code from the reset email (IAM-015, owner
    change: a code instead of a link). The email names whose code it is; a bare code is never matched globally."""

    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail
    code: str = Field(pattern=r"^[0-9]{6}$")


class PasswordResetVerifyResponse(BaseModel):
    """The one-time reset authorization for `password/reset/complete`: 256 bits, 10 minutes, returned only here."""

    reset_token: str
    expires_in: int


class PasswordResetCompleteRequest(BaseModel):
    """P01 §6 `POST /auth/password/reset/complete`: `{token, new_password}` (IAM-015). `token` is the
    `reset_token` from `password/reset/verify`; the 6-digit code itself is never accepted here."""

    model_config = ConfigDict(extra="forbid")

    # Issued tokens are 43 URL-safe characters; anything malformed simply never matches a stored hash.
    token: str = Field(min_length=1, max_length=512)
    # The IAM-003 policy is applied by the service as `weak_password`; this bound only protects the hasher.
    new_password: str = Field(max_length=1024)


class PasswordChangeRequest(BaseModel):
    """P01 §6 `POST /auth/password/change` (access): `{current_password, new_password}` (IAM-008)."""

    model_config = ConfigDict(extra="forbid")

    # Presence only: checked against the stored hash, never against the policy (like the login password).
    current_password: str = Field(min_length=1, max_length=1024)
    # The IAM-003 policy is applied by the service as `weak_password`; this bound only protects the hasher.
    new_password: str = Field(max_length=1024)


class GoogleCallbackRequest(BaseModel):
    """`POST /auth/google/callback`: the `code` and `state` Google returned to the frontend callback page."""

    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=2048)
    state: str = Field(min_length=1, max_length=512)


class GoogleLinkStartResponse(BaseModel):
    """`POST /auth/google/link/start`: where to send the browser; the binding cookie is set on this response."""

    authorization_url: str


class GoogleLinkOut(BaseModel):
    """The signed-in user's Google connection (`GET /auth/google/link`, `POST /auth/google/link/callback`)."""

    connected: bool
    status: Literal["linked", "already_linked"] | None = None
    email: str | None = None
    linked_at: datetime | None = None


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
