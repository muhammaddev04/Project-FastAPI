from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response

from app.core.idempotency import IdempotentRoute, idempotent
from app.core.pagination import PageParamsDep
from app.modules.identity import team_service as service
from app.modules.identity.deps import CurrentUser, OrgContext, OrgContextDep, SessionDep, require_permission
from app.modules.identity.schemas import (
    InvitationCreate,
    InvitationOut,
    InvitationPage,
    MemberOut,
    MembershipOut,
    MembershipReason,
    RoleChange,
)

router = APIRouter(prefix="/api/v1", tags=["team"], route_class=IdempotentRoute)
Inviter = Annotated[OrgContext, Depends(require_permission("members.invite"))]
Viewer = Annotated[OrgContext, Depends(require_permission("members.view"))]
RoleEditor = Annotated[OrgContext, Depends(require_permission("members.change_role"))]
Suspender = Annotated[OrgContext, Depends(require_permission("members.suspend"))]
Revoker = Annotated[OrgContext, Depends(require_permission("members.revoke"))]


@router.get("/me/invitations", response_model=InvitationPage, summary="Pending unexpired invitations for my email")
async def my_invitations(session: SessionDep, user: CurrentUser, page: PageParamsDep) -> InvitationPage:
    return await service.list_invitations(session, page, email=user.email)


@router.post(
    "/me/invitations/{invitation_id}/accept",
    dependencies=[idempotent()],
    response_model=MembershipOut,
    summary="Accept invitation and join the organization",
)
async def accept_invitation(invitation_id: UUID, session: SessionDep, user: CurrentUser) -> MembershipOut:
    result = await service.respond(session, user, invitation_id, True)
    assert isinstance(result, MembershipOut)
    return result


@router.post("/me/invitations/{invitation_id}/decline", response_model=InvitationOut, summary="Decline my invitation")
async def decline_invitation(invitation_id: UUID, session: SessionDep, user: CurrentUser) -> InvitationOut:
    result = await service.respond(session, user, invitation_id, False)
    assert isinstance(result, InvitationOut)
    return result


@router.post(
    "/members/invitations",
    dependencies=[idempotent()],
    response_model=InvitationOut,
    status_code=201,
    summary="Invite an organization member by email (OWNER)",
)
async def create_invitation(payload: InvitationCreate, session: SessionDep, context: Inviter) -> InvitationOut:
    return await service.invite(session, context, payload)


@router.get("/members/invitations", response_model=InvitationPage, summary="Organization invitation history")
async def invitations(session: SessionDep, context: Viewer, page: PageParamsDep) -> InvitationPage:
    return await service.list_invitations(session, page, org_id=context.organization.id)


@router.post(
    "/members/invitations/{invitation_id}/revoke",
    response_model=InvitationOut,
    summary="Revoke a pending organization invitation (OWNER)",
)
async def revoke_invitation(invitation_id: UUID, session: SessionDep, context: Inviter) -> InvitationOut:
    return await service.revoke_invitation(session, context, invitation_id)


# Static /leave must be registered before dynamic member routes.
@router.post("/members/leave", status_code=204, summary="Leave my organization (non-OWNER)")
async def leave(session: SessionDep, context: OrgContextDep) -> Response:
    await service.transition_member(session, context, context.membership.id, "leave")
    return Response(status_code=204)


@router.patch(
    "/members/{member_id}", response_model=MemberOut, summary="Change a member role with optimistic version (OWNER)"
)
async def change_role(member_id: UUID, payload: RoleChange, session: SessionDep, context: RoleEditor) -> MemberOut:
    return await service.change_role(session, context, member_id, payload)


@router.post("/members/{member_id}/suspend", response_model=MemberOut, summary="Suspend an active member (OWNER)")
async def suspend(member_id: UUID, payload: MembershipReason, session: SessionDep, context: Suspender) -> MemberOut:
    return await service.transition_member(session, context, member_id, "suspend", payload.reason)


@router.post(
    "/members/{member_id}/reactivate", response_model=MemberOut, summary="Reactivate a suspended member (OWNER)"
)
async def reactivate(member_id: UUID, session: SessionDep, context: Suspender) -> MemberOut:
    return await service.transition_member(session, context, member_id, "reactivate")


@router.post("/members/{member_id}/revoke", response_model=MemberOut, summary="Revoke a member permanently (OWNER)")
async def revoke(member_id: UUID, payload: MembershipReason, session: SessionDep, context: Revoker) -> MemberOut:
    return await service.transition_member(session, context, member_id, "revoke", payload.reason)
