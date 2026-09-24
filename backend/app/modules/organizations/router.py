from __future__ import annotations

from fastapi import APIRouter, status

from app.modules.identity.deps import CurrentUser, SessionDep
from app.modules.organizations import service
from app.modules.organizations.schemas import OrganizationCreate, OrganizationCreated

router = APIRouter(prefix="/api/v1/organizations", tags=["organizations"])


@router.post(
    "/companies",
    response_model=OrganizationCreated,
    status_code=status.HTTP_201_CREATED,
    summary="Create a Company; the caller becomes its OWNER",
)
async def create_company(payload: OrganizationCreate, session: SessionDep, user: CurrentUser) -> OrganizationCreated:
    return await service.create_organization(session, user, "COMPANY", payload)


@router.post(
    "/stores",
    response_model=OrganizationCreated,
    status_code=status.HTTP_201_CREATED,
    summary="Create a Store; the caller becomes its OWNER",
)
async def create_store(payload: OrganizationCreate, session: SessionDep, user: CurrentUser) -> OrganizationCreated:
    return await service.create_organization(session, user, "STORE", payload)
