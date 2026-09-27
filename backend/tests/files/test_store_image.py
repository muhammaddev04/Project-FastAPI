"""CR-003 Store image: the store's own picture through PUT/DELETE /organization/logo with a STORE X-Org-Id.

A Store is an organization (P02 §1.2, 1:1 with `organizations`), so its image is an ORG_LOGO file owned by the store's
organization and pointed to by `stores.logo_file_id`. It is independent from any company logo (always another
organization) and from every user avatar (USER_AVATAR, owned by a user).
"""

from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.config import get_settings
from app.core.db import get_engine
from app.core.storage import Storage, get_storage
from app.modules.files import images
from app.modules.files.models import StoredFile
from app.modules.identity.models import User
from app.modules.organizations.models import Company, Store
from tests.factories import add_member, auth, make_org, make_user
from tests.files.test_profile_images import (
    AVATAR,
    LOGO,
    _download,
    _files,
    _fresh,
    _image,
    _object_exists,
    _rows,
)


async def _store(session: AsyncSession, name: str = "Corner Market") -> tuple[User, Any]:
    owner = await make_user(session)
    store = await make_org(session, owner, "STORE", name)
    await session.commit()
    return owner, store


async def _logo_actions(session: AsyncSession, org_id: object) -> list[str]:
    rows = await session.scalars(
        select(AuditLog.action)
        .where(AuditLog.entity_id == org_id, AuditLog.action.like("organization.logo_%"))
        .order_by(AuditLog.created_at)
    )
    return list(rows)


# --- upload -------------------------------------------------------------------------------------------------------


async def test_store_image_requires_authentication(client: AsyncClient, session: AsyncSession) -> None:
    _, store = await _store(session)
    headers = {"X-Org-Id": str(store.id)}
    for response in (await client.put(LOGO, files=_files(_image()), headers=headers), await client.delete(LOGO)):
        assert response.status_code == 401 and response.json()["error"]["code"] == "not_authenticated"


async def test_store_owner_uploads_the_store_image(
    client: AsyncClient, session: AsyncSession, forbid_row_deletion: None
) -> None:
    owner, store = await _store(session)
    response = await client.put(LOGO, files=_files(_image(), name="../Shop Front.png"), headers=auth(owner, store))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == str(store.id) and body["type"] == "STORE"

    [stored] = await _rows(session, "ORG_LOGO")
    assert stored.organization_id == store.id and stored.owner_user_id is None and stored.deleted_at is None
    assert stored.uploaded_by == owner.id and stored.content_type == "image/webp"
    assert stored.storage_key.startswith(f"{store.id}/org_logo/") and stored.storage_key.endswith(".webp")
    assert "Shop" not in stored.storage_key and ".." not in stored.storage_key
    assert (await _fresh(session, Store, store.id)).logo_file_id == stored.id
    assert await _fresh(session, Company, store.id) is None  # a store has no company profile to touch

    data = await get_storage().read(stored.storage_key)
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP"

    url = body["logo_url"]
    assert "X-Amz-Signature=" in url and "X-Amz-Expires=300" in url
    assert (await _download(url)).status_code == 200
    unsigned = urlsplit(url)._replace(query="").geturl()
    assert (await _download(unsigned)).status_code in (401, 403)  # private bucket
    assert "storage_key" not in response.text and get_settings().s3_secret_key not in response.text

    profile = (await client.get("/api/v1/organization", headers=auth(owner, store))).json()
    assert urlsplit(profile["logo_url"]).path.endswith(stored.storage_key)
    [membership] = (await client.get("/api/v1/me", headers=auth(owner))).json()["memberships"]
    assert membership["org_type"] == "STORE" and urlsplit(membership["logo_url"]).path.endswith(stored.storage_key)

    [entry] = (await session.scalars(select(AuditLog).where(AuditLog.action == "organization.logo_updated"))).all()
    assert (entry.entity_type, entry.entity_id, entry.org_id, entry.actor_id) == (
        "organization",
        store.id,
        store.id,
        owner.id,
    )
    assert entry.old_data == {"file_id": None} and entry.new_data == {"file_id": str(stored.id)}
    assert "http" not in str(entry.new_data) and "X-Amz" not in str(entry.new_data)


async def test_store_image_rejects_invalid_images(client: AsyncClient, session: AsyncSession) -> None:
    owner, store = await _store(session)
    for data, content_type, code in (
        (_image(fmt="JPEG"), "image/webp", "image_type_not_allowed"),
        (_image(size=(63, 400)), "image/png", "image_dimensions_invalid"),
        (b"\x89PNG\r\n\x1a\n" + b"\0" * (5 * 1024 * 1024), "image/png", "image_too_large"),
    ):
        response = await client.put(LOGO, files=_files(data, content_type=content_type), headers=auth(owner, store))
        assert response.status_code == 422 and response.json()["error"]["code"] == code
    assert await _rows(session, "ORG_LOGO") == []


# --- replacement --------------------------------------------------------------------------------------------------


async def test_store_image_replace_retires_old_and_deletes_it_only_after_commit(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch, forbid_row_deletion: None
) -> None:
    owner, store = await _store(session)
    first_url = (await client.put(LOGO, files=_files(_image()), headers=auth(owner, store))).json()["logo_url"]
    [old] = await _rows(session, "ORG_LOGO")

    seen: list[tuple[object, object]] = []
    original = images.delete_object_quietly

    async def _spy(key: str) -> bool:
        async with get_engine().connect() as other:  # another connection: sees committed state only
            pointer = (
                await other.execute(text("SELECT logo_file_id FROM stores WHERE id = :id"), {"id": store.id})
            ).scalar()
            retired = (
                await other.execute(text("SELECT deleted_at FROM stored_files WHERE id = :id"), {"id": old.id})
            ).scalar()
        seen.append((pointer, retired))
        assert key == old.storage_key and await _object_exists(key)
        return await original(key)

    monkeypatch.setattr(images, "delete_object_quietly", _spy)
    response = await client.put(LOGO, files=_files(_image(colour=(250, 0, 0))), headers=auth(owner, store))
    assert response.status_code == 200

    retired, active = await _rows(session, "ORG_LOGO")
    assert retired.id == old.id and retired.deleted_at is not None and active.deleted_at is None
    assert (await _fresh(session, Store, store.id)).logo_file_id == active.id
    assert seen == [(active.id, retired.deleted_at)]
    assert not await _object_exists(old.storage_key) and await _object_exists(active.storage_key)
    assert (await _download(first_url)).status_code == 404
    assert urlsplit(response.json()["logo_url"]).path.endswith(active.storage_key)
    assert await _logo_actions(session, store.id) == ["organization.logo_updated"] * 2


async def test_failed_store_image_transaction_keeps_old_image_and_cleans_new_object(
    lenient_client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, store = await _store(session)
    first_url = (await lenient_client.put(LOGO, files=_files(_image()), headers=auth(owner, store))).json()["logo_url"]
    [old] = await _rows(session, "ORG_LOGO")

    new_keys: list[str] = []
    original_put = images.put_image

    async def _capture(*args: Any, **kwargs: Any) -> str:
        new_keys.append(await original_put(*args, **kwargs))
        return new_keys[-1]

    async def _db_failure(db: AsyncSession, stored: StoredFile) -> None:
        await db.execute(text("SELECT 1 / 0"))

    monkeypatch.setattr(images, "put_image", _capture)
    monkeypatch.setattr(images, "retire", _db_failure)
    response = await lenient_client.put(LOGO, files=_files(_image(colour=(3, 3, 3))), headers=auth(owner, store))
    assert response.status_code == 500 and response.json()["error"]["code"] == "internal_error"
    assert "division" not in response.text and "stored_files" not in response.text

    [still] = await _rows(session, "ORG_LOGO")
    assert still.id == old.id and still.deleted_at is None
    assert (await _fresh(session, Store, store.id)).logo_file_id == old.id
    assert await _object_exists(old.storage_key) and (await _download(first_url)).status_code == 200
    assert len(new_keys) == 1 and not await _object_exists(new_keys[0])
    assert await _logo_actions(session, store.id) == ["organization.logo_updated"]


async def test_store_image_post_commit_deletion_failure_still_succeeds(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, store = await _store(session)
    await client.put(LOGO, files=_files(_image()), headers=auth(owner, store))
    [old] = await _rows(session, "ORG_LOGO")

    async def _unreachable(self: Storage, key: str) -> None:
        raise ConnectionError("storage unreachable")

    monkeypatch.setattr(Storage, "delete", _unreachable)
    response = await client.put(LOGO, files=_files(_image(colour=(7, 7, 7))), headers=auth(owner, store))
    assert response.status_code == 200 and response.json()["logo_url"]
    retired, active = await _rows(session, "ORG_LOGO")
    assert retired.id == old.id and retired.deleted_at is not None  # recoverable: retired row + surviving object
    assert (await _fresh(session, Store, store.id)).logo_file_id == active.id
    assert await _object_exists(old.storage_key)


async def test_concurrent_store_image_replacements_are_serialized(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, store = await _store(session)
    await client.put(LOGO, files=_files(_image()), headers=auth(owner, store))

    original_add = images.add_image_row

    async def _slow_add(*args: Any, **kwargs: Any) -> StoredFile:
        stored = await original_add(*args, **kwargs)
        await asyncio.sleep(0.3)  # keep the stores row locked while the other request waits for it
        return stored

    monkeypatch.setattr(images, "add_image_row", _slow_add)
    responses = await asyncio.gather(
        client.put(LOGO, files=_files(_image(colour=(255, 0, 0))), headers=auth(owner, store)),
        client.put(LOGO, files=_files(_image(colour=(0, 0, 255))), headers=auth(owner, store)),
    )
    assert [r.status_code for r in responses] == [200, 200]

    rows = await _rows(session, "ORG_LOGO")
    active = [row for row in rows if row.deleted_at is None]
    assert len(rows) == 3 and len(active) == 1  # no duplicate active image
    assert (await _fresh(session, Store, store.id)).logo_file_id == active[0].id
    for row in rows:
        assert await _object_exists(row.storage_key) == (row.deleted_at is None)


# --- removal ------------------------------------------------------------------------------------------------------


async def test_store_image_remove_retires_row_and_deletes_object_after_commit(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch, forbid_row_deletion: None
) -> None:
    owner, store = await _store(session)
    url = (await client.put(LOGO, files=_files(_image()), headers=auth(owner, store))).json()["logo_url"]
    [stored] = await _rows(session, "ORG_LOGO")

    committed: list[tuple[object, object]] = []
    original = images.delete_object_quietly

    async def _spy(key: str) -> bool:
        async with get_engine().connect() as other:
            pointer = (
                await other.execute(text("SELECT logo_file_id FROM stores WHERE id = :id"), {"id": store.id})
            ).scalar()
            retired = (
                await other.execute(text("SELECT deleted_at FROM stored_files WHERE id = :id"), {"id": stored.id})
            ).scalar()
        committed.append((pointer, retired is not None))
        return await original(key)

    monkeypatch.setattr(images, "delete_object_quietly", _spy)
    response = await client.delete(LOGO, headers=auth(owner, store))
    assert response.status_code == 200 and response.json()["logo_url"] is None
    assert committed == [(None, True)]

    [retired] = await _rows(session, "ORG_LOGO")
    assert retired.id == stored.id and retired.deleted_at is not None
    assert (await _fresh(session, Store, store.id)).logo_file_id is None
    assert not await _object_exists(stored.storage_key) and (await _download(url)).status_code == 404
    assert (await client.get("/api/v1/organization", headers=auth(owner, store))).json()["logo_url"] is None

    [removal] = (await session.scalars(select(AuditLog).where(AuditLog.action == "organization.logo_removed"))).all()
    assert removal.entity_id == store.id and removal.org_id == store.id and removal.actor_id == owner.id
    assert removal.old_data == {"file_id": str(stored.id)} and removal.new_data == {"file_id": None}


async def test_store_image_remove_is_idempotent_without_audit(client: AsyncClient, session: AsyncSession) -> None:
    owner, store = await _store(session)
    for _ in range(2):
        response = await client.delete(LOGO, headers=auth(owner, store))
        assert response.status_code == 200 and response.json()["logo_url"] is None
    assert await _rows(session, "ORG_LOGO") == []
    assert await _logo_actions(session, store.id) == []


# --- authorization and isolation ----------------------------------------------------------------------------------


async def test_store_seller_cannot_change_the_store_image(client: AsyncClient, session: AsyncSession) -> None:
    owner, store = await _store(session)
    seller = await make_user(session)
    await add_member(session, store, seller, "SELLER")
    await session.commit()
    await client.put(LOGO, files=_files(_image()), headers=auth(owner, store))
    [image] = await _rows(session, "ORG_LOGO")

    for response in (
        await client.put(LOGO, files=_files(_image(colour=(1, 1, 1))), headers=auth(seller, store)),
        await client.delete(LOGO, headers=auth(seller, store)),
    ):
        assert response.status_code == 403 and response.json()["error"]["code"] == "permission_denied"
    [unchanged] = await _rows(session, "ORG_LOGO")
    assert unchanged.id == image.id and unchanged.deleted_at is None and await _object_exists(image.storage_key)
    assert (await client.get("/api/v1/organization", headers=auth(seller, store))).json()["logo_url"]  # may view


async def test_another_store_cannot_replace_or_remove_this_store_image(
    client: AsyncClient, session: AsyncSession
) -> None:
    owner, store = await _store(session, "Victim Store")
    rival, rival_store = await _store(session, "Rival Store")
    await client.put(LOGO, files=_files(_image()), headers=auth(owner, store))
    [image] = await _rows(session, "ORG_LOGO")

    foreign = auth(rival)
    foreign["X-Org-Id"] = str(store.id)  # a store id the rival is not a member of
    for response in (
        await client.put(LOGO, files=_files(_image()), headers=foreign),
        await client.delete(LOGO, headers=foreign),
    ):
        assert response.status_code == 404 and response.json()["error"]["code"] == "not_found"

    # Ids in the body or query are ignored: the rival only ever changes their own store.
    own = await client.put(
        f"{LOGO}?store_id={store.id}",
        files=_files(_image()),
        data={"store_id": str(store.id), "organization_id": str(store.id)},
        headers=auth(rival, rival_store),
    )
    assert own.status_code == 200 and own.json()["id"] == str(rival_store.id)
    removed = await client.delete(f"{LOGO}?store_id={store.id}", headers=auth(rival, rival_store))
    assert removed.status_code == 200

    assert (await _fresh(session, Store, store.id)).logo_file_id == image.id
    kept = await _fresh(session, StoredFile, image.id)
    assert kept.deleted_at is None and await _object_exists(image.storage_key)
    assert all(row.organization_id in (store.id, rival_store.id) for row in await _rows(session, "ORG_LOGO"))


async def test_store_image_company_logo_and_avatar_are_independent(client: AsyncClient, session: AsyncSession) -> None:
    """One person owning a company and a store, with an avatar: changing one image never touches the others."""
    person = await make_user(session)
    company = await make_org(session, person, "COMPANY", "Pamir Distribution")
    store = await make_org(session, person, "STORE", "Corner Market")
    await session.commit()
    await client.put(AVATAR, files=_files(_image()), headers=auth(person))
    await client.put(LOGO, files=_files(_image()), headers=auth(person, company))
    await client.put(LOGO, files=_files(_image()), headers=auth(person, store))
    [avatar] = await _rows(session, "USER_AVATAR")
    company_logo, store_image = await _rows(session, "ORG_LOGO")
    assert (company_logo.organization_id, store_image.organization_id) == (company.id, store.id)

    await client.put(LOGO, files=_files(_image(colour=(9, 9, 9))), headers=auth(person, store))
    await client.delete(LOGO, headers=auth(person, store))

    assert (await _fresh(session, Company, company.id)).logo_file_id == company_logo.id
    assert (await _fresh(session, User, person.id)).avatar_file_id == avatar.id
    assert (await _fresh(session, Store, store.id)).logo_file_id is None
    for kept in (avatar, company_logo):
        assert (await _fresh(session, StoredFile, kept.id)).deleted_at is None and await _object_exists(
            kept.storage_key
        )
    assert (await _fresh(session, StoredFile, store_image.id)).deleted_at is not None

    me = (await client.get("/api/v1/me", headers=auth(person))).json()
    logos = {m["org_type"]: m["logo_url"] for m in me["memberships"]}
    assert me["avatar_url"] and logos["COMPANY"] and logos["STORE"] is None


async def test_store_image_cannot_be_user_owned_nor_an_avatar(session: AsyncSession) -> None:
    """Database-level ownership rules (0008): an ORG_LOGO is organization-owned, a USER_AVATAR user-owned."""
    owner, store = await _store(session)

    def _row(**fields: Any) -> StoredFile:
        base: dict[str, Any] = {
            "storage_key": f"test/{fields['category'].lower()}/{uuid4()}",
            "content_type": "image/webp",
            "size_bytes": 1,
            "sha256": "a" * 64,
            "display_name": "x.webp",
            "uploaded_by": owner.id,
        }
        return StoredFile(**base, **fields)

    for bad in (
        _row(category="ORG_LOGO", owner_user_id=owner.id),  # a store image owned by a user
        _row(category="ORG_LOGO", organization_id=store.id, owner_user_id=owner.id),  # two owners
        _row(category="USER_AVATAR", organization_id=store.id),  # an avatar owned by the store
    ):
        session.add(bad)
        with pytest.raises(IntegrityError, match="ck_stored_files_"):
            await session.flush()
        await session.rollback()


async def test_retired_store_image_is_never_signed(client: AsyncClient, session: AsyncSession) -> None:
    owner, store = await _store(session)
    await client.put(LOGO, files=_files(_image()), headers=auth(owner, store))
    await client.put(LOGO, files=_files(_image(colour=(4, 4, 4))), headers=auth(owner, store))
    old, active = await _rows(session, "ORG_LOGO")

    assert await images.image_url(session, old.id) is None
    assert set(await images.active_image_urls(session, [old.id, active.id])) == {active.id}
    by_files_api = await client.get(f"/api/v1/files/{old.id}/url", headers=auth(owner, store))
    assert by_files_api.status_code == 404
    profile = (await client.get("/api/v1/organization", headers=auth(owner, store))).json()
    assert old.storage_key not in profile["logo_url"] and active.storage_key in profile["logo_url"]
