from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.modules.identity.schemas import Language


class RegisterRequest(BaseModel):
    """P01 §6 `POST /auth/register`: `{email, password, full_name, language}` (CR-001).

    The organization type/name the registration screen collects are used later by `/welcome` (ORG-001),
    so they are not part of this contract.
    """

    model_config = ConfigDict(extra="forbid")

    email: EmailStr = Field(max_length=254)
    # The IAM-003 policy (8-128, letter + digit, not common) is applied by the service as `weak_password`;
    # this bound only keeps absurd inputs away from the password hasher.
    password: str = Field(max_length=1024)
    full_name: str = Field(min_length=2, max_length=150)
    language: Language

    @field_validator("email", mode="before")
    @classmethod
    def _strip_email(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        # CR-001: one canonical form everywhere (matches the unique index on lower(email)).
        return value.lower()

    @field_validator("full_name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("full_name too short")
        return value
