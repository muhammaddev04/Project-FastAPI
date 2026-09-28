"""CR-003 profile-image lifecycle: retired stored files (migration 0009) and the post-commit object removal."""

from __future__ import annotations

import asyncio
import io
import logging
from pathlib import Path
from uuid import UUID, uuid4

import httpx
import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from httpx import AsyncClient
from minio.error import S3Error
from PIL import Image
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.config import get_settings
from app.core.db import Base
from app.core.errors import AppError
from app.core.storage import get_storage
from app.modules.files import images
from app.modules.files.images import add_image_row, delete_object_quietly, normalize_image, put_image, retire
from app.modules.files.models import StoredFile
from app.modules.files.service import get_owned
from app.modules.identity.models import User
from app.modules.organizations.models import Company
from tests.factories import auth, make_org, make_user

BACKEND_DIR = Path(__file__).resolve().parents[2]
PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n"


def _png(size: tuple[int, int] = (80, 80), colour: tuple[int, int, int] = (10, 120, 200)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, "PNG")
    return buffer.getvalue()


async def _row(
    session: AsyncSession, uploader: User, category: str, *, org_id: UUID | None = None, user_id: UUID | None = None
) -> StoredFile:
    """A stored_files row without an object - enough for the database-level rules."""
    stored = StoredFile(
        organization_id=org_id,
        owner_user_id=user_id,
        category=category,
        storage_key=f"test/{category.lower()}/{uuid4()}",
        content_type="image/webp",
        size_bytes=10,
        sha256="a" * 64,
        display_name="x.webp",
        uploaded_by=uploader.id,
    )
    session.add(stored)
    await session.flush()
    return stored


async def _download_status(url: str) -> int:
    async with httpx.AsyncClient() as http:
        return (await http.get(url)).status_code


# --- migration 0009 -----------------------------------------------------------------------------------------------


def _head() -> str:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    heads = ScriptDirectory.from_config(config).get_heads()
    assert len(heads) == 1
    return heads[0]


async def test_migration_0009_is_applied_and_models_match_the_database(session: AsyncSession) -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    assert ScriptDirectory.from_config(config).get_revision("0009") is not None
    assert (await session.execute(text("SELECT version_num FROM alembic_version"))).scalar_one() == _head()

    def _diff(connection: object) -> list[object]:
        context = MigrationContext.configure(connection, opts={"compare_type": True})  # type: ignore[arg-type]
        return list(compare_metadata(context, Base.metadata))

    connection = await session.connection()
    assert await connection.run_sync(_diff) == []
    checks = await session.execute(
        text("SELECT conname FROM pg_constraint WHERE conrelid = 'stored_files'::regclass AND contype = 'c'")
    )
    assert "ck_stored_files_deleted_only_profile_images" in set(checks.scalars())


async def test_delete_trigger_is_unchanged(session: AsyncSession) -> None:
    definition = (
        await session.execute(
            text("SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'stored_files_no_delete'")
        )
    ).scalar_one()
    assert "BEFORE DELETE ON public.stored_files FOR EACH ROW EXECUTE FUNCTION forbid_mutation()" in definition


def test_downgrade_refuses_while_retired_rows_exist_and_round_trips_when_clean() -> None:
    """Sync test: Alembic runs its own event loop (migrations/env.py), exactly like the session fixture in conftest."""
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))

    async def _sql(statement: str) -> object:
        engine = create_async_engine(get_settings().database_url)
        try:
            async with engine.begin() as connection:
                result = await connection.execute(text(statement))
                return result.scalar() if result.returns_rows else None
        finally:
            await engine.dispose()

    async def _seed_retired_avatar() -> None:
        engine = create_async_engine(get_settings().database_url)
        try:
            async with AsyncSession(engine) as db:
                user = User(full_name="Retired Avatar", password_hash="x", email="retired@example.tj")
                db.add(user)
                await db.flush()
                stored = await _row(db, user, "USER_AVATAR", user_id=user.id)
                await retire(db, stored)
                await db.commit()
        finally:
            await engine.dispose()

    asyncio.run(_seed_retired_avatar())
    with pytest.raises(RuntimeError, match="cannot downgrade 0009: 1 retired profile image row"):
        command.downgrade(config, "0008")
    assert asyncio.run(_sql("SELECT version_num FROM alembic_version")) == _head()  # refused: nothing changed

    asyncio.run(_sql("TRUNCATE users, stored_files CASCADE"))
    command.downgrade(config, "0008")
    column = (
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_name = 'stored_files' AND column_name = 'deleted_at'"
    )
    assert asyncio.run(_sql(column)) == 0
    command.upgrade(config, "head")
    assert asyncio.run(_sql(column)) == 1
    assert asyncio.run(_sql("SELECT version_num FROM alembic_version")) == _head()


# --- retire -------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("category", ["USER_AVATAR", "ORG_LOGO"])
async def test_profile_images_can_be_retired_and_the_row_stays(session: AsyncSession, category: str) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    owner_kwargs = {"user_id": owner.id} if category == "USER_AVATAR" else {"org_id": org.id}
    stored = await _row(session, owner, category, **owner_kwargs)
    await session.commit()

    await retire(session, stored)
    first = stored.deleted_at
    await retire(session, stored)  # idempotent: the first retirement time is kept
    await session.commit()

    session.expunge_all()  # the next reads come from the database, not the identity map
    reloaded = await session.get(StoredFile, stored.id)
    assert reloaded is not None and reloaded.deleted_at is not None and reloaded.deleted_at == first
    # Everything else is history and stays exactly as uploaded.
    assert (reloaded.category, reloaded.storage_key, reloaded.sha256, reloaded.uploaded_by) == (
        category,
        stored.storage_key,
        "a" * 64,
        owner.id,
    )
    assert (await session.execute(select(func.count()).select_from(StoredFile))).scalar_one() == 1


@pytest.mark.parametrize("category", ["VERIFICATION", "IMPORT", "EXPORT", "PRODUCT_IMAGE"])
async def test_other_categories_cannot_be_retired(session: AsyncSession, category: str) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    stored = await _row(session, owner, category, org_id=org.id)
    await session.commit()

    with pytest.raises(ValueError, match="can be retired"):
        await retire(session, stored)
    assert stored.deleted_at is None

    # The database refuses it on its own, whatever code path tries.
    with pytest.raises(IntegrityError, match="ck_stored_files_deleted_only_profile_images"):
        await session.execute(text("UPDATE stored_files SET deleted_at = now() WHERE id = :id"), {"id": stored.id})
    await session.rollback()


async def test_delete_trigger_still_rejects_row_deletion_even_when_retired(session: AsyncSession) -> None:
    owner = await make_user(session)
    stored = await _row(session, owner, "USER_AVATAR", user_id=owner.id)
    await retire(session, stored)
    await session.commit()

    stored_id = stored.id
    with pytest.raises(DBAPIError, match="append-only"):
        await session.execute(text("DELETE FROM stored_files WHERE id = :id"), {"id": stored_id})
    await session.rollback()
    with pytest.raises(DBAPIError, match="append-only"):
        await session.delete(await session.get(StoredFile, stored_id))
        await session.flush()
    await session.rollback()
    assert (await session.execute(select(func.count()).select_from(StoredFile))).scalar_one() == 1


# --- active-file lookups ------------------------------------------------------------------------------------------


async def test_get_owned_skips_retired_rows_and_keeps_active_ones(session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    active = await _row(session, owner, "ORG_LOGO", org_id=org.id)
    retired = await _row(session, owner, "ORG_LOGO", org_id=org.id)
    await retire(session, retired)
    await session.commit()

    assert (await get_owned(session, org.id, active.id)).id == active.id
    with pytest.raises(AppError) as caught:
        await get_owned(session, org.id, retired.id)
    assert (caught.value.code, caught.value.http_status) == ("not_found", 404)


async def test_retired_logo_is_not_signed_by_the_files_api(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    image = normalize_image("image/png", _png())
    active_key = await put_image(image, category="ORG_LOGO", organization_id=org.id)
    retired_key = await put_image(image, category="ORG_LOGO", organization_id=org.id)
    active = await add_image_row(
        session,
        image,
        storage_key=active_key,
        category="ORG_LOGO",
        uploaded_by=owner.id,
        filename="logo.png",
        organization_id=org.id,
    )
    retired = await add_image_row(
        session,
        image,
        storage_key=retired_key,
        category="ORG_LOGO",
        uploaded_by=owner.id,
        filename="old.png",
        organization_id=org.id,
    )
    await retire(session, retired)
    await session.commit()

    signed = await client.get(f"/api/v1/files/{active.id}/url", headers=auth(owner, org))
    assert signed.status_code == 200 and await _download_status(signed.json()["url"]) == 200
    gone = await client.get(f"/api/v1/files/{retired.id}/url", headers=auth(owner, org))
    assert gone.status_code == 404 and gone.json()["error"]["code"] == "not_found"
    await delete_object_quietly(active_key)
    await delete_object_quietly(retired_key)


async def test_verification_upload_is_active_and_unchanged(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    await session.commit()
    response = await client.post(
        "/api/v1/files",
        headers=auth(owner, org),
        data={"category": "VERIFICATION"},
        files={"file": ("cert.pdf", PDF, "application/pdf")},
    )
    assert response.status_code == 201
    stored = await session.get(StoredFile, UUID(response.json()["id"]))
    assert stored is not None and stored.deleted_at is None and stored.category == "VERIFICATION"
    assert set(response.json()) == {"id", "display_name", "size_bytes", "content_type", "category", "created_at"}
    signed = await client.get(f"/api/v1/files/{stored.id}/url", headers=auth(owner, org))
    assert signed.status_code == 200 and await _download_status(signed.json()["url"]) == 200
    with pytest.raises(ValueError):
        await retire(session, stored)


# --- storage object removal ---------------------------------------------------------------------------------------


async def test_delete_object_quietly_is_idempotent_and_kills_signed_urls() -> None:
    key = "test/lifecycle/idempotent.webp"
    await get_storage().put_private(key, b"RIFF....WEBP", "image/webp")
    url = (await get_storage().signed_url(key)).url
    assert await _download_status(url) == 200

    assert await delete_object_quietly(key) is True
    assert await _download_status(url) == 404  # an already issued signed URL stops working
    assert await delete_object_quietly(key) is True  # second call: already absent -> still success


async def test_missing_object_is_success() -> None:
    assert await delete_object_quietly("test/lifecycle/never-existed.webp") is True


@pytest.mark.parametrize(
    "failure",
    [
        ConnectionError("storage down at http://user:secret@storage:8333"),
        S3Error(None, "AccessDenied", "secret message", "/bucket/key", "request-id", "host-id"),  # type: ignore[arg-type]
    ],
)
async def test_storage_failure_is_logged_not_raised(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, failure: Exception
) -> None:
    class _Broken:
        async def delete(self, key: str) -> None:
            raise failure

    monkeypatch.setattr(images, "get_storage", lambda: _Broken())
    with caplog.at_level(logging.WARNING, logger=images.logger.name):
        assert await delete_object_quietly("org/org_logo/k.webp") is False
    record = next(r for r in caplog.records if r.name == images.logger.name)
    assert record.storage_key == "org/org_logo/k.webp"  # type: ignore[attr-defined]
    assert record.error in {"ConnectionError", "AccessDenied"}  # type: ignore[attr-defined]
    assert "secret" not in record.getMessage() and "secret" not in str(record.__dict__.get("error"))


async def test_storage_failure_after_commit_is_not_an_api_failure(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The endpoint layer calls this after committing; a missing or unreachable object must not become a 500."""

    class _Broken:
        async def delete(self, key: str) -> None:
            raise OSError("connection reset")

    monkeypatch.setattr(images, "get_storage", lambda: _Broken())
    assert await delete_object_quietly("gone.webp") is False
    user = await make_user(session)
    await session.commit()
    assert (await client.get("/api/v1/me", headers=auth(user))).status_code == 200


# --- the replace/remove ordering the endpoints will follow --------------------------------------------------------


async def test_replace_flow_keeps_history_and_serves_only_the_new_object(session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    company = await session.get(Company, org.id)
    assert company is not None
    old_image = normalize_image("image/png", _png(colour=(200, 0, 0)))
    old_key = await put_image(old_image, category="ORG_LOGO", organization_id=org.id)
    old = await add_image_row(
        session,
        old_image,
        storage_key=old_key,
        category="ORG_LOGO",
        uploaded_by=owner.id,
        filename="a.png",
        organization_id=org.id,
    )
    company.logo_file_id = old.id
    await session.commit()
    old_url = (await get_storage().signed_url(old_key)).url

    # 1-2: normalize + upload under a new key; 4: lock the owner row; 5-7: new row, pointer, retire; 9: commit.
    new_image = normalize_image("image/png", _png(colour=(0, 200, 0)))
    new_key = await put_image(new_image, category="ORG_LOGO", organization_id=org.id)
    assert new_key != old_key and "a.png" not in new_key
    locked = (await session.execute(select(Company).where(Company.id == org.id).with_for_update())).scalar_one()
    new = await add_image_row(
        session,
        new_image,
        storage_key=new_key,
        category="ORG_LOGO",
        uploaded_by=owner.id,
        filename="b.png",
        organization_id=org.id,
    )
    locked.logo_file_id = new.id
    await retire(session, old)
    await session.commit()
    # 10: only after the commit is the old object removed.
    assert await delete_object_quietly(old_key) is True

    assert await _download_status(old_url) == 404
    assert await _download_status((await get_storage().signed_url(new_key)).url) == 200
    session.expunge_all()  # the next reads come from the database, not the identity map
    rows = {row.id: row for row in (await session.scalars(select(StoredFile))).all()}
    assert set(rows) == {old.id, new.id} and rows[old.id].deleted_at is not None and rows[new.id].deleted_at is None
    assert (await session.get(Company, org.id)).logo_file_id == new.id  # type: ignore[union-attr]
    await delete_object_quietly(new_key)


async def test_failed_replace_rolls_back_and_only_the_new_object_is_removed(session: AsyncSession) -> None:
    owner = await make_user(session)
    old_image = normalize_image("image/png", _png())
    old_key = await put_image(old_image, category="USER_AVATAR", owner_user_id=owner.id)
    old = await add_image_row(
        session,
        old_image,
        storage_key=old_key,
        category="USER_AVATAR",
        uploaded_by=owner.id,
        filename=None,
        owner_user_id=owner.id,
    )
    owner.avatar_file_id = old.id
    await session.commit()
    owner_id, old_id = owner.id, old.id  # the rollback below expires both objects

    new_key = await put_image(old_image, category="USER_AVATAR", owner_user_id=owner.id)
    try:
        await session.execute(select(User).where(User.id == owner.id).with_for_update())
        new = await add_image_row(
            session,
            old_image,
            storage_key=old_key,
            category="USER_AVATAR",
            uploaded_by=owner.id,
            filename=None,
            owner_user_id=owner.id,
        )  # reusing the old key violates uq_stored_files_storage_key: the transaction fails
        owner.avatar_file_id = new.id
        await retire(session, old)
        await session.commit()
    except IntegrityError:
        await session.rollback()
        assert await delete_object_quietly(new_key) is True

    session.expunge_all()  # the next reads come from the database, not the identity map
    reloaded = await session.get(User, owner_id)
    assert reloaded is not None and reloaded.avatar_file_id == old_id
    kept = await session.get(StoredFile, old_id)
    assert kept is not None and kept.deleted_at is None
    assert await _download_status((await get_storage().signed_url(old_key)).url) == 200
    assert await _download_status((await get_storage().signed_url(new_key)).url) == 404
    await delete_object_quietly(old_key)


async def test_put_image_requires_one_owner_and_a_profile_category() -> None:
    image = normalize_image("image/png", _png())
    with pytest.raises(ValueError):
        await put_image(image, category="VERIFICATION", organization_id=UUID(int=1))
    with pytest.raises(ValueError):
        await put_image(image, category="ORG_LOGO")
    with pytest.raises(ValueError):
        await put_image(image, category="USER_AVATAR", organization_id=UUID(int=1), owner_user_id=UUID(int=2))
