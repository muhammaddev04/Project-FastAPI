"""Download grants and the production image route need no database or Redis."""

from datetime import timedelta
from unittest.mock import AsyncMock, Mock
from urllib.parse import urlsplit

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from minio.error import S3Error

from app.core.config import Settings
from app.core.errors import register_error_handlers
from app.core.storage import Storage
from app.core.time import utcnow
from app.modules.files import router as files_router


@pytest.fixture(scope="session", autouse=True)
def _migrated_database():
    """Override database setup: these tests exercise storage and HTTP only."""


@pytest.fixture(autouse=True)
def _clean_state():
    """No database or Redis state is created."""


@pytest.fixture
def private_storage(monkeypatch):
    settings = Settings(_env_file=None).model_copy(update={"app_env": "production", "s3_endpoint": "storage:8333"})
    monkeypatch.setattr("app.core.storage.get_settings", lambda: settings)
    storage = Storage(Mock(), settings.s3_bucket_private)
    storage.read = AsyncMock(return_value=b"image bytes")
    monkeypatch.setattr(files_router, "get_storage", lambda: storage)
    return storage


async def request_content(url):
    app = FastAPI()
    app.include_router(files_router.router)
    register_error_handlers(app)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://site.test") as client:
        return await client.get(url)


async def test_production_download_uses_same_origin_and_no_bearer_token(private_storage):
    key = "users/person/user_avatar/photo.webp"
    signed = await private_storage.signed_url(key)
    assert signed.url.startswith("/api/v1/files/content/")
    assert not urlsplit(signed.url).netloc
    assert 0 < (signed.expires_at - utcnow()).total_seconds() <= 300
    private_storage._client.presigned_get_object.assert_not_called()
    response = await request_content(signed.url)
    assert response.status_code == 200
    assert response.content == b"image bytes"
    assert response.headers["content-type"] == "image/webp"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    private_storage.read.assert_awaited_once_with(key)


@pytest.mark.parametrize("change", ["object", "expiry", "signature", "missing", "expired"])
async def test_download_rejects_invalid_grant_before_storage(private_storage, change):
    ttl = timedelta(seconds=-1) if change == "expired" else timedelta(minutes=5)
    url = (await private_storage.signed_url("users/person/user_avatar/photo.webp", ttl)).url
    if change == "object":
        url = url.replace("photo.webp", "other.webp")
    elif change == "expiry":
        url = url.replace("expires=", "expires=9")
    elif change == "signature":
        url = url.rsplit("=", 1)[0] + "=bad"
    elif change == "missing":
        url = urlsplit(url).path
    response = await request_content(url)
    assert response.status_code == 403
    private_storage.read.assert_not_awaited()


@pytest.mark.parametrize("code, expected", [("NoSuchKey", 404), ("AccessDenied", 503)])
async def test_download_handles_deleted_object_and_storage_failure(private_storage, code, expected):
    url = (await private_storage.signed_url("photo.webp")).url
    private_storage.read.side_effect = S3Error(Mock(), code, "error", "resource", "request", "host")
    response = await request_content(url)
    assert response.status_code == expected


async def test_development_downloads_do_not_expose_internal_s3_hosts(monkeypatch):
    monkeypatch.setattr("app.core.storage.get_settings", lambda: Settings(_env_file=None, app_env="development"))
    client = Mock()
    client.presigned_get_object.return_value = "http://localhost:9000/private/photo.webp?signature=abc"
    signed = await Storage(client, "private").signed_url("photo.webp")
    assert signed.url.startswith("/api/v1/files/content/photo.webp?")
    assert 0 < (signed.expires_at - utcnow()).total_seconds() <= 300
    client.presigned_get_object.assert_not_called()
