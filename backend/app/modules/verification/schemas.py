from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.pagination import Page
from app.modules.files.schemas import FileOut

DocType = Literal["REGISTRATION_CERTIFICATE", "TAX_CERTIFICATE", "OTHER"]
RequestStatus = Literal["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"]
OrgVerificationStatus = Literal["NOT_SUBMITTED", "PENDING", "APPROVED", "REJECTED"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DocumentIn(_Strict):
    doc_type: DocType
    file_id: UUID


class VerificationSubmit(_Strict):
    """P02 §5 `POST /verification`: `{documents: [{doc_type, file_id}]}` (VER-001, VER-003)."""

    documents: list[DocumentIn] = Field(min_length=1, max_length=10)


class RejectIn(_Strict):
    """`POST /admin/verifications/{id}/reject`: the reason is shown to the organization (≥ 10 characters)."""

    reason: str = Field(max_length=2000)

    @field_validator("reason")
    @classmethod
    def _strip(cls, value: str) -> str:
        return " ".join(value.split())


class DocumentOut(BaseModel):
    id: UUID
    doc_type: DocType
    file: FileOut


class RequestOut(BaseModel):
    """One verification request as its organization sees it (no reviewer identity)."""

    id: UUID
    status: RequestStatus
    submitted_at: datetime
    review_started_at: datetime | None
    reviewed_at: datetime | None
    rejection_reason: str | None
    documents: list[DocumentOut]


class VerificationState(BaseModel):
    """P02 §5 `GET /verification`: current state + latest request + documents."""

    verification_status: OrgVerificationStatus
    verified_at: datetime | None
    required_documents: list[DocType]
    can_submit: bool
    latest_request: RequestOut | None


class AdminRequestSummary(BaseModel):
    id: UUID
    organization_id: UUID
    org_type: Literal["COMPANY", "STORE"]
    org_name: str
    status: RequestStatus
    submitted_at: datetime
    reviewer_id: UUID | None
    reviewed_at: datetime | None


class AdminRequestPage(Page[AdminRequestSummary]):
    """API-002 pagination envelope (FND-009)."""


class HistoryItem(BaseModel):
    id: UUID
    status: RequestStatus
    submitted_at: datetime
    reviewed_at: datetime | None
    rejection_reason: str | None


class AdminRequestDetail(AdminRequestSummary):
    """`GET /admin/verifications/{id}`: with legal_snapshot, documents and the organization's earlier requests."""

    submitted_by: UUID
    review_started_at: datetime | None
    rejection_reason: str | None
    legal_snapshot: dict[str, Any]
    current_profile: dict[str, Any]
    org_verification_status: OrgVerificationStatus
    documents: list[DocumentOut]
    history: list[HistoryItem]
    version: int
