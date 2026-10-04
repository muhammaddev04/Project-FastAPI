from __future__ import annotations

import hashlib
import re
import unicodedata
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.errors import AppError
from app.core.storage import SignedUrl, get_storage, object_key
from app.modules.files.models import StoredFile
from app.modules.files.schemas import FileOut
from app.modules.identity.deps import OrgContext

MAX_BYTES = 10 * 1024 * 1024  # VER-002
# VER-002 whitelist: declared content type -> (file extension, required leading bytes).
ALLOWED: dict[str, tuple[str, bytes]] = {
    "application/pdf": ("pdf", b"%PDF-"),
    "image/jpeg": ("jpg", b"\xff\xd8\xff"),
    "image/png": ("png", b"\x89PNG\r\n\x1a\n"),
}
_UNSAFE = re.compile(r"[^\w .()\-]+", re.UNICODE)


def display_name(raw: str | None, extension: str) -> str:
    """Keep only a readable base name for display; it never reaches the storage key or a filesystem path."""
    name = unicodedata.normalize("NFC", (raw or "").replace("\\", "/").rsplit("/", 1)[-1])
    name = _UNSAFE.sub("_", "".join(ch for ch in name if unicodedata.category(ch)[0] != "C")).strip(" .")
    return (name or f"document.{extension}")[:255]


def file_out(stored: StoredFile) -> FileOut:
    return FileOut(
        id=stored.id,
        display_name=stored.display_name,
        size_bytes=stored.size_bytes,
        content_type=stored.content_type,
        category=stored.category,  # type: ignore[arg-type]
        created_at=stored.created_at,
    )


async def upload(session: AsyncSession, context: OrgContext, upload_file: UploadFile, category: str) -> FileOut:
    """POST /files: validate type, magic bytes and size, then store privately (VER-002, FND-017)."""
    if context.organization.status != "ACTIVE":
        raise AppError("organization_blocked", 403)
    if category == "VERIFICATION" and "verification.submit" not in context.permissions:
        raise AppError("permission_denied", 403)
    content_type = (upload_file.content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED:
        raise AppError("file_type_not_allowed", 422, {"allowed": sorted(ALLOWED)})
    data = await upload_file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise AppError("file_too_large", 422, {"max_bytes": MAX_BYTES})
    if not data:
        raise AppError("validation_error", 422, {"fields": [{"field": "file", "code": "missing", "message": ""}]})
    extension, magic = ALLOWED[content_type]
    if not data.startswith(magic):
        raise AppError("file_type_not_allowed", 422, {"reason": "content_mismatch"})

    key = object_key(context.organization.id, category, extension)
    await get_storage().put_private(key, data, content_type)
    stored = StoredFile(
        organization_id=context.organization.id,
        category=category,
        storage_key=key,
        content_type=content_type,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        display_name=display_name(upload_file.filename, extension),
        uploaded_by=context.user.id,
    )
    session.add(stored)
    await session.flush()
    await audit.record(
        session,
        "file.uploaded",
        "stored_file",
        stored.id,
        actor_id=context.user.id,
        org_id=context.organization.id,
        new={"category": category, "content_type": content_type, "size_bytes": len(data)},
    )
    return file_out(stored)


async def get_owned(session: AsyncSession, organization_id: UUID, file_id: UUID) -> StoredFile:
    """SEC-007: a file of another organization is indistinguishable from a missing one - and so is a retired one
    (CR-003 `deleted_at`: a replaced or removed profile image is never signed or attached again)."""
    stored = (
        await session.execute(
            select(StoredFile).where(
                StoredFile.id == file_id,
                StoredFile.organization_id == organization_id,
                StoredFile.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if stored is None:
        raise AppError("not_found", 404)
    return stored


async def signed_url(session: AsyncSession, context: OrgContext, file_id: UUID) -> SignedUrl:
    """GET /files/{id}/url: verification documents are readable by the organization OWNER only (VER-004)."""
    stored = await get_owned(session, context.organization.id, file_id)
    if stored.category == "VERIFICATION" and "verification.submit" not in context.permissions:
        raise AppError("permission_denied", 403)
    return await get_storage().signed_url(stored.storage_key)
