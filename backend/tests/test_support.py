import io

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from tests.factories import auth, make_user


async def test_support_privacy_and_review(client: AsyncClient, session: AsyncSession) -> None:
    user = await make_user(session)
    other = await make_user(session)
    admin = await make_user(session, is_superadmin=True)
    await session.commit()
    payload = {"kind": "BUG", "subject": "Broken button", "message": "Clicking the button does nothing."}
    response = await client.post("/api/v1/support", json=payload, headers=auth(user))
    assert response.status_code == 201
    ticket = response.json()
    assert ticket["status"] == "OPEN"
    assert ticket["user_id"] == str(user.id)
    own = await client.get("/api/v1/support", headers=auth(user))
    assert [row["id"] for row in own.json()] == [ticket["id"]]
    assert (await client.get("/api/v1/support", headers=auth(other))).json() == []
    assert (await client.get("/api/v1/admin/support", headers=auth(user))).status_code == 403
    endpoint = f"/api/v1/admin/support/{ticket['id']}"
    update = {"status": "RESOLVED", "reply": "Fixed in the latest release."}
    assert (await client.patch(endpoint, json=update, headers=auth(other))).status_code == 403
    queue = await client.get("/api/v1/admin/support", headers=auth(admin))
    assert queue.json()[0]["id"] == ticket["id"]
    assert (await client.patch(endpoint, json=update, headers=auth(admin))).status_code == 200
    result = (await client.get("/api/v1/support", headers=auth(user))).json()[0]
    assert result["status"] == "RESOLVED"
    assert result["reply"] == update["reply"]


async def test_support_requires_login_and_valid_content(client: AsyncClient, session: AsyncSession) -> None:
    assert (await client.get("/api/v1/support")).status_code == 401
    user = await make_user(session)
    await session.commit()
    response = await client.post("/api/v1/support", headers=auth(user), json={
        "kind": "BUG", "subject": "   ", "message": "          ",
    })
    assert response.status_code == 422


async def test_support_screenshot_is_private_and_validated(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.storage import SignedUrl
    from app.core.time import utcnow
    from app.modules.support import router as support

    objects: dict[str, bytes] = {}

    class Storage:
        async def put_private(self, key: str, data: bytes, content_type: str) -> None:
            assert content_type == "image/webp"
            objects[key] = data

        async def signed_url(self, key: str) -> SignedUrl:
            assert key in objects
            return SignedUrl(url="https://storage.test/private-screenshot", expires_at=utcnow())

        async def delete(self, key: str) -> None:
            objects.pop(key, None)

    monkeypatch.setattr(support, "get_storage", Storage)
    user = await make_user(session)
    other = await make_user(session)
    admin = await make_user(session, is_superadmin=True)
    await session.commit()
    image = io.BytesIO()
    Image.new("RGB", (1800, 1000), "white").save(image, format="PNG")
    response = await client.post(
        "/api/v1/support/with-image", headers=auth(user),
        data={"kind": "BUG"},
        files=[("image", ("screenshot.png", image.getvalue(), "image/png")),
               ("image", ("second.png", image.getvalue(), "image/png"))],
    )
    assert response.status_code == 201
    ticket = response.json()
    assert ticket["has_image"] is True
    assert ticket["image_count"] == 2
    assert ticket["message"] == ""
    assert "image_key" not in ticket
    assert Image.open(io.BytesIO(next(iter(objects.values())))).size == (1800, 1000)
    endpoint = f"/api/v1/support/{ticket['id']}/image"
    assert (await client.get(endpoint, headers=auth(user))).status_code == 200
    assert (await client.get(endpoint, headers=auth(admin))).status_code == 200
    assert (await client.get(endpoint, headers=auth(other))).status_code == 404
    assert (await client.get(endpoint)).status_code == 401
    assert (await client.get(endpoint + "?index=1", headers=auth(user))).status_code == 200
    assert (await client.get(endpoint + "?index=1", headers=auth(admin))).status_code == 200
    assert (await client.get(endpoint + "?index=1", headers=auth(other))).status_code == 404
    assert (await client.get(endpoint + "?index=2", headers=auth(user))).status_code == 404
    invalid = await client.post(
        "/api/v1/support/with-image", headers=auth(user),
        data={"kind": "BUG", "message": "The page layout is broken."},
        files=[("image", ("valid.png", image.getvalue(), "image/png")),
               ("image", ("fake.png", b"not an image", "image/png"))],
    )
    assert invalid.status_code == 422
    assert len(objects) == 2


async def test_support_accepts_description_without_subject(client: AsyncClient, session: AsyncSession) -> None:
    user = await make_user(session)
    await session.commit()
    response = await client.post("/api/v1/support", headers=auth(user), json={
        "kind": "FEEDBACK", "message": "Hi",
    })
    assert response.status_code == 201
    assert response.json()["subject"] == "Hi"
    assert response.json()["has_image"] is False
