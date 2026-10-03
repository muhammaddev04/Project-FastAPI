from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.outbox import OutboxEvent
from app.modules.identity.models import Membership
from tests.factories import auth, make_org
from tests.verification.test_verification import VERIFY, documents_for, setup


async def test_verification_replay_checks_current_permissions_and_org(
    client: AsyncClient, session: AsyncSession
) -> None:
    owner, org, _ = await setup(session, "STORE")
    documents = await documents_for(client, owner, org)
    headers = auth(owner, org)
    first = await client.post(VERIFY, json={"documents": documents}, headers=headers)
    replay = await client.post(VERIFY, json={"documents": documents}, headers=headers)
    assert first.status_code == replay.status_code == 201
    assert first.json() == replay.json()
    assert await session.scalar(select(func.count()).select_from(OutboxEvent)) == 1

    other = await make_org(session, owner, "STORE")
    await session.commit()
    changed_org = await client.post(
        VERIFY, json={"documents": documents}, headers={**headers, "X-Org-Id": str(other.id)}
    )
    assert changed_org.status_code == 409
    assert changed_org.json()["error"]["code"] == "idempotency_key_reused"

    membership = await session.scalar(select(Membership).where(Membership.organization_id == org.id))
    membership.status = "REVOKED"
    await session.commit()
    denied = await client.post(VERIFY, json={"documents": documents}, headers=headers)
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "membership_inactive"
