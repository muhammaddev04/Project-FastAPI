from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

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
