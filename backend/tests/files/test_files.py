from __future__ import annotations

import hashlib

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.files.models import StoredFile
from app.modules.files.service import display_name
from tests.factories import add_member, auth, make_org, make_user

PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


async def _upload(
    client: AsyncClient, headers: dict[str, str], content: bytes, content_type: str, name: str = "cert.pdf"
):
    return await client.post(
        "/api/v1/files",
        headers=headers,
        data={"category": "VERIFICATION"},
        files={"file": (name, content, content_type)},
    )


async def test_ver_002_upload_stores_private_file_with_hash(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    await session.commit()
    response = await _upload(client, auth(owner, org), PDF, "application/pdf", "../../etc/Registration Cert.pdf")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["display_name"] == "Registration Cert.pdf"
    assert body["size_bytes"] == len(PDF) and body["content_type"] == "application/pdf"
    stored = (await session.execute(select(StoredFile))).scalar_one()
    assert stored.sha256 == hashlib.sha256(PDF).hexdigest()
    # FND-017: the key is built from ids, never from the uploaded file name.
    assert stored.storage_key.startswith(f"{org.id}/verification/") and "Cert" not in stored.storage_key


async def test_ver_002_file_magic_bytes_mismatch_rejected(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    await session.commit()
    response = await _upload(client, auth(owner, org), b"MZ\x90\x00 not really a pdf", "application/pdf")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "file_type_not_allowed"


@pytest.mark.parametrize("content_type", ["application/zip", "text/html", "image/svg+xml"])
async def test_ver_002_type_whitelist(client: AsyncClient, session: AsyncSession, content_type: str) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    await session.commit()
    response = await _upload(client, auth(owner, org), PDF, content_type)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "file_type_not_allowed"


async def test_ver_002_size_limit(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    await session.commit()
    big = b"%PDF-" + b"0" * (10 * 1024 * 1024)
    response = await _upload(client, auth(owner, org), big, "application/pdf")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "file_too_large"


async def test_verification_upload_requires_owner(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    manager = await make_user(session)
    await add_member(session, org, manager, "MANAGER")
    await session.commit()
    response = await _upload(client, auth(manager, org), PDF, "application/pdf")
    assert response.status_code == 403


async def test_ver_004_signed_url_only_owner_and_other_org_404(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    manager = await make_user(session)
    await add_member(session, org, manager, "MANAGER")
    stranger = await make_user(session)
    other_org = await make_org(session, stranger)
    await session.commit()
    file_id = (await _upload(client, auth(owner, org), PNG, "image/png", "scan.png")).json()["id"]

    signed = await client.get(f"/api/v1/files/{file_id}/url", headers=auth(owner, org))
    assert signed.status_code == 200
    assert signed.headers["Cache-Control"] == "no-store"
    body = signed.json()
    assert body["url"].startswith("/api/v1/files/content/") and "signature=" in body["url"]
    downloaded = await client.get(body["url"])
    assert downloaded.status_code == 200 and downloaded.content == PNG

    assert (await client.get(f"/api/v1/files/{file_id}/url", headers=auth(manager, org))).status_code == 403
    foreign = await client.get(f"/api/v1/files/{file_id}/url", headers=auth(stranger, other_org))
    assert foreign.status_code == 404 and foreign.json()["error"]["code"] == "not_found"


async def test_ver_005_stored_files_cannot_be_deleted(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    await session.commit()
    await _upload(client, auth(owner, org), PDF, "application/pdf")
    with pytest.raises(DBAPIError, match="append-only"):
        await session.execute(text("DELETE FROM stored_files"))
    await session.rollback()


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("..\\..\\boot.ini", "boot.ini"),
        ("a\x00b<script>.pdf", "ab_script_.pdf"),
        ("", "document.pdf"),
        ("...", "document.pdf"),
    ],
)
def test_display_name_is_sanitised(raw: str, expected: str) -> None:
    assert display_name(raw, "pdf") == expected
