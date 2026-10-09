"""P10 remaining acceptance: private files and persisted SLA warnings."""

from datetime import timedelta
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.outbox import OutboxEvent
from app.modules.files.models import StoredFile
from app.modules.returns.jobs import send_sla_warnings
from app.modules.returns.models import DisputeSlaWarning
from app.modules.returns.service import dispute_service
from tests.factories import auth, make_org, make_user
from tests.test_returns_service import delivered, member


async def upload(client: AsyncClient, ctx, category="DISPUTE", content=b"%PDF-1.7\nEvidence"):
    return await client.post(
        "/api/v1/files",
        headers=auth(ctx.user, ctx.organization),
        data={"category": category},
        files={"file": ("evidence.pdf", content, "application/pdf")},
    )


async def opened(client, session):
    company, store, order, _ = await delivered(client, session)
    record = await dispute_service.open(session, store, "ORDER", "QUANTITY", "Delivered quantity differs", order.id)
    await session.commit()
    return company, store, record


async def test_dsp_010_private_attachment_shared_only_with_dispute_parties(client: AsyncClient, session: AsyncSession):
    company, store, order, _ = await delivered(client, session)
    result = await upload(client, store)
    assert result.status_code == 201, result.text
    file_id = UUID(result.json()["id"])
    # Before attachment the other party cannot discover this private file.
    response = await client.get(f"/api/v1/files/{file_id}/url", headers=auth(company.user, company.organization))
    assert response.status_code == 404
    record = await dispute_service.open(
        session, store, "ORDER", "QUANTITY", "Delivered quantity differs", order.id, file_ids=[file_id]
    )
    await session.commit()
    response = await client.get(f"/api/v1/files/{file_id}/url", headers=auth(company.user, company.organization))
    assert response.status_code == 200, response.text
    assert "signature=" in response.json()["url"]
    stranger = await make_user(session)
    foreign = await make_org(session, stranger, "COMPANY")
    await session.commit()
    response = await client.get(f"/api/v1/files/{file_id}/url", headers=auth(stranger, foreign))
    assert response.status_code == 404
    warehouse = await member(session, company, "WAREHOUSE")
    response = await client.get(f"/api/v1/files/{file_id}/url", headers=auth(warehouse.user, warehouse.organization))
    assert response.status_code == 403
    # The company can attach its own evidence, and the store can read that reply.
    reply = await upload(client, company)
    assert reply.status_code == 201
    reply_id = UUID(reply.json()["id"])
    await dispute_service.message(session, company, record.id, "Here is our handover evidence", reply_id)
    await session.commit()
    response = await client.get(f"/api/v1/files/{reply_id}/url", headers=auth(store.user, store.organization))
    assert response.status_code == 200


async def test_dsp_010_upload_permissions_and_content_validation(client: AsyncClient, session: AsyncSession):
    company, store, _ = await opened(client, session)
    warehouse = await member(session, company, "WAREHOUSE")
    assert (await upload(client, warehouse)).status_code == 403
    assert (await upload(client, store, content=b"not a PDF")).status_code == 422


async def test_dsp_010_reject_foreign_or_wrong_category_attachments(client: AsyncClient, session: AsyncSession):
    company, store, record = await opened(client, session)
    foreign = await upload(client, company)
    foreign_id = UUID(foreign.json()["id"])
    with pytest.raises(AppError, match="not_found"):
        await dispute_service.message(session, store, record.id, "This file is not ours", foreign_id)
    own = await upload(client, store, category="VERIFICATION")
    assert own.status_code == 201
    own_id = UUID(own.json()["id"])
    with pytest.raises(AppError, match="file_type_not_allowed"):
        await dispute_service.message(session, store, record.id, "Wrong document category", own_id)
    assert await session.get(StoredFile, own_id) is not None


async def test_dsp_024_sla_warning_idempotent_and_repeats(client: AsyncClient, session: AsyncSession):
    company, store, record = await opened(client, session)
    opened_at = record.created_at
    assert await send_sla_warnings(session, opened_at + timedelta(hours=48) - timedelta(seconds=1)) == 0
    assert await send_sla_warnings(session, opened_at + timedelta(hours=48)) == 1
    assert await send_sla_warnings(session, opened_at + timedelta(hours=71)) == 0
    await session.commit()
    assert await send_sla_warnings(session, opened_at + timedelta(hours=72)) == 1
    assert await send_sla_warnings(session, opened_at + timedelta(hours=72)) == 0
    await session.commit()
    warnings = list(await session.scalars(select(OutboxEvent).where(OutboxEvent.event_type == "DISPUTE_SLA_WARNING")))
    assert len(warnings) == 2
    assert all(row.org_id == company.organization.id and row.payload["id"] == str(record.id) for row in warnings)
    await dispute_service.start_review(session, company, record.id)
    await session.commit()
    assert await send_sla_warnings(session, opened_at + timedelta(hours=96)) == 0
    assert await session.scalar(select(func.count()).select_from(DisputeSlaWarning)) == 2


async def test_dsp_024_rollback_does_not_lose_warning(client: AsyncClient, session: AsyncSession):
    _, _, record = await opened(client, session)
    now = record.created_at + timedelta(hours=48)
    assert await send_sla_warnings(session, now) == 1
    await session.rollback()
    assert await send_sla_warnings(session, now) == 1
    await session.commit()
    assert await send_sla_warnings(session, now) == 0
