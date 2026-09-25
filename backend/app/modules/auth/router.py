from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.modules.auth import service
from app.modules.auth.schemas import RegisterRequest
from app.modules.identity.deps import SessionDep

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post(
    "/register",
    status_code=status.HTTP_202_ACCEPTED,
    response_class=Response,
    summary="Register with email and password; a confirmation link is emailed (IAM-001, CR-001)",
    responses={
        202: {"description": "Accepted. The same answer whether or not the email is already registered."},
        422: {"description": "`validation_error` or `weak_password` (IAM-003)."},
        429: {"description": "`rate_limited` (auth_email_send, 5 per hour per email)."},
        503: {"description": "`service_unavailable`: the email could not be sent; nothing was created."},
    },
)
async def register(payload: RegisterRequest, session: SessionDep) -> Response:
    await service.register(session, payload)
    return Response(status_code=status.HTTP_202_ACCEPTED)
