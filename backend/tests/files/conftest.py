"""Fixtures shared by the CR-003 profile-image tests (avatar, organization logo, store image)."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.fixture
async def lenient_client() -> AsyncIterator[AsyncClient]:
    """Like `client`, but an unhandled error becomes the 500 response a real client would see."""
    from app.main import app

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="https://testserver") as http:
        yield http


@pytest.fixture
def forbid_row_deletion(monkeypatch: pytest.MonkeyPatch) -> None:
    """Rows of stored_files are retired, never deleted: any session.delete() in a flow fails the test."""

    async def _forbidden(self: AsyncSession, instance: object) -> None:
        raise AssertionError(f"session.delete({type(instance).__name__}) must never be called")

    monkeypatch.setattr(AsyncSession, "delete", _forbidden)
