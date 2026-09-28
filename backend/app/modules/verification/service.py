"""P02 verification (§1.4, §2.1, VER-001..006).

Submitting information is not verification. An organization OWNER submits a request with the required documents
(`NOT_SUBMITTED`/`REJECTED` -> `PENDING`); only a SUPERADMIN moves it on (`SUBMITTED -> UNDER_REVIEW ->
APPROVED | REJECTED`), after checking the documents and the legal snapshot against real-world sources. Nothing here
approves anything automatically. Every transition is audited as `verification.<status>`.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.errors import AppError
from app.core.pagination import PageParams, fetch_page
from app.core.storage import SignedUrl, get_storage
from app.core.time import utcnow
from app.modules.files.models import StoredFile
from app.modules.files.service import file_out, get_owned
from app.modules.identity.deps import OrgContext
from app.modules.identity.models import Organization, User
from app.modules.organizations.models import Company, Store
from app.modules.organizations.service import load_profile, profile_out
from app.modules.verification.models import VerificationDocument, VerificationRequest
from app.modules.verification.schemas import (
    AdminRequestDetail,
    AdminRequestPage,
    AdminRequestSummary,
    DocumentOut,
    HistoryItem,
    RequestOut,
    VerificationState,
    VerificationSubmit,
)

# VER-003: documents each organization type must attach.
REQUIRED_DOCUMENTS: dict[str, tuple[str, ...]] = {
    "COMPANY": ("REGISTRATION_CERTIFICATE", "TAX_CERTIFICATE"),
    "STORE": ("REGISTRATION_CERTIFICATE",),
}
OPEN_STATUSES = ("SUBMITTED", "UNDER_REVIEW")
MIN_REJECTION_REASON = 10


def _legal_snapshot(profile: Company | Store) -> dict[str, Any]:
    """P02 §1.4: what the reviewer verifies, frozen at submission."""
    return {"legal_name": profile.legal_name, "tax_identifier": profile.tax_identifier, "address": profile.address}


async def _files(session: AsyncSession, request: VerificationRequest) -> dict[UUID, StoredFile]:
    ids = [document.file_id for document in request.documents]
    if not ids:
        return {}
    rows = (await session.scalars(select(StoredFile).where(StoredFile.id.in_(ids)))).all()
    return {row.id: row for row in rows}


async def _documents_out(session: AsyncSession, request: VerificationRequest) -> list[DocumentOut]:
    files = await _files(session, request)
    return [
        DocumentOut(id=document.id, doc_type=document.doc_type, file=file_out(files[document.file_id]))  # type: ignore[arg-type]
        for document in request.documents
    ]


async def _request_out(session: AsyncSession, request: VerificationRequest) -> RequestOut:
    return RequestOut(
        id=request.id,
        status=request.status,  # type: ignore[arg-type]
        submitted_at=request.submitted_at,
        review_started_at=request.review_started_at,
        reviewed_at=request.reviewed_at,
        rejection_reason=request.rejection_reason,
        documents=await _documents_out(session, request),
    )


async def _latest(session: AsyncSession, organization_id: UUID) -> VerificationRequest | None:
    return await session.scalar(
        select(VerificationRequest)
        .where(VerificationRequest.organization_id == organization_id)
        .order_by(VerificationRequest.submitted_at.desc())
        .limit(1)
    )


def _can_submit(organization: Organization, profile: Company | Store) -> bool:
    return organization.status == "ACTIVE" and profile.verification_status in ("NOT_SUBMITTED", "REJECTED")


# --- organization side ---------------------------------------------------------------------------------------------


async def get_state(session: AsyncSession, context: OrgContext) -> VerificationState:
    """P02 §5 `GET /verification` (`verification.view`)."""
    organization = context.organization
    profile = await load_profile(session, organization)
    latest = await _latest(session, organization.id)
    return VerificationState(
        verification_status=profile.verification_status,  # type: ignore[arg-type]
        verified_at=profile.verified_at,
        required_documents=list(REQUIRED_DOCUMENTS[organization.type]),  # type: ignore[arg-type]
        can_submit=_can_submit(organization, profile),
        latest_request=await _request_out(session, latest) if latest else None,
    )


async def submit(session: AsyncSession, context: OrgContext, payload: VerificationSubmit) -> VerificationState:
    """P02 §2.1 `— -> SUBMITTED` (VER-001 OWNER only via `verification.submit`, VER-003 required documents)."""
    organization = context.organization
    if organization.status != "ACTIVE":
        raise AppError("organization_blocked", 403)
    model: type[Company] | type[Store] = Company if organization.type == "COMPANY" else Store
    # Lock the profile row: concurrent submissions for one organization are serialized here.
    profile = await session.get(model, organization.id, with_for_update=True, populate_existing=True)
    if profile is None:
        raise AppError("not_found", 404)
    if profile.verification_status == "APPROVED":
        raise AppError("verification_not_editable", 409)
    if profile.verification_status == "PENDING":
        raise AppError("invalid_transition", 409, {"reason": "open_request"})

    file_ids = [document.file_id for document in payload.documents]
    if len(set(file_ids)) != len(file_ids):
        raise AppError(
            "validation_error", 422, {"fields": [{"field": "documents", "code": "duplicate_file", "message": ""}]}
        )
    present = {document.doc_type for document in payload.documents}
    missing = [doc_type for doc_type in REQUIRED_DOCUMENTS[organization.type] if doc_type not in present]
    if missing:
        raise AppError("verification_documents_missing", 422, {"missing": missing})
    for document in payload.documents:
        stored = await get_owned(session, organization.id, document.file_id)  # another org's file -> 404
        if stored.category != "VERIFICATION":
            raise AppError(
                "validation_error", 422, {"fields": [{"field": "documents", "code": "wrong_category", "message": ""}]}
            )

    now = utcnow()
    request = VerificationRequest(
        organization_id=organization.id,
        status="SUBMITTED",
        submitted_by=context.user.id,
        submitted_at=now,
        legal_snapshot=_legal_snapshot(profile),
    )
    session.add(request)
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:  # the partial unique index: another open request slipped in
        raise AppError("invalid_transition", 409, {"reason": "open_request"}) from exc
    for document in payload.documents:
        session.add(VerificationDocument(request_id=request.id, doc_type=document.doc_type, file_id=document.file_id))
    previous = profile.verification_status
    profile.verification_status = "PENDING"
    profile.verified_at = None
    profile.version += 1
    await session.flush()
    await session.refresh(request, ["documents"])
    await audit.record(
        session,
        "verification.submitted",
        "verification_request",
        request.id,
        actor_id=context.user.id,
        org_id=organization.id,
        old={"verification_status": previous},
        new={
            "verification_status": "PENDING",
            "request_status": "SUBMITTED",
            "documents": sorted(document.doc_type for document in payload.documents),
        },
    )
    return await get_state(session, context)


async def ensure_approved(session: AsyncSession, organization: Organization, side: Literal["company", "store"]) -> None:
    """VER-006 / DEC-19 / PRT-003: operations that need a verified organization call this server-side.
    Raises `organization_not_verified` (409, `details.side`) unless the organization is APPROVED."""
    profile = await load_profile(session, organization)
    if profile.verification_status != "APPROVED":
        raise AppError("organization_not_verified", 409, {"side": side})


async def has_open_request(session: AsyncSession, organization_id: UUID) -> bool:
    found = await session.scalar(
        select(VerificationRequest.id).where(
            VerificationRequest.organization_id == organization_id, VerificationRequest.status.in_(OPEN_STATUSES)
        )
    )
    return found is not None


# --- SUPERADMIN review ----------------------------------------------------------------------------------------------


async def _locked_request(session: AsyncSession, request_id: UUID) -> VerificationRequest:
    request = await session.get(VerificationRequest, request_id, with_for_update=True, populate_existing=True)
    if request is None:
        raise AppError("not_found", 404)
    return request


async def _organization(session: AsyncSession, organization_id: UUID) -> Organization:
    organization = await session.get(Organization, organization_id)
    if organization is None:
        raise AppError("not_found", 404)
    return organization


async def list_requests(
    session: AsyncSession,
    *,
    status: str | None,
    org_type: str | None,
    ordering: str,
    page: PageParams,
) -> AdminRequestPage:
    """`GET /admin/verifications`: filter by `status`, `org_type`; ordered by `submitted_at` (FND-009 page)."""
    query = select(VerificationRequest, Organization).join(
        Organization, Organization.id == VerificationRequest.organization_id
    )
    if status:
        query = query.where(VerificationRequest.status == status)
    if org_type:
        query = query.where(Organization.type == org_type)
    order = VerificationRequest.submitted_at.desc() if ordering == "-submitted_at" else VerificationRequest.submitted_at
    count, rows = await fetch_page(session, query, page, order_by=[order], tie_breaker=VerificationRequest.id)
    return AdminRequestPage.of(
        page,
        count,
        [
            AdminRequestSummary(
                id=request.id,
                organization_id=organization.id,
                org_type=organization.type,  # type: ignore[arg-type]
                org_name=organization.name,
                status=request.status,  # type: ignore[arg-type]
                submitted_at=request.submitted_at,
                reviewer_id=request.reviewer_id,
                reviewed_at=request.reviewed_at,
            )
            for request, organization in rows.all()
        ],
    )


async def get_request(session: AsyncSession, request_id: UUID) -> AdminRequestDetail:
    """`GET /admin/verifications/{id}`: the snapshot, documents, the live profile and earlier requests."""
    request = await session.get(VerificationRequest, request_id)
    if request is None:
        raise AppError("not_found", 404)
    organization = await _organization(session, request.organization_id)
    profile = await load_profile(session, organization)
    earlier = (
        await session.scalars(
            select(VerificationRequest)
            .where(VerificationRequest.organization_id == organization.id, VerificationRequest.id != request.id)
            .order_by(VerificationRequest.submitted_at.desc())
        )
    ).all()
    live = profile_out(organization, profile).model_dump(mode="json")
    return AdminRequestDetail(
        id=request.id,
        organization_id=organization.id,
        org_type=organization.type,  # type: ignore[arg-type]
        org_name=organization.name,
        status=request.status,  # type: ignore[arg-type]
        submitted_at=request.submitted_at,
        reviewer_id=request.reviewer_id,
        reviewed_at=request.reviewed_at,
        submitted_by=request.submitted_by,
        review_started_at=request.review_started_at,
        rejection_reason=request.rejection_reason,
        legal_snapshot=request.legal_snapshot,
        current_profile={
            key: live[key]
            for key in (
                "name",
                "legal_name",
                "tax_identifier",
                "phone",
                "email",
                "city",
                "address",
                "latitude",
                "longitude",
                "public_code",
            )
        },
        org_verification_status=profile.verification_status,  # type: ignore[arg-type]
        documents=await _documents_out(session, request),
        history=[
            HistoryItem(
                id=item.id,
                status=item.status,  # type: ignore[arg-type]
                submitted_at=item.submitted_at,
                reviewed_at=item.reviewed_at,
                rejection_reason=item.rejection_reason,
            )
            for item in earlier
        ],
        version=request.version,
    )


async def _transition_audit(
    session: AsyncSession,
    request: VerificationRequest,
    admin: User,
    old_status: str,
    *,
    org_old: str | None = None,
    org_new: str | None = None,
    reason: str | None = None,
) -> None:
    old: dict[str, Any] = {"request_status": old_status}
    new: dict[str, Any] = {"request_status": request.status}
    if org_old is not None:
        old["verification_status"], new["verification_status"] = org_old, org_new
    await audit.record(
        session,
        f"verification.{request.status.lower()}",
        "verification_request",
        request.id,
        actor_id=admin.id,
        org_id=request.organization_id,
        old=old,
        new=new,
        reason=reason,
    )


async def start_review(session: AsyncSession, request_id: UUID, admin: User) -> AdminRequestDetail:
    """P02 §2.1 `SUBMITTED -> UNDER_REVIEW`: the admin becomes the reviewer."""
    request = await _locked_request(session, request_id)
    if request.status != "SUBMITTED":
        raise AppError("invalid_transition", 409, {"status": request.status})
    request.status = "UNDER_REVIEW"
    request.reviewer_id = admin.id
    request.review_started_at = utcnow()
    request.version += 1
    await session.flush()
    await _transition_audit(session, request, admin, "SUBMITTED")
    return await get_request(session, request.id)


async def approve(session: AsyncSession, request_id: UUID, admin: User) -> AdminRequestDetail:
    """P02 §2.1 `UNDER_REVIEW -> APPROVED` by the same reviewer; the organization becomes APPROVED."""
    request = await _locked_request(session, request_id)
    if request.status != "UNDER_REVIEW":
        raise AppError("invalid_transition", 409, {"status": request.status})
    if request.reviewer_id != admin.id:
        raise AppError("permission_denied", 403, {"reason": "not_the_reviewer"})
    organization = await _organization(session, request.organization_id)
    profile = await load_profile(session, organization)
    now = utcnow()
    request.status = "APPROVED"
    request.reviewed_at = now
    request.version += 1
    org_old = profile.verification_status
    profile.verification_status = "APPROVED"
    profile.verified_at = now
    profile.version += 1
    await session.flush()
    await _transition_audit(session, request, admin, "UNDER_REVIEW", org_old=org_old, org_new="APPROVED")
    return await get_request(session, request.id)


async def reject(session: AsyncSession, request_id: UUID, admin: User, reason: str) -> AdminRequestDetail:
    """P02 §2.1 `UNDER_REVIEW -> REJECTED` with a reason (≥ 10 characters) the organization will see."""
    if len(reason) < MIN_REJECTION_REASON:
        raise AppError("rejection_reason_required", 422, {"min_length": MIN_REJECTION_REASON})
    request = await _locked_request(session, request_id)
    if request.status != "UNDER_REVIEW":
        raise AppError("invalid_transition", 409, {"status": request.status})
    organization = await _organization(session, request.organization_id)
    profile = await load_profile(session, organization)
    request.status = "REJECTED"
    request.reviewed_at = utcnow()
    request.rejection_reason = reason
    request.version += 1
    org_old = profile.verification_status
    profile.verification_status = "REJECTED"
    profile.verified_at = None
    profile.version += 1
    await session.flush()
    await _transition_audit(session, request, admin, "UNDER_REVIEW", org_old=org_old, org_new="REJECTED", reason=reason)
    return await get_request(session, request.id)


async def document_url(session: AsyncSession, request_id: UUID, document_id: UUID, admin: User) -> SignedUrl:
    """VER-004: a SUPERADMIN opens a verification document through a 5-minute signed URL; every access is audited."""
    document = await session.scalar(
        select(VerificationDocument).where(
            VerificationDocument.id == document_id, VerificationDocument.request_id == request_id
        )
    )
    if document is None:
        raise AppError("not_found", 404)
    stored = await session.get(StoredFile, document.file_id)
    request = await session.get(VerificationRequest, request_id)
    if stored is None or request is None:
        raise AppError("not_found", 404)
    await audit.record(
        session,
        "verification.document_viewed",
        "verification_document",
        document.id,
        actor_id=admin.id,
        org_id=request.organization_id,
        new={"request_id": str(request_id), "doc_type": document.doc_type},
    )
    return await get_storage().signed_url(stored.storage_key)
