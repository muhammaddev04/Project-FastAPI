import asyncio
import json
import logging
from uuid import UUID

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.logging import JsonFormatter
from app.core.request_context import RequestContextMiddleware, bind_actor, get_actor


async def test_fnd_019_actor_context_isolated_and_reset() -> None:
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)

    @app.get("/actor/{user}/{org}")
    async def actor(user: UUID, org: UUID) -> dict[str, str | None]:
        bind_actor(user, org)
        await asyncio.sleep(0)
        record = logging.LogRecord("test", logging.INFO, __file__, 1, "hello", None, None)
        return json.loads(JsonFormatter().format(record))

    before = get_actor()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://t") as client:
        users = [UUID(int=1), UUID(int=2)]
        orgs = [UUID(int=3), UUID(int=4)]
        responses = await asyncio.gather(
            *(client.get(f"/actor/{user}/{org}") for user, org in zip(users, orgs, strict=True))
        )
    for response, user, org in zip(responses, users, orgs, strict=True):
        assert response.json()["user_id"] == str(user)
        assert response.json()["org_id"] == str(org)
        assert response.json()["request_id"]
    assert get_actor() == before
