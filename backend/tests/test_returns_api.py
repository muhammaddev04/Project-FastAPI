"""P10 HTTP contracts: idempotent commands, tenant isolation and the two workflows."""

from decimal import Decimal
from uuid import uuid4

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.returns.models import Dispute, Return
from tests.factories import auth, make_org, make_user
from tests.test_returns_service import delivered, member


def headers(ctx, key=None):
    return {**auth(ctx.user, ctx.organization), "Idempotency-Key": str(key or uuid4())}


def plain(ctx):
    return auth(ctx.user, ctx.organization)


def keyless(ctx):
    # The auth helper always mints a key, so the missing-key case has to strip it deliberately.
    return {name: value for name, value in auth(ctx.user, ctx.organization).items() if name != "Idempotency-Key"}


async def test_return_workflow_over_http(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    await session.commit()

    detail = await client.get(f"/api/v1/orders/{order.id}", headers=plain(store_ctx))
    assert detail.status_code == 200, detail.text
    assert detail.json()["terms_snapshot"] == {
        key: order.terms_snapshot[key] for key in ("return_days", "dispute_window_hours")
    }

    offered = await client.get(f"/api/v1/orders/{order.id}/returnable", headers=plain(store_ctx))
    assert offered.status_code == 200, offered.text
    line = offered.json()[0]
    assert line["max_returnable"] == "5.000" and line["return_deadline"] is not None

    created = await client.post(
        "/api/v1/returns",
        headers=headers(store_ctx),
        json={
            "order_id": str(order.id),
            "reason_code": "DAMAGED",
            "items": [{"order_item_id": line["order_item_id"], "quantity": "2"}],
        },
    )
    assert created.status_code == 201, created.text
    record = created.json()
    assert record["status"] == "REQUESTED" and record["return_number"].startswith("RET-")
    assert [row["to_status"] for row in record["history"]] == ["REQUESTED"]
    item_id = record["items"][0]["id"]

    approved = await client.post(
        f"/api/v1/returns/{record['id']}/approve",
        headers=headers(ctx),
        json={"items": [{"id": item_id, "approved_quantity": "2"}], "version": record["version"]},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "APPROVED"

    received = await client.post(
        f"/api/v1/returns/{record['id']}/receive",
        headers=headers(ctx),
        json={"items": [{"id": item_id, "received_quantity": "2"}], "version": approved.json()["version"]},
    )
    assert received.status_code == 200, received.text

    preview = await client.get(
        f"/api/v1/returns/{record['id']}/completion-preview",
        headers=plain(ctx),
        params={"items": f"{item_id}:2:1"},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["total_credit"] == "20.00"

    completed = await client.post(
        f"/api/v1/returns/{record['id']}/complete",
        headers=headers(ctx),
        json={
            "items": [{"id": item_id, "accepted_quantity": "2", "restock_quantity": "1"}],
            "version": received.json()["version"],
        },
    )
    assert completed.status_code == 200, completed.text
    body = completed.json()
    assert body["status"] == "COMPLETED" and body["total_credit"] == "20.00"
    assert body["credit_note_id"] is not None
    assert [row["to_status"] for row in body["history"]] == ["REQUESTED", "APPROVED", "RECEIVED", "COMPLETED"]


async def test_return_command_requires_and_replays_its_idempotency_key(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    await session.commit()
    payload = {
        "order_id": str(order.id),
        "reason_code": "QUALITY",
        "items": [{"order_item_id": str(item.id), "quantity": "1"}],
    }
    missing = await client.post("/api/v1/returns", headers=keyless(store_ctx), json=payload)
    assert missing.status_code == 400 and missing.json()["error"]["code"] == "idempotency_key_required"

    key = uuid4()
    first = await client.post("/api/v1/returns", headers=headers(store_ctx, key), json=payload)
    assert first.status_code == 201, first.text
    replay = await client.post("/api/v1/returns", headers=headers(store_ctx, key), json=payload)
    assert replay.status_code == 201 and replay.json()["id"] == first.json()["id"]
    # The replay returned the original return instead of opening a second one.
    assert await session.scalar(select(func.count()).select_from(Return)) == 1


async def test_return_of_another_tenant_is_not_found(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    created = await client.post(
        "/api/v1/returns",
        headers=headers(store_ctx),
        json={
            "order_id": str(order.id),
            "reason_code": "DAMAGED",
            "items": [{"order_item_id": str(item.id), "quantity": "1"}],
        },
    )
    assert created.status_code == 201, created.text
    outsider = await make_user(session, email="outsider@example.com")
    other = await make_org(session, outsider)
    await session.commit()
    seen = await client.get(f"/api/v1/returns/{created.json()['id']}", headers=auth(outsider, other))
    assert seen.status_code == 404


async def test_return_permissions_and_version_conflict(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    created = await client.post(
        "/api/v1/returns",
        headers=headers(store_ctx),
        json={
            "order_id": str(order.id),
            "reason_code": "DAMAGED",
            "items": [{"order_item_id": str(item.id), "quantity": "2"}],
        },
    )
    record = created.json()
    item_id = record["items"][0]["id"]
    # The store cannot decide its own return, and the company cannot request one.
    refused = await client.post(
        f"/api/v1/returns/{record['id']}/approve",
        headers=headers(store_ctx),
        json={"items": [{"id": item_id, "approved_quantity": "2"}], "version": record["version"]},
    )
    assert refused.status_code == 403
    refused = await client.post(
        "/api/v1/returns",
        headers=headers(ctx),
        json={
            "order_id": str(order.id),
            "reason_code": "DAMAGED",
            "items": [{"order_item_id": str(item.id), "quantity": "1"}],
        },
    )
    assert refused.status_code == 403
    stale = await client.post(
        f"/api/v1/returns/{record['id']}/approve",
        headers=headers(ctx),
        json={"items": [{"id": item_id, "approved_quantity": "2"}], "version": record["version"] + 5},
    )
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "version_conflict"


async def test_store_cancels_its_own_request_and_lists_it(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    created = await client.post(
        "/api/v1/returns",
        headers=headers(store_ctx),
        json={
            "order_id": str(order.id),
            "reason_code": "WRONG_ITEM",
            "items": [{"order_item_id": str(item.id), "quantity": "1"}],
        },
    )
    record = created.json()
    cancelled = await client.post(
        f"/api/v1/returns/{record['id']}/cancel",
        headers=headers(store_ctx),
        json={"version": record["version"]},
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "CANCELLED"
    listed = await client.get("/api/v1/returns", headers=plain(ctx), params={"status": "CANCELLED"})
    assert listed.status_code == 200 and listed.json()["count"] == 1
    empty = await client.get("/api/v1/returns", headers=plain(ctx), params={"status": "COMPLETED"})
    assert empty.json()["results"] == []


async def test_dispute_workflow_over_http(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    await session.commit()
    opened = await client.post(
        "/api/v1/disputes",
        headers=headers(store_ctx),
        json={
            "target_type": "ORDER",
            "type": "DAMAGED",
            "description": "Two of the five packs arrived crushed",
            "order_id": str(order.id),
        },
    )
    assert opened.status_code == 201, opened.text
    dispute = opened.json()
    assert dispute["status"] == "OPEN" and dispute["dispute_number"].startswith("DSP-")

    review = await client.post(f"/api/v1/disputes/{dispute['id']}/start-review", headers=plain(ctx))
    assert review.status_code == 200, review.text
    assert review.json()["status"] == "UNDER_REVIEW"

    message = await client.post(
        f"/api/v1/disputes/{dispute['id']}/messages",
        headers=headers(ctx),
        json={"body": "We are checking the pictures with the courier"},
    )
    assert message.status_code == 201, message.text
    assert message.json()["author_side"] == "COMPANY"

    resolved = await client.post(
        f"/api/v1/disputes/{dispute['id']}/resolve",
        headers=headers(ctx),
        json={
            "resolution_type": "ADJUSTMENT_CREDIT",
            "resolution_note": "Crediting the two crushed packs",
            "amount": "20.00",
            "version": review.json()["version"],
        },
    )
    assert resolved.status_code == 200, resolved.text
    body = resolved.json()
    assert body["status"] == "RESOLVED" and body["adjustment_id"] is not None
    assert [row["author_side"] for row in body["messages"]] == ["COMPANY"]


async def test_dispute_second_attempt_and_store_withdrawal(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    payload = {
        "target_type": "ORDER",
        "type": "QUANTITY",
        "description": "One pack was missing from the delivery",
        "order_id": str(order.id),
    }
    first = await client.post("/api/v1/disputes", headers=headers(store_ctx), json=payload)
    assert first.status_code == 201, first.text
    again = await client.post("/api/v1/disputes", headers=headers(store_ctx), json=payload)
    assert again.status_code == 409 and again.json()["error"]["code"] == "dispute_already_open"
    withdrawn = await client.post(
        f"/api/v1/disputes/{first.json()['id']}/withdraw",
        headers=headers(store_ctx),
        json={"version": first.json()["version"]},
    )
    assert withdrawn.status_code == 200 and withdrawn.json()["status"] == "WITHDRAWN"
    assert await session.scalar(select(func.count()).select_from(Dispute)) == 1


async def test_dispute_payload_and_permission_rules(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    # A dispute needs exactly the reference its target type names.
    wrong = await client.post(
        "/api/v1/disputes",
        headers=headers(store_ctx),
        json={
            "target_type": "ORDER",
            "type": "PRICE",
            "description": "The price does not match the terms",
            "payment_id": str(order.id),
        },
    )
    assert wrong.status_code == 422
    short = await client.post(
        "/api/v1/disputes",
        headers=headers(store_ctx),
        json={"target_type": "ORDER", "type": "PRICE", "description": "Too short", "order_id": str(order.id)},
    )
    assert short.status_code == 422
    # An operator may review and write, but not resolve.
    operator = await member(session, ctx, "OPERATOR")
    opened = await client.post(
        "/api/v1/disputes",
        headers=headers(store_ctx),
        json={
            "target_type": "ORDER",
            "type": "DELIVERY",
            "description": "The delivery arrived outside the agreed window",
            "order_id": str(order.id),
        },
    )
    dispute = opened.json()
    assert (
        await client.post(f"/api/v1/disputes/{dispute['id']}/start-review", headers=plain(operator))
    ).status_code == 200
    posted = await client.post(
        f"/api/v1/disputes/{dispute['id']}/messages",
        headers=headers(operator),
        json={"body": "Checking with the courier now"},
    )
    assert posted.status_code == 201
    refused = await client.post(
        f"/api/v1/disputes/{dispute['id']}/resolve",
        headers=headers(operator),
        json={
            "resolution_type": "NO_ACTION",
            "resolution_note": "Nothing to compensate here",
            "version": dispute["version"],
        },
    )
    assert refused.status_code == 403


async def test_completion_preview_rejects_a_malformed_item(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    created = await client.post(
        "/api/v1/returns",
        headers=headers(store_ctx),
        json={
            "order_id": str(order.id),
            "reason_code": "EXPIRED",
            "items": [{"order_item_id": str(item.id), "quantity": "1"}],
        },
    )
    record = created.json()
    bad = await client.get(
        f"/api/v1/returns/{record['id']}/completion-preview",
        headers=plain(ctx),
        params={"items": "not-a-line"},
    )
    assert bad.status_code == 422 and bad.json()["error"]["details"]["field"] == "items"


async def test_returnable_rejects_an_order_that_cannot_be_returned(client: AsyncClient, session: AsyncSession):
    ctx, store_ctx, order, item = await delivered(client, session)
    # A return needs the delivered quantity, so the preview is driven by the order, not a guess.
    offered = await client.get(f"/api/v1/orders/{order.id}/returnable", headers=plain(ctx))
    assert offered.status_code == 200
    assert Decimal(offered.json()[0]["confirmed_quantity"]) == Decimal("5.000")
    missing = await client.get(f"/api/v1/orders/{uuid4()}/returnable", headers=plain(ctx))
    assert missing.status_code == 404
