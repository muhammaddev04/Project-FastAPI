"""CR-003 profile-image endpoints: PUT/DELETE /me/avatar and PUT/DELETE /organization/logo."""

from __future__ import annotations

import asyncio
import io
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

import httpx
import pytest
from httpx import AsyncClient
from minio.error import S3Error
from PIL import Image
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.config import get_settings
from app.core.db import get_engine
from app.core.storage import Storage, get_storage
from app.modules.files import images
from app.modules.files.models import StoredFile
from app.modules.identity.models import Organization, User
from app.modules.organizations.models import Company, Store
from tests.factories import add_member, auth, make_org, make_user

AVATAR = "/api/v1/me/avatar"
LOGO = "/api/v1/organization/logo"


def _image(
    size: tuple[int, int] = (800, 400), colour: tuple[int, int, int] = (20, 120, 220), fmt: str = "PNG"
) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, fmt)
    return buffer.getvalue()


def _files(data: bytes, name: str = "../../etc/My Photo.png", content_type: str = "image/png") -> dict[str, Any]:
    return {"file": (name, data, content_type)}


async def _object_exists(key: str) -> bool:
    try:
        await get_storage().read(key)
    except S3Error as exc:
        if exc.code == "NoSuchKey":
            return False
        raise
    return True


async def _download(url: str) -> httpx.Response:
    async with httpx.AsyncClient() as http:
        return await http.get(url)


async def _rows(session: AsyncSession, category: str) -> list[StoredFile]:
    session.expunge_all()  # always read the committed state, never the identity map
    result = await session.scalars(
        select(StoredFile).where(StoredFile.category == category).order_by(StoredFile.created_at)
    )
    return list(result)


async def _fresh(session: AsyncSession, model: type[Any], ident: UUID) -> Any:
    session.expunge_all()
    return await session.get(model, ident)


# --- user avatar: upload ------------------------------------------------------------------------------------------


async def test_avatar_upload_requires_authentication(client: AsyncClient) -> None:
    response = await client.put(AVATAR, files=_files(_image()))
    assert response.status_code == 401 and response.json()["error"]["code"] == "not_authenticated"
    assert (await client.delete(AVATAR)).status_code == 401


async def test_avatar_upload_stores_normalized_private_user_file(
    client: AsyncClient, session: AsyncSession, forbid_row_deletion: None
) -> None:
    user = await make_user(session)
    await session.commit()
    response = await client.put(AVATAR, files=_files(_image()), headers=auth(user))
    assert response.status_code == 200, response.text
    body = response.json()

    [stored] = await _rows(session, "USER_AVATAR")
    assert stored.category == "USER_AVATAR"
    assert stored.organization_id is None and stored.owner_user_id == user.id
    assert stored.uploaded_by == user.id and stored.deleted_at is None
    assert stored.content_type == "image/webp" and stored.storage_key.endswith(".webp")
    assert stored.storage_key.startswith(f"users/{user.id}/user_avatar/")
    assert "Photo" not in stored.storage_key and "etc" not in stored.storage_key  # never the original filename
    assert stored.display_name == "My Photo.png"
    assert (await _fresh(session, User, user.id)).avatar_file_id == stored.id

    data = await get_storage().read(stored.storage_key)
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP" and len(data) == stored.size_bytes
    assert Image.open(io.BytesIO(data)).size == (512, 256)

    url = body["avatar_url"]
    assert "X-Amz-Signature=" in url and "X-Amz-Expires=300" in url  # SEC-008: 5 minutes
    downloaded = await _download(url)
    assert downloaded.status_code == 200 and downloaded.content == data
    assert "storage_key" not in response.text and get_settings().s3_secret_key not in response.text

    me = (await client.get("/api/v1/me", headers=auth(user))).json()
    assert me["avatar_url"] and "X-Amz-Expires=300" in me["avatar_url"]
    assert urlsplit(me["avatar_url"]).path == urlsplit(url).path


async def test_avatar_object_is_private_without_a_signature(client: AsyncClient, session: AsyncSession) -> None:
    user = await make_user(session)
    await session.commit()
    url = (await client.put(AVATAR, files=_files(_image()), headers=auth(user))).json()["avatar_url"]
    unsigned = urlsplit(url)._replace(query="").geturl()
    assert (await _download(unsigned)).status_code in (401, 403)


@pytest.mark.parametrize(
    ("data", "content_type", "code"),
    [
        (b"not an image at all", "image/png", "image_type_not_allowed"),
        (_image(fmt="JPEG"), "image/png", "image_type_not_allowed"),
        (_image(), "image/gif", "image_type_not_allowed"),
        (b"\x89PNG\r\n\x1a\n" + b"garbage" * 50, "image/png", "image_invalid"),
        (b"\x89PNG\r\n\x1a\n" + b"\0" * (5 * 1024 * 1024), "image/png", "image_too_large"),
        (_image(size=(40, 40)), "image/png", "image_dimensions_invalid"),
    ],
    ids=["random-bytes", "jpeg-declared-png", "gif-declared", "corrupt-png", "over-5mb", "below-64px"],
)
async def test_invalid_avatar_is_refused_and_nothing_is_stored(
    client: AsyncClient, session: AsyncSession, data: bytes, content_type: str, code: str
) -> None:
    user = await make_user(session)
    await session.commit()
    response = await client.put(AVATAR, files=_files(data, content_type=content_type), headers=auth(user))
    assert response.status_code == 422 and response.json()["error"]["code"] == code
    assert await _rows(session, "USER_AVATAR") == []
    assert (await _fresh(session, User, user.id)).avatar_file_id is None


async def test_avatar_storage_failure_is_a_safe_503(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _down(self: Storage, key: str, data: bytes, content_type: str) -> None:
        raise ConnectionError("http://minio:secret@storage:8333 refused")

    user = await make_user(session)
    await session.commit()
    monkeypatch.setattr(Storage, "put_private", _down)
    response = await client.put(AVATAR, files=_files(_image()), headers=auth(user))
    assert response.status_code == 503 and response.json()["error"]["code"] == "service_unavailable"
    assert "secret" not in response.text and "minio" not in response.text
    assert await _rows(session, "USER_AVATAR") == []


# --- user avatar: replace -----------------------------------------------------------------------------------------


async def test_avatar_replace_retires_old_row_and_deletes_old_object_after_commit(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch, forbid_row_deletion: None
) -> None:
    user = await make_user(session)
    await session.commit()
    first_url = (await client.put(AVATAR, files=_files(_image()), headers=auth(user))).json()["avatar_url"]
    [old] = await _rows(session, "USER_AVATAR")

    seen: list[tuple[object, object]] = []
    original = images.delete_object_quietly

    async def _spy(key: str) -> bool:
        # Called only once the new state is visible to *other* connections, i.e. committed.
        async with get_engine().connect() as other:
            pointer = (
                await other.execute(text("SELECT avatar_file_id FROM users WHERE id = :id"), {"id": user.id})
            ).scalar()
            retired = (
                await other.execute(text("SELECT deleted_at FROM stored_files WHERE id = :id"), {"id": old.id})
            ).scalar()
        seen.append((pointer, retired))
        assert key == old.storage_key and await _object_exists(key)
        return await original(key)

    monkeypatch.setattr(images, "delete_object_quietly", _spy)
    response = await client.put(AVATAR, files=_files(_image(colour=(200, 10, 10))), headers=auth(user))
    assert response.status_code == 200

    rows = await _rows(session, "USER_AVATAR")
    assert len(rows) == 2
    retired, active = rows
    assert retired.id == old.id and retired.deleted_at is not None and active.deleted_at is None
    assert (await _fresh(session, User, user.id)).avatar_file_id == active.id
    assert seen == [(active.id, retired.deleted_at)]
    assert active.storage_key != old.storage_key

    assert not await _object_exists(old.storage_key) and await _object_exists(active.storage_key)
    assert (await _download(first_url)).status_code == 404  # an old signed URL stops working
    assert urlsplit(response.json()["avatar_url"]).path.endswith(active.storage_key)


async def test_failed_avatar_transaction_keeps_old_avatar_and_cleans_new_object(
    lenient_client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await make_user(session)
    await session.commit()
    first_url = (await lenient_client.put(AVATAR, files=_files(_image()), headers=auth(user))).json()["avatar_url"]
    [old] = await _rows(session, "USER_AVATAR")

    new_keys: list[str] = []
    original_put = images.put_image

    async def _capture(*args: Any, **kwargs: Any) -> str:
        new_keys.append(await original_put(*args, **kwargs))
        return new_keys[-1]

    async def _db_failure(db: AsyncSession, stored: StoredFile) -> None:
        await db.execute(text("SELECT 1 / 0"))  # a real database error inside the transaction

    monkeypatch.setattr(images, "put_image", _capture)
    monkeypatch.setattr(images, "retire", _db_failure)
    response = await lenient_client.put(AVATAR, files=_files(_image(colour=(1, 2, 3))), headers=auth(user))
    assert response.status_code == 500 and response.json()["error"]["code"] == "internal_error"
    assert "division" not in response.text

    [still] = await _rows(session, "USER_AVATAR")
    assert still.id == old.id and still.deleted_at is None
    assert (await _fresh(session, User, user.id)).avatar_file_id == old.id
    assert await _object_exists(old.storage_key) and (await _download(first_url)).status_code == 200
    assert len(new_keys) == 1 and not await _object_exists(new_keys[0])
    audit = (await session.scalars(select(AuditLog.action).where(AuditLog.entity_id == user.id))).all()
    assert audit == ["user.avatar_updated"]  # only the first upload


async def test_old_object_deletion_failure_after_commit_still_succeeds(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await make_user(session)
    await session.commit()
    await client.put(AVATAR, files=_files(_image()), headers=auth(user))
    [old] = await _rows(session, "USER_AVATAR")

    async def _unreachable(self: Storage, key: str) -> None:
        raise ConnectionError("storage unreachable")

    monkeypatch.setattr(Storage, "delete", _unreachable)
    response = await client.put(AVATAR, files=_files(_image(colour=(9, 9, 9))), headers=auth(user))
    assert response.status_code == 200 and response.json()["avatar_url"]
    retired, active = await _rows(session, "USER_AVATAR")
    assert retired.id == old.id and retired.deleted_at is not None
    assert (await _fresh(session, User, user.id)).avatar_file_id == active.id
    assert await _object_exists(old.storage_key)  # left behind, recoverable through the retired row


async def test_concurrent_avatar_replacements_are_serialized(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await make_user(session)
    await session.commit()
    await client.put(AVATAR, files=_files(_image()), headers=auth(user))

    original_add = images.add_image_row

    async def _slow_add(*args: Any, **kwargs: Any) -> StoredFile:
        stored = await original_add(*args, **kwargs)
        await asyncio.sleep(0.3)  # hold the owner-row lock while the other request tries to take it
        return stored

    monkeypatch.setattr(images, "add_image_row", _slow_add)
    responses = await asyncio.gather(
        client.put(AVATAR, files=_files(_image(colour=(255, 0, 0))), headers=auth(user)),
        client.put(AVATAR, files=_files(_image(colour=(0, 255, 0))), headers=auth(user)),
    )
    assert [r.status_code for r in responses] == [200, 200]

    rows = await _rows(session, "USER_AVATAR")
    active = [row for row in rows if row.deleted_at is None]
    assert len(rows) == 3 and len(active) == 1  # each replacement retired exactly one predecessor
    assert (await _fresh(session, User, user.id)).avatar_file_id == active[0].id
    for row in rows:
        assert await _object_exists(row.storage_key) == (row.deleted_at is None)


# --- user avatar: remove ------------------------------------------------------------------------------------------


async def test_avatar_remove_clears_pointer_retires_row_and_deletes_object(
    client: AsyncClient, session: AsyncSession, forbid_row_deletion: None
) -> None:
    user = await make_user(session)
    await session.commit()
    url = (await client.put(AVATAR, files=_files(_image()), headers=auth(user))).json()["avatar_url"]
    [stored] = await _rows(session, "USER_AVATAR")

    response = await client.delete(AVATAR, headers=auth(user))
    assert response.status_code == 200 and response.json()["avatar_url"] is None
    [retired] = await _rows(session, "USER_AVATAR")
    assert retired.id == stored.id and retired.deleted_at is not None  # the row stays as history
    assert (await _fresh(session, User, user.id)).avatar_file_id is None
    assert not await _object_exists(stored.storage_key) and (await _download(url)).status_code == 404
    assert (await client.get("/api/v1/me", headers=auth(user))).json()["avatar_url"] is None

    log = (
        await session.scalars(select(AuditLog).where(AuditLog.entity_id == user.id).order_by(AuditLog.created_at))
    ).all()
    assert [(row.action, row.entity_type, row.actor_id) for row in log] == [
        ("user.avatar_updated", "user", user.id),
        ("user.avatar_removed", "user", user.id),
    ]
    assert log[0].old_data == {"file_id": None} and log[0].new_data == {"file_id": str(stored.id)}
    assert log[1].old_data == {"file_id": str(stored.id)} and log[1].new_data == {"file_id": None}


async def test_avatar_remove_without_avatar_is_idempotent(client: AsyncClient, session: AsyncSession) -> None:
    user = await make_user(session)
    await session.commit()
    for _ in range(2):
        response = await client.delete(AVATAR, headers=auth(user))
        assert response.status_code == 200 and response.json()["avatar_url"] is None
    assert await _rows(session, "USER_AVATAR") == []
    assert (await session.scalars(select(AuditLog).where(AuditLog.entity_id == user.id))).all() == []


async def test_avatar_is_always_the_callers_own(client: AsyncClient, session: AsyncSession) -> None:
    alice = await make_user(session)
    bob = await make_user(session)
    await session.commit()
    await client.put(AVATAR, files=_files(_image()), headers=auth(alice))
    [alices] = await _rows(session, "USER_AVATAR")

    # Bob's requests touch only Bob, whatever ids he adds to the request.
    await client.put(
        AVATAR,
        files=_files(_image()),
        data={"user_id": str(alice.id), "owner_user_id": str(alice.id)},
        headers=auth(bob),
    )
    await client.delete(f"{AVATAR}?user_id={alice.id}", headers=auth(bob))
    assert (await _fresh(session, User, alice.id)).avatar_file_id == alices.id
    alice_row = await _fresh(session, StoredFile, alices.id)
    assert alice_row.deleted_at is None and await _object_exists(alices.storage_key)
    assert (await _fresh(session, User, bob.id)).avatar_file_id is None
    assert all(row.owner_user_id in (alice.id, bob.id) for row in await _rows(session, "USER_AVATAR"))


# --- organization logo --------------------------------------------------------------------------------------------


@pytest.mark.parametrize(("org_type", "model"), [("COMPANY", Company), ("STORE", Store)])
async def test_owner_uploads_logo_for_the_active_organization(
    client: AsyncClient,
    session: AsyncSession,
    org_type: str,
    model: type[Company] | type[Store],
    forbid_row_deletion: None,
) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner, org_type, "Logo Org")
    await session.commit()
    response = await client.put(LOGO, files=_files(_image(), name="logo.png"), headers=auth(owner, org))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == str(org.id) and "X-Amz-Expires=300" in body["logo_url"]

    [stored] = await _rows(session, "ORG_LOGO")
    assert stored.organization_id == org.id and stored.owner_user_id is None and stored.deleted_at is None
    assert stored.storage_key.startswith(f"{org.id}/org_logo/") and "logo" not in stored.storage_key.split("/")[-1]
    assert (await _fresh(session, model, org.id)).logo_file_id == stored.id
    assert (await _download(body["logo_url"])).status_code == 200

    profile = (await client.get("/api/v1/organization", headers=auth(owner, org))).json()
    assert profile["logo_url"] and urlsplit(profile["logo_url"]).path.endswith(stored.storage_key)
    [membership] = (await client.get("/api/v1/me", headers=auth(owner))).json()["memberships"]
    assert membership["logo_url"] and urlsplit(membership["logo_url"]).path.endswith(stored.storage_key)

    [entry] = (await session.scalars(select(AuditLog).where(AuditLog.action == "organization.logo_updated"))).all()
    assert entry.entity_type == "organization" and entry.entity_id == org.id and entry.org_id == org.id
    assert entry.actor_id == owner.id and entry.new_data == {"file_id": str(stored.id)}


async def test_logo_replace_and_remove_retire_rows_and_delete_objects_after_commit(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch, forbid_row_deletion: None
) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    await session.commit()
    await client.put(LOGO, files=_files(_image()), headers=auth(owner, org))
    [first] = await _rows(session, "ORG_LOGO")

    committed_before_delete: list[bool] = []
    original = images.delete_object_quietly

    async def _spy(key: str) -> bool:
        async with get_engine().connect() as other:
            retired = (
                await other.execute(text("SELECT deleted_at FROM stored_files WHERE storage_key = :k"), {"k": key})
            ).scalar()
        committed_before_delete.append(retired is not None)
        return await original(key)

    monkeypatch.setattr(images, "delete_object_quietly", _spy)
    replaced = await client.put(LOGO, files=_files(_image(colour=(0, 0, 0))), headers=auth(owner, org))
    assert replaced.status_code == 200
    old, second = await _rows(session, "ORG_LOGO")
    assert old.id == first.id and old.deleted_at is not None and second.deleted_at is None
    assert (await _fresh(session, Company, org.id)).logo_file_id == second.id
    assert not await _object_exists(first.storage_key)

    removed = await client.delete(LOGO, headers=auth(owner, org))
    assert removed.status_code == 200 and removed.json()["logo_url"] is None
    rows = await _rows(session, "ORG_LOGO")
    assert len(rows) == 2 and all(row.deleted_at is not None for row in rows)
    assert (await _fresh(session, Company, org.id)).logo_file_id is None
    assert not await _object_exists(second.storage_key)
    assert committed_before_delete == [True, True]
    actions = (await session.scalars(select(AuditLog.action).where(AuditLog.entity_type == "organization"))).all()
    assert [a for a in actions if "logo" in a] == ["organization.logo_updated"] * 2 + ["organization.logo_removed"]

    again = await client.delete(LOGO, headers=auth(owner, org))  # idempotent
    assert again.status_code == 200 and again.json()["logo_url"] is None


async def test_retired_logo_is_never_signed(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    await session.commit()
    await client.put(LOGO, files=_files(_image()), headers=auth(owner, org))
    await client.put(LOGO, files=_files(_image(colour=(5, 5, 5))), headers=auth(owner, org))
    old, active = await _rows(session, "ORG_LOGO")

    assert await images.image_url(session, old.id) is None
    assert await images.image_url(session, active.id) is not None
    by_files_api = await client.get(f"/api/v1/files/{old.id}/url", headers=auth(owner, org))
    assert by_files_api.status_code == 404 and by_files_api.json()["error"]["code"] == "not_found"
    profile = (await client.get("/api/v1/organization", headers=auth(owner, org))).json()
    assert old.storage_key not in profile["logo_url"] and active.storage_key in profile["logo_url"]


@pytest.mark.parametrize(("org_type", "role"), [("COMPANY", "MANAGER"), ("COMPANY", "OPERATOR"), ("STORE", "SELLER")])
async def test_non_owner_roles_cannot_change_branding(
    client: AsyncClient, session: AsyncSession, org_type: str, role: str
) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner, org_type)
    member = await make_user(session)
    await add_member(session, org, member, role)
    await session.commit()
    await client.put(LOGO, files=_files(_image()), headers=auth(owner, org))
    [logo] = await _rows(session, "ORG_LOGO")

    for response in (
        await client.put(LOGO, files=_files(_image(colour=(1, 1, 1))), headers=auth(member, org)),
        await client.delete(LOGO, headers=auth(member, org)),
    ):
        assert response.status_code == 403 and response.json()["error"]["code"] == "permission_denied"
    [unchanged] = await _rows(session, "ORG_LOGO")
    assert unchanged.id == logo.id and unchanged.deleted_at is None and await _object_exists(logo.storage_key)
    # Viewing branding is still allowed.
    assert (await client.get("/api/v1/organization", headers=auth(member, org))).json()["logo_url"]


async def test_other_organization_cannot_touch_this_logo(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner, name="Victim")
    stranger = await make_user(session)
    other = await make_org(session, stranger, name="Stranger Co")
    await session.commit()
    await client.put(LOGO, files=_files(_image()), headers=auth(owner, org))
    [logo] = await _rows(session, "ORG_LOGO")

    foreign = auth(stranger)
    foreign["X-Org-Id"] = str(org.id)
    for response in (
        await client.put(LOGO, files=_files(_image()), headers=foreign),
        await client.delete(LOGO, headers=foreign),
    ):
        assert response.status_code == 404 and response.json()["error"]["code"] == "not_found"
    # The stranger's own organization gets its own logo; an organization id in the body is ignored.
    own = await client.put(
        LOGO, files=_files(_image()), data={"organization_id": str(org.id)}, headers=auth(stranger, other)
    )
    assert own.status_code == 200 and own.json()["id"] == str(other.id)
    rows = await _rows(session, "ORG_LOGO")
    assert {row.organization_id for row in rows} == {org.id, other.id}
    assert (await _fresh(session, StoredFile, logo.id)).deleted_at is None
    assert (await _fresh(session, Company, org.id)).logo_file_id == logo.id


@pytest.mark.parametrize(
    ("header", "status", "code"), [(None, 400, "org_context_required"), ("nope", 404, "not_found")]
)
async def test_logo_requires_a_valid_active_organization(
    client: AsyncClient, session: AsyncSession, header: str | None, status: int, code: str
) -> None:
    owner = await make_user(session)
    await make_org(session, owner)
    await session.commit()
    headers = auth(owner)
    if header is not None:
        headers["X-Org-Id"] = header
    for response in (
        await client.put(LOGO, files=_files(_image()), headers=headers),
        await client.delete(LOGO, headers=headers),
    ):
        assert response.status_code == status and response.json()["error"]["code"] == code
    assert await _rows(session, "ORG_LOGO") == []


async def test_suspended_organization_cannot_change_logo(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    (await session.get(Organization, org.id)).status = "SUSPENDED"  # type: ignore[union-attr]
    await session.commit()
    response = await client.put(LOGO, files=_files(_image()), headers=auth(owner, org))
    assert response.status_code == 403 and response.json()["error"]["code"] == "organization_blocked"
    assert await _rows(session, "ORG_LOGO") == []


async def test_logo_upload_rejects_invalid_images(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    await session.commit()
    response = await client.put(
        LOGO, files=_files(b"<svg onload=alert(1)>", content_type="image/png"), headers=auth(owner, org)
    )
    assert response.status_code == 422 and response.json()["error"]["code"] == "image_type_not_allowed"
    assert await _rows(session, "ORG_LOGO") == []
