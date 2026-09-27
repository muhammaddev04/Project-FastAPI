from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, File, Form, UploadFile, status

from app.modules.files import service
from app.modules.files.schemas import FileOut, SignedUrlOut
from app.modules.identity.deps import OrgContextDep, SessionDep

router = APIRouter(prefix="/api/v1/files", tags=["files"])


@router.post("", response_model=FileOut, status_code=status.HTTP_201_CREATED, summary="Upload a private file (P02)")
async def upload_file(
    session: SessionDep,
    context: OrgContextDep,
    file: Annotated[UploadFile, File()],
    # Other categories (IMPORT, EXPORT, PRODUCT_IMAGE) arrive with the parts that use them (P04, P12).
    category: Annotated[Literal["VERIFICATION"], Form()],
) -> FileOut:
    return await service.upload(session, context, file, category)


@router.get("/{file_id}/url", response_model=SignedUrlOut, summary="Short-lived signed URL for a file (5 minutes)")
async def file_url(file_id: UUID, session: SessionDep, context: OrgContextDep) -> SignedUrlOut:
    signed = await service.signed_url(session, context, file_id)
    return SignedUrlOut(url=signed.url, expires_at=signed.expires_at)
