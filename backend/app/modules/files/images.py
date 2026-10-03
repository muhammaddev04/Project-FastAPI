"""CR-003 profile images (user avatar, company logo, store image) on top of the P02 file storage (SEC-008).

An upload is never stored as sent. The declared type must be JPEG, PNG or WebP; the leading bytes must match it and
only that format's Pillow decoder is tried. Size and dimensions are bounded before the pixels are decoded, so an
oversized or "decompression bomb" image is refused cheaply. The picture is then fully decoded and re-encoded as a WebP
of at most 512x512 (aspect ratio kept, transparency kept), which drops every metadata block (EXIF including GPS, XMP,
ICC, comments) and anything that is not pixels.
"""

from __future__ import annotations

import hashlib
import io
import logging
import warnings
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from fastapi import UploadFile
from minio.error import S3Error
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped

from app.core import audit
from app.core.errors import AppError
from app.core.storage import get_storage, object_key, user_object_key
from app.core.time import utcnow
from app.modules.files.models import RETIRABLE_CATEGORIES, StoredFile
from app.modules.files.service import display_name

logger = logging.getLogger(__name__)

MAX_BYTES = 5 * 1024 * 1024
MIN_SIDE = 64
MAX_SIDE = 8000
MAX_PIXELS = 40_000_000
OUTPUT_SIDE = 512
OUTPUT_CONTENT_TYPE = "image/webp"
OUTPUT_EXTENSION = "webp"
_WEBP_QUALITY = 86

# Declared content type -> the only Pillow decoder allowed to read the bytes.
FORMATS: dict[str, str] = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
_DIMENSION_LIMITS = {"min_side": MIN_SIDE, "max_side": MAX_SIDE, "max_pixels": MAX_PIXELS}


@dataclass(frozen=True, slots=True)
class NormalizedImage:
    """A re-encoded picture ready for `stored_files`: only the new pixels, never the uploaded bytes."""

    data: bytes
    width: int
    height: int
    content_type: str = OUTPUT_CONTENT_TYPE
    extension: str = OUTPUT_EXTENSION

    @property
    def size_bytes(self) -> int:
        return len(self.data)

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


def _magic_matches(content_type: str, data: bytes) -> bool:
    if content_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return False


def _type_not_allowed(**details: object) -> AppError:
    return AppError("image_type_not_allowed", 422, {"allowed": sorted(FORMATS), **details})


def _dimensions_invalid() -> AppError:
    return AppError("image_dimensions_invalid", 422, dict(_DIMENSION_LIMITS))


def normalize_image(content_type: str, data: bytes, *, output_side: int = OUTPUT_SIDE) -> NormalizedImage:
    """Validate an uploaded picture and return it re-encoded (WebP, <= 512x512, no metadata).

    `content_type` is the client's declaration and is only trusted to pick the one decoder that may be used; the bytes
    must independently prove that format. Every refusal is an AppError without Pillow's own message.
    """
    content_type = content_type.split(";")[0].strip().lower()
    if content_type not in FORMATS:
        raise _type_not_allowed()
    if not data:
        raise AppError("validation_error", 422, {"fields": [{"field": "file", "code": "missing", "message": ""}]})
    if len(data) > MAX_BYTES:
        raise AppError("image_too_large", 422, {"max_bytes": MAX_BYTES})
    if not _magic_matches(content_type, data):
        raise _type_not_allowed(reason="content_mismatch")
    image_format = FORMATS[content_type]

    with warnings.catch_warnings():
        # Pillow only warns between MAX_IMAGE_PIXELS and twice that; treat any warning as a refusal.
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            # `formats=`: no other decoder is ever tried on these bytes, whatever they claim to be.
            with Image.open(io.BytesIO(data), formats=[image_format]) as probe:
                width, height = probe.size  # read from the header, before any pixel is decoded
                if min(width, height) < MIN_SIDE or max(width, height) > MAX_SIDE or width * height > MAX_PIXELS:
                    raise _dimensions_invalid()
                probe.verify()
            with Image.open(io.BytesIO(data), formats=[image_format]) as source:
                if image_format == "JPEG":
                    # libjpeg may decode at 1/2..1/8 scale (never below 2x the output size): bounds memory for photos.
                    source.draft("RGB", (output_side * 2, output_side * 2))
                source.load()
                picture = ImageOps.exif_transpose(source)
                if picture.mode == "I" or picture.mode.startswith("I;16"):
                    # 16-bit greyscale: scale to 8 bits, otherwise the conversion clips everything above 255 to white.
                    picture = picture.convert("I").point(lambda value: value * (1 / 256)).convert("L")
                # Palette/greyscale images with a transparent colour carry it in `info`, not in an alpha band.
                transparent = "A" in picture.getbands() or "transparency" in picture.info
                picture = picture.convert("RGBA" if transparent else "RGB")
                picture.thumbnail((output_side, output_side), Image.Resampling.LANCZOS)
                output = io.BytesIO()
                # No `exif=`/`icc_profile=`/`xmp=` arguments: the new file carries pixels only.
                picture.save(output, "WEBP", quality=_WEBP_QUALITY, method=4)
                width, height = picture.size
        except AppError:
            raise
        except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise _dimensions_invalid() from exc
        except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError) as exc:
            raise AppError("image_invalid", 422) from exc
    return NormalizedImage(data=output.getvalue(), width=width, height=height)


async def read_upload(upload_file: UploadFile) -> tuple[str, bytes]:
    """Declared content type (lower-cased, without parameters) and at most MAX_BYTES + 1 bytes of the upload."""
    content_type = (upload_file.content_type or "").split(";")[0].strip().lower()
    return content_type, await upload_file.read(MAX_BYTES + 1)


# --- lifecycle (CR-003) ----------------------------------------------------------------------------------------
#
# stored_files rows are never deleted (VER-005 trigger); a replaced or removed image is *retired* (`deleted_at`) and
# only its storage object is removed, after the commit. The endpoint layer owns the transaction and the order:
#
#   replace: normalize_image -> put_image (new key) -> lock owner row (SELECT ... FOR UPDATE) -> add_image_row ->
#            point the profile at it -> retire(old) -> audit -> commit -> delete_object_quietly(old key).
#            If anything before the commit fails: rollback (old pointer and object untouched), then
#            delete_object_quietly(new key) - nothing references it.
#   remove:  lock owner row -> clear the pointer -> retire -> audit -> commit -> delete_object_quietly(key).
#
# The old object is never deleted before the commit that stops the profile pointing at it. None of these helpers
# locks anything: the caller locks the owner row first, so concurrent replaces each retire exactly one file.


async def put_image(
    image: NormalizedImage,
    *,
    category: str,
    organization_id: UUID | None = None,
    owner_user_id: UUID | None = None,
) -> str:
    """Store the normalized bytes privately under a new key (never the upload's name) and return that key."""
    if category not in RETIRABLE_CATEGORIES or (organization_id is None) == (owner_user_id is None):
        raise ValueError("a profile image has exactly one owner and category USER_AVATAR or ORG_LOGO")
    if owner_user_id is not None:
        key = user_object_key(owner_user_id, category, image.extension)
    else:
        assert organization_id is not None
        key = object_key(organization_id, category, image.extension)
    await get_storage().put_private(key, image.data, image.content_type)
    return key


async def add_image_row(
    session: AsyncSession,
    image: NormalizedImage,
    *,
    storage_key: str,
    category: str,
    uploaded_by: UUID,
    filename: str | None,
    organization_id: UUID | None = None,
    owner_user_id: UUID | None = None,
) -> StoredFile:
    """Insert the active stored_files row for an object written by `put_image` (flushed, not committed)."""
    stored = StoredFile(
        organization_id=organization_id,
        owner_user_id=owner_user_id,
        category=category,
        storage_key=storage_key,
        content_type=image.content_type,
        size_bytes=image.size_bytes,
        sha256=image.sha256,
        display_name=display_name(filename, image.extension),
        uploaded_by=uploaded_by,
    )
    session.add(stored)
    await session.flush()
    return stored


async def retire(session: AsyncSession, stored: StoredFile) -> None:
    """Mark a replaced/removed profile image inactive. The row and its history stay; the object is not touched.

    Idempotent: an already retired row keeps its first `deleted_at`. Never `session.delete()` (VER-005 trigger).
    """
    if stored.category not in RETIRABLE_CATEGORIES:
        raise ValueError(f"only {RETIRABLE_CATEGORIES} files can be retired, not {stored.category}")
    if stored.deleted_at is None:
        stored.deleted_at = utcnow()
        await session.flush()


async def delete_object_quietly(key: str) -> bool:
    """Best-effort removal of one private object, after the commit. True when it is gone (or never existed).

    Never raises: a failure only leaves an unreferenced private object (retired rows record which ones), and it is
    logged with the key and the error class - never the storage message, credentials or a signed URL.
    """
    try:
        await get_storage().delete(key)
    except S3Error as exc:
        if exc.code == "NoSuchKey":
            return True
        logger.warning("stored object could not be deleted", extra={"storage_key": key, "error": exc.code})
        return False
    except Exception as exc:  # noqa: BLE001 - storage outages must not fail a request that already committed
        logger.warning("stored object could not be deleted", extra={"storage_key": key, "error": type(exc).__name__})
        return False
    return True


async def signed_image_url(stored_key: str | None) -> str | None:
    """SEC-008: a 5-minute signed URL for an image, or None when there is no image."""
    if not stored_key:
        return None
    return (await get_storage().signed_url(stored_key)).url


async def active_image_urls(session: AsyncSession, file_ids: Iterable[UUID | None]) -> dict[UUID, str]:
    """Signed URLs (5 minutes) for the *active* profile images among `file_ids`; retired or unknown ids are absent."""
    ids = {file_id for file_id in file_ids if file_id is not None}
    if not ids:
        return {}
    rows = await session.execute(
        select(StoredFile.id, StoredFile.storage_key).where(
            StoredFile.id.in_(ids),
            StoredFile.deleted_at.is_(None),
            StoredFile.category.in_(RETIRABLE_CATEGORIES),
        )
    )
    return {file_id: (await get_storage().signed_url(key)).url for file_id, key in rows}


async def image_url(session: AsyncSession, file_id: UUID | None) -> str | None:
    return (await active_image_urls(session, [file_id])).get(file_id) if file_id else None


class _ImageHolder(Protocol):
    id: Mapped[UUID]


async def swap_profile_image(
    session: AsyncSession,
    *,
    holder_model: type[_ImageHolder],
    holder_id: UUID,
    category: str,
    image: NormalizedImage | None,
    filename: str | None,
    actor_id: UUID,
) -> None:
    """Replace (`image`) or remove (`None`) the profile image of a user (USER_AVATAR, holder `User`) or an
    organization (ORG_LOGO, holder `Company`/`Store`), in the order documented above, and commit.

    The caller has already validated the image and checked authorization; nothing about ownership comes from the
    request - the owner is always the holder row itself. Removing when there is no image is a no-op.
    """
    if category == "USER_AVATAR":
        pointer, entity, owner = "avatar_file_id", "user", {"owner_user_id": holder_id}
    elif category == "ORG_LOGO":
        pointer, entity, owner = "logo_file_id", "organization", {"organization_id": holder_id}
    else:
        raise ValueError(f"not a profile image category: {category}")

    new_key: str | None = None
    if image is not None:
        try:
            new_key = await put_image(image, category=category, **owner)
        except Exception as exc:
            logger.warning(
                "profile image could not be stored", extra={"category": category, "error": type(exc).__name__}
            )
            raise AppError("service_unavailable", 503) from exc

    old_key: str | None = None
    try:
        # FOR UPDATE serializes concurrent changes of the same profile; populate_existing re-reads the pointer
        # instead of trusting the copy already in the identity map (e.g. the user loaded for authentication).
        holder = (
            await session.execute(
                select(holder_model)
                .where(holder_model.id == holder_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        old_id: UUID | None = getattr(holder, pointer)
        old = (
            (
                await session.execute(
                    select(StoredFile)
                    .where(StoredFile.id == old_id, StoredFile.category == category)
                    .execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
            if old_id is not None
            else None
        )
        if image is None and old is None:
            if old_id is not None:  # a dangling pointer cannot exist (FK), but never leave one behind
                setattr(holder, pointer, None)
            await session.commit()
            return

        new: StoredFile | None = None
        if image is not None:
            assert new_key is not None
            new = await add_image_row(
                session, image, storage_key=new_key, category=category, uploaded_by=actor_id, filename=filename, **owner
            )
        setattr(holder, pointer, new.id if new is not None else None)
        if old is not None:
            old_key = old.storage_key
            await retire(session, old)
        await audit.record(
            session,
            f"{entity}.{'avatar' if category == 'USER_AVATAR' else 'logo'}_{'updated' if new else 'removed'}",
            entity,
            holder_id,
            actor_id=actor_id,
            org_id=holder_id if category == "ORG_LOGO" else None,
            old={"file_id": str(old.id) if old is not None else None},
            new={"file_id": str(new.id) if new is not None else None},
        )
        await session.commit()
    except Exception:
        await session.rollback()
        if new_key is not None:
            await delete_object_quietly(new_key)  # nothing references it: the row was rolled back
        raise
    # Only now, with the new state committed, may the previous object disappear.
    if old_key is not None:
        await delete_object_quietly(old_key)
