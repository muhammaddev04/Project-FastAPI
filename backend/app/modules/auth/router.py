from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.modules.auth import service
from app.modules.auth.schemas import RegisterRequest, VerifyEmailRequest
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


@router.post(
    "/email/verify",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Confirm the email address with the token from the email link (IAM-002, CR-001)",
    responses={
        204: {"description": "The email is confirmed; the token can no longer be used."},
        422: {"description": "`email_token_invalid` (unknown or already used) or `email_token_expired`."},
        429: {"description": "`rate_limited` (auth_email_verify, 10 per hour per IP)."},
    },
)
async def verify_email(payload: VerifyEmailRequest, session: SessionDep) -> Response:
    await service.verify_email(session, payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
