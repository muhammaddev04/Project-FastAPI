from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, UploadFile, status

from app.modules.identity.deps import CurrentUser, SessionDep, require_permission
from app.modules.organizations import service
from app.modules.organizations.schemas import (
    CompanyCreate,
    OrganizationCreated,
    OrganizationProfile,
    OrganizationUpdate,
    StoreCreate,
)

router = APIRouter(prefix="/api/v1", tags=["organizations"])

OrgViewer = require_permission("org.view")
# CR-003: company logo / store image - OWNER only (ORG-006 does not list it among the MANAGER-editable fields).
BrandingEditor = require_permission("org.edit_branding")


@router.post(
    "/organizations/companies",
    response_model=OrganizationCreated,
    status_code=status.HTTP_201_CREATED,
    summary="Create a Company with its profile; the caller becomes OWNER (ORG-001)",
)
async def create_company(payload: CompanyCreate, session: SessionDep, user: CurrentUser) -> OrganizationCreated:
    return await service.create_organization(session, user, "COMPANY", payload)


@router.post(
    "/organizations/stores",
    response_model=OrganizationCreated,
    status_code=status.HTTP_201_CREATED,
    summary="Create a Store with its profile; the caller becomes OWNER (ORG-002)",
)
async def create_store(payload: StoreCreate, session: SessionDep, user: CurrentUser) -> OrganizationCreated:
    return await service.create_organization(session, user, "STORE", payload)


@router.get(
    "/organization", response_model=OrganizationProfile, summary="Profile of the active organization (X-Org-Id)"
)
async def get_organization(session: SessionDep, context: OrgViewer) -> OrganizationProfile:  # type: ignore[valid-type]
    return await service.get_profile(session, context)


@router.patch("/organization", response_model=OrganizationProfile, summary="Edit the active organization's profile")
async def patch_organization(
    payload: OrganizationUpdate,
    session: SessionDep,
    context: OrgViewer,  # type: ignore[valid-type]
) -> OrganizationProfile:
    return await service.update_profile(session, context, payload)


@router.put(
    "/organization/logo",
    response_model=OrganizationProfile,
    summary="Upload or replace the active organization's logo (JPEG/PNG/WebP <= 5 MB; WebP <= 512x512, CR-003)",
)
async def put_logo(
    file: Annotated[UploadFile, File()],
    session: SessionDep,
    context: BrandingEditor,  # type: ignore[valid-type]
) -> OrganizationProfile:
    return await service.set_logo(session, context, file)


@router.delete(
    "/organization/logo", response_model=OrganizationProfile, summary="Remove the active organization's logo (CR-003)"
)
async def delete_logo(session: SessionDep, context: BrandingEditor) -> OrganizationProfile:  # type: ignore[valid-type]
    return await service.remove_logo(session, context)
