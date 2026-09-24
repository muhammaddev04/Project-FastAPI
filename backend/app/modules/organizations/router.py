from __future__ import annotations

from fastapi import APIRouter, status

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
