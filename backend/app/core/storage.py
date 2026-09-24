"""FND-017 private object storage on any S3-compatible service (SeaweedFS in development).

The `minio` client is synchronous, so every call runs in a worker thread to keep the event loop free.
Object keys never contain user-supplied names: `<org_id>/<category>/<uuid7>.<ext>`.
"""

from __future__ import annotations

import asyncio
import io
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from uuid import UUID

from minio import Minio

from app.core.config import get_settings
from app.core.time import new_id, utcnow

SIGNED_URL_TTL = timedelta(minutes=5)  # SEC-008


@dataclass(frozen=True)
class SignedUrl:
    url: str
    expires_at: datetime


def object_key(org_id: UUID, category: str, extension: str) -> str:
    """FND-017: the original filename is never part of the key."""
    return f"{org_id}/{category.lower()}/{new_id()}.{extension}"


class Storage:
    def __init__(self, client: Minio, bucket: str) -> None:
        self._client = client
        self._bucket = bucket
        self._bucket_checked = False

    async def _ensure_bucket(self) -> None:
        if self._bucket_checked:
            return

        def ensure() -> None:
            if not self._client.bucket_exists(self._bucket):
                self._client.make_bucket(self._bucket)

        await asyncio.to_thread(ensure)
        self._bucket_checked = True

    async def put_private(self, key: str, data: bytes, content_type: str) -> None:
        await self._ensure_bucket()
        await asyncio.to_thread(
            self._client.put_object, self._bucket, key, io.BytesIO(data), len(data), content_type=content_type
        )

    async def signed_url(self, key: str, ttl: timedelta = SIGNED_URL_TTL) -> SignedUrl:
        url = await asyncio.to_thread(self._client.presigned_get_object, self._bucket, key, expires=ttl)
        return SignedUrl(url=url, expires_at=utcnow() + ttl)

    async def read(self, key: str) -> bytes:
        def fetch() -> bytes:
            response = self._client.get_object(self._bucket, key)
            try:
                return response.read()
            finally:
                response.close()
                response.release_conn()

        return await asyncio.to_thread(fetch)


@lru_cache(maxsize=1)
def get_storage() -> Storage:
    settings = get_settings()
    client = Minio(
        settings.s3_endpoint,
        access_key=settings.s3_access_key,
        secret_key=settings.s3_secret_key,
        secure=settings.s3_secure,
    )
    return Storage(client, settings.s3_bucket_private)
