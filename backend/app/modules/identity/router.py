from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, File, Query, UploadFile

from app.modules.identity import service
from app.modules.identity.deps import CurrentUser, SessionDep, require_permission
from app.modules.identity.schemas import MemberPage, MeResponse, MeUpdateRequest

router = APIRouter(prefix="/api/v1", tags=["identity"])

MembersViewer = require_permission("members.view")


@router.get("/me", response_model=MeResponse, summary="Current user with memberships and permissions")
async def get_me(session: SessionDep, user: CurrentUser) -> MeResponse:
    return await service.build_me(session, user)


@router.patch("/me", response_model=MeResponse, summary="Update own name or language")
async def patch_me(payload: MeUpdateRequest, session: SessionDep, user: CurrentUser) -> MeResponse:
    return await service.update_me(session, user, payload)


@router.put(
    "/me/avatar",
    response_model=MeResponse,
    summary="Upload or replace own avatar (JPEG/PNG/WebP <= 5 MB; stored as WebP <= 512x512, CR-003)",
)
async def put_avatar(file: Annotated[UploadFile, File()], session: SessionDep, user: CurrentUser) -> MeResponse:
    return await service.set_avatar(session, user, file)


@router.delete("/me/avatar", response_model=MeResponse, summary="Remove own avatar (idempotent, CR-003)")
async def delete_avatar(session: SessionDep, user: CurrentUser) -> MeResponse:
    return await service.remove_avatar(session, user)


@router.get("/members", response_model=MemberPage, summary="Members of the active organization (members.view)")
async def get_members(
    session: SessionDep,
    context: MembersViewer,  # type: ignore[valid-type]
    role: Annotated[Literal["OWNER", "MANAGER", "OPERATOR", "WAREHOUSE", "COURIER", "SELLER"] | None, Query()] = None,
    status: Annotated[Literal["ACTIVE", "SUSPENDED", "REVOKED"] | None, Query()] = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> MemberPage:
    return await service.list_members(
        session, context.organization.id, role=role, status=status, search=search, limit=limit, offset=offset
    )
