from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, File, Form, UploadFile, status
from fastapi.responses import Response
from minio.error import S3Error
from urllib3.exceptions import HTTPError

from app.core.errors import AppError
from app.core.storage import get_storage, valid_content_signature
from app.modules.files import service
from app.modules.files.schemas import FileOut, SignedUrlOut
from app.modules.identity.deps import OrgContextDep, SessionDep

router = APIRouter(prefix="/api/v1/files", tags=["files"])


@router.get("/content/{key:path}", include_in_schema=False)
async def file_content(key: str, expires: int = 0, signature: str = "") -> Response:
    """The signed URL is the download credential; never require a bearer token on an image tag."""
    if not valid_content_signature(key, expires, signature):
        raise AppError("permission_denied", 403)
    try:
        data = await get_storage().read(key)
    except S3Error as exc:
        if exc.code in {"NoSuchKey", "NoSuchBucket", "NoSuchObject"}:
            raise AppError("not_found", 404) from exc
        raise AppError("storage_unavailable", 503) from exc
    except (HTTPError, OSError) as exc:
        raise AppError("storage_unavailable", 503) from exc
    content_type = {
        "webp": "image/webp",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "pdf": "application/pdf",
    }.get(key.rsplit(".", 1)[-1].lower(), "application/octet-stream")
    return Response(
        data,
        media_type=content_type,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


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
