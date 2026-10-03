from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Response, status

from app.core.idempotency import IdempotentRoute, idempotent
from app.modules.files.schemas import SignedUrlOut
from app.modules.identity.deps import SessionDep, SuperadminDep, require_permission
from app.modules.verification import service
from app.modules.verification.filters import QueueQuery
from app.modules.verification.schemas import (
    AdminRequestDetail,
    AdminRequestPage,
    RejectIn,
    VerificationState,
    VerificationSubmit,
)

router = APIRouter(prefix="/api/v1", tags=["verification"], route_class=IdempotentRoute)
admin_router = APIRouter(prefix="/api/v1/admin/verifications", tags=["admin"])

VerificationViewer = require_permission("verification.view")
VerificationSubmitter = require_permission("verification.submit")

_ADMIN_ERRORS = {
    401: {"description": "`not_authenticated` / `token_invalid` / `token_expired`."},
    403: {"description": "`permission_denied`: SUPERADMIN only (no `X-Org-Id` needed)."},
    404: {"description": "`not_found`."},
}


@router.get(
    "/verification",
    response_model=VerificationState,
    summary="Verification state of the active organization with its latest request (verification.view)",
)
async def get_verification(session: SessionDep, context: VerificationViewer) -> VerificationState:  # type: ignore[valid-type]
    return await service.get_state(session, context)  # type: ignore[arg-type]


@router.post(
    "/verification",
    dependencies=[idempotent(permission="verification.submit")],
    response_model=VerificationState,
    status_code=status.HTTP_201_CREATED,
    summary="Submit the organization for verification with the required documents (OWNER, VER-001/003)",
    responses={
        400: {"description": "`idempotency_key_required` or `org_context_required`."},
        403: {"description": "`permission_denied` (not OWNER) or `organization_blocked`."},
        404: {"description": "`not_found`: a file of another organization."},
        409: {
            "description": (
                "`invalid_transition`, `verification_not_editable`, `idempotency_key_reused` or `request_in_progress`."
            )
        },
        422: {"description": "`verification_documents_missing` (`details.missing`) or `validation_error`."},
    },
)
async def submit_verification(
    payload: VerificationSubmit,
    session: SessionDep,
    context: VerificationSubmitter,  # type: ignore[valid-type]
) -> VerificationState:
    return await service.submit(session, context, payload)  # type: ignore[arg-type]


@admin_router.get(
    "", response_model=AdminRequestPage, summary="Verification queue (SUPERADMIN)", responses=_ADMIN_ERRORS
)
async def list_verifications(
    session: SessionDep,
    _admin: SuperadminDep,
    query: Annotated[QueueQuery, Query()],
) -> AdminRequestPage:
    return await service.list_requests(session, query)


@admin_router.get(
    "/{request_id}",
    response_model=AdminRequestDetail,
    summary="One request with its legal snapshot, documents and history (SUPERADMIN)",
    responses=_ADMIN_ERRORS,
)
async def get_verification_request(request_id: UUID, session: SessionDep, _admin: SuperadminDep) -> AdminRequestDetail:
    return await service.get_request(session, request_id)


@admin_router.post(
    "/{request_id}/start-review",
    response_model=AdminRequestDetail,
    summary="SUBMITTED -> UNDER_REVIEW; the caller becomes the reviewer (SUPERADMIN)",
    responses={**_ADMIN_ERRORS, 409: {"description": "`invalid_transition`."}},
)
async def start_review(request_id: UUID, session: SessionDep, admin: SuperadminDep) -> AdminRequestDetail:
    return await service.start_review(session, request_id, admin)


@admin_router.post(
    "/{request_id}/approve",
    response_model=AdminRequestDetail,
    summary="UNDER_REVIEW -> APPROVED by the same reviewer; the organization becomes APPROVED (SUPERADMIN)",
    responses={**_ADMIN_ERRORS, 409: {"description": "`invalid_transition`."}},
)
async def approve(request_id: UUID, session: SessionDep, admin: SuperadminDep) -> AdminRequestDetail:
    return await service.approve(session, request_id, admin)


@admin_router.post(
    "/{request_id}/reject",
    response_model=AdminRequestDetail,
    summary="UNDER_REVIEW -> REJECTED with a reason (≥ 10 characters) shown to the organization (SUPERADMIN)",
    responses={
        **_ADMIN_ERRORS,
        409: {"description": "`invalid_transition`."},
        422: {"description": "`rejection_reason_required`."},
    },
)
async def reject(request_id: UUID, payload: RejectIn, session: SessionDep, admin: SuperadminDep) -> AdminRequestDetail:
    return await service.reject(session, request_id, admin, payload.reason)


@admin_router.get(
    "/{request_id}/documents/{document_id}/url",
    response_model=SignedUrlOut,
    summary="5-minute signed URL for a verification document; each access is audited (SUPERADMIN, VER-004)",
    responses=_ADMIN_ERRORS,
)
async def document_url(
    request_id: UUID, document_id: UUID, session: SessionDep, admin: SuperadminDep, response: Response
) -> SignedUrlOut:
    signed = await service.document_url(session, request_id, document_id, admin)
    response.headers["Cache-Control"] = "no-store"
    return SignedUrlOut(url=signed.url, expires_at=signed.expires_at)
