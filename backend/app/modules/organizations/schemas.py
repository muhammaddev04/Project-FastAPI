from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.modules.identity.schemas import MembershipOut, OrgType


class OrganizationCreate(BaseModel):
    """P01 minimum for onboarding. P02 extends this contract with the legal profile (ORG-001/ORG-002)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=2, max_length=200)


class OrganizationOut(BaseModel):
    id: UUID
    type: OrgType
    name: str
    status: str


class OrganizationCreated(BaseModel):
    organization: OrganizationOut
    membership: MembershipOut
