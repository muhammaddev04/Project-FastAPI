"""FND-009 / API-002 (GLOBAL §7.5): `PageParams`, `Page[T]`, `fetch_page`, on the two list endpoints that use them.

`GET /api/v1/members` (P01 §6, ordered by `joined_at`) and `GET /api/v1/admin/verifications` (P02 §6, ordering
`submitted_at` / `-submitted_at`).
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT, Page, PageParams, fetch_page
from app.core.time import new_id, utcnow
from app.modules.identity.models import Membership, Organization, User
from app.modules.verification.models import VerificationRequest
from tests.factories import add_member, auth, make_org, make_user

MEMBERS = "/api/v1/members"
QUEUE = "/api/v1/admin/verifications"


async def _org_with_members(session: AsyncSession, extra: int) -> tuple[User, Organization]:
    """OWNER + `extra` members who all joined at the same instant (the sort value ties).

    The tied rows are inserted in *descending* id order, so the physical row order is the opposite of the id order and
    only the tie-breaker can put them in id order.
    """
    owner = await make_user(session)
    org = await make_org(session, owner)
    same_moment = utcnow()
    users = [await make_user(session) for _ in range(extra)]
    for membership_id, user in zip(sorted((new_id() for _ in users), reverse=True), users, strict=True):
        session.add(
            Membership(
                id=membership_id, user_id=user.id, organization_id=org.id, role="OPERATOR", joined_at=same_moment
            )
        )
        await session.flush()
    await session.commit()
    return owner, org


async def _members(client: AsyncClient, owner: User, org: Organization, **params: Any) -> Response:
    return await client.get(MEMBERS, params=params, headers=auth(owner, org))


# ---------------------------------------------------------------- envelope and defaults


async def test_fnd_009_default_page_and_envelope(client: AsyncClient, session: AsyncSession) -> None:
    owner, org = await _org_with_members(session, 24)  # 25 members
    response = await _members(client, owner, org)
    assert response.status_code == 200
    body = response.json()
    assert list(body) == ["count", "limit", "offset", "results"]
    assert (body["count"], body["limit"], body["offset"], len(body["results"])) == (25, DEFAULT_LIMIT, 0, 20)


async def test_fnd_009_count_ignores_the_page_but_respects_filters(client: AsyncClient, session: AsyncSession) -> None:
    owner, org = await _org_with_members(session, 5)
    page = (await _members(client, owner, org, limit=2, offset=4)).json()
    assert (page["count"], len(page["results"])) == (6, 2)
    owners = (await _members(client, owner, org, role="OWNER", limit=1)).json()
    assert (owners["count"], len(owners["results"])) == (1, 1)


async def test_fnd_009_offset_past_the_end_is_an_empty_page(client: AsyncClient, session: AsyncSession) -> None:
    owner, org = await _org_with_members(session, 2)
    body = (await _members(client, owner, org, limit=20, offset=50)).json()
    assert (body["count"], body["limit"], body["offset"], body["results"]) == (3, 20, 50, [])


async def test_fnd_009_last_partial_page(client: AsyncClient, session: AsyncSession) -> None:
    owner, org = await _org_with_members(session, 6)  # 7 members
    body = (await _members(client, owner, org, limit=3, offset=6)).json()
    assert (body["count"], len(body["results"])) == (7, 1)


async def test_fnd_009_max_limit_is_accepted(client: AsyncClient, session: AsyncSession) -> None:
    owner, org = await _org_with_members(session, 1)
    assert (await _members(client, owner, org, limit=MAX_LIMIT)).json()["limit"] == 100


# ---------------------------------------------------------------- validation


@pytest.mark.parametrize(
    ("params", "field", "code", "message"),
    [
        ({"limit": 101}, "limit", "less_than_equal", "This value is too large."),
        ({"limit": 0}, "limit", "greater_than_equal", "This value is too small."),
        ({"limit": -5}, "limit", "greater_than_equal", "This value is too small."),
        ({"offset": -1}, "offset", "greater_than_equal", "This value is too small."),
        ({"limit": "abc"}, "limit", "int_parsing", "Enter a whole number."),
        ({"offset": "1.5"}, "offset", "int_parsing", "Enter a whole number."),
    ],
    ids=["limit_over_100", "limit_zero", "limit_negative", "offset_negative", "limit_not_int", "offset_not_int"],
)
async def test_fnd_009_pagination_limits(
    client: AsyncClient, session: AsyncSession, params: dict[str, Any], field: str, code: str, message: str
) -> None:
    """P00 §8: limit > 100 -> validation_error (and every other out-of-range value, with a translated message)."""
    owner, org = await _org_with_members(session, 0)
    response = await client.get(MEMBERS, params=params, headers={**auth(owner, org), "Accept-Language": "en"})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"]["fields"] == [{"field": field, "code": code, "message": message}]


async def test_fnd_009_validation_messages_exist_in_every_language(client: AsyncClient, session: AsyncSession) -> None:
    owner, org = await _org_with_members(session, 0)
    for language in ("tg", "ru", "en"):
        headers = {**auth(owner, org), "Accept-Language": language}
        for params in ({"limit": 101}, {"offset": -1}, {"limit": "x"}):
            details = (await client.get(MEMBERS, params=params, headers=headers)).json()["error"]["details"]
            assert not details["fields"][0]["message"].startswith("validation."), (language, params)


# ---------------------------------------------------------------- stable order


async def _walk(client: AsyncClient, owner: User, org: Organization, total: int, size: int) -> list[str]:
    ids: list[str] = []
    for offset in range(0, total, size):
        page = (await _members(client, owner, org, limit=size, offset=offset)).json()
        ids += [row["id"] for row in page["results"]]
    return ids


async def test_fnd_009_ties_keep_one_order_across_pages(client: AsyncClient, session: AsyncSession) -> None:
    """11 members share one joined_at: walking the pages returns each exactly once, in the tie-breaker (id) order."""
    owner, org = await _org_with_members(session, 11)
    walked = await _walk(client, owner, org, total=12, size=5)
    assert len(walked) == len(set(walked)) == 12
    owner_membership = (await session.execute(select(Membership.id).where(Membership.user_id == owner.id))).scalar_one()
    assert walked[0] == str(owner_membership)  # joined earlier than the tied rows
    assert walked[1:] == sorted(walked[1:])  # UUIDv7 text order = PostgreSQL uuid order
    assert await _walk(client, owner, org, total=12, size=5) == walked  # the same pages give the same rows again
    assert await _walk(client, owner, org, total=12, size=4) == walked  # and so does another page size


async def test_fetch_page_always_appends_the_tie_breaker(session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    for _ in range(4):
        await add_member(session, org, await make_user(session), "OPERATOR")
    await session.commit()
    query = select(Membership).where(Membership.organization_id == org.id)
    count, rows = await fetch_page(
        session, query, PageParams(limit=10, offset=0), order_by=[], tie_breaker=Membership.id.desc()
    )
    ids = [m.id for m in rows.scalars()]
    assert count == 5
    assert ids == sorted(ids, reverse=True)


def test_page_of_builds_the_envelope() -> None:
    page = Page[int].of(PageParams(limit=2, offset=4), 9, [5, 6])
    assert page.model_dump() == {"count": 9, "limit": 2, "offset": 4, "results": [5, 6]}


# ---------------------------------------------------------------- ordering (admin queue: submitted_at, -submitted_at)


async def _queue_with_requests(session: AsyncSession) -> tuple[User, list[str]]:
    """5 requests submitted at minutes 3, 1, 2, 0, 0. Returns (superadmin, ids in ascending submitted_at, id order)."""
    admin = await make_user(session, is_superadmin=True)
    base = utcnow() - timedelta(hours=1)
    made: list[tuple[int, VerificationRequest]] = []
    for minute in (3, 1, 2, 0, 0):
        owner = await make_user(session)
        org = await make_org(session, owner, verification_status="PENDING")
        request = VerificationRequest(
            organization_id=org.id,
            submitted_by=owner.id,
            submitted_at=base + timedelta(minutes=minute),
            legal_snapshot={},
        )
        session.add(request)
        await session.flush()
        made.append((minute, request))
    await session.commit()
    return admin, [str(request.id) for _, request in sorted(made, key=lambda item: (item[0], item[1].id))]


async def test_fnd_009_ordering_ascending_and_descending(client: AsyncClient, session: AsyncSession) -> None:
    admin, ascending = await _queue_with_requests(session)
    first = (await client.get(QUEUE, params={"limit": 3}, headers=auth(admin))).json()
    second = (await client.get(QUEUE, params={"limit": 3, "offset": 3}, headers=auth(admin))).json()
    assert [r["id"] for r in first["results"] + second["results"]] == ascending  # default: ordering=submitted_at

    descending = (await client.get(QUEUE, params={"ordering": "-submitted_at"}, headers=auth(admin))).json()
    times = [r["submitted_at"] for r in descending["results"]]
    assert times == sorted(times, reverse=True)
    assert descending["count"] == 5
    # the tie (minute 0) keeps the id order in both directions
    assert [r["id"] for r in descending["results"]][-2:] == ascending[:2]


@pytest.mark.parametrize(
    "ordering", ["created_at", "id", "submitted_at;DROP TABLE users", "-", "submitted_at,id", "SUBMITTED_AT", ""]
)
async def test_fnd_009_unknown_ordering_is_a_validation_error(
    client: AsyncClient, session: AsyncSession, ordering: str
) -> None:
    admin, _ = await _queue_with_requests(session)
    response = await client.get(QUEUE, params={"ordering": ordering}, headers=auth(admin))
    assert response.status_code == 422
    field = response.json()["error"]["details"]["fields"][0]
    assert (field["field"], field["code"]) == ("ordering", "literal_error")


# ---------------------------------------------------------------- authorization is unchanged


async def test_paginated_endpoints_keep_their_authorization(client: AsyncClient, session: AsyncSession) -> None:
    owner, org = await _org_with_members(session, 0)
    outsider = await make_user(session)
    await session.commit()
    assert (await client.get(MEMBERS, params={"limit": 5})).status_code == 401
    assert (await client.get(MEMBERS, params={"limit": 5}, headers=auth(outsider, org))).status_code == 404
    assert (await client.get(QUEUE, params={"limit": 5}, headers=auth(owner))).status_code == 403
    # a bad page parameter does not reveal anything before authentication
    assert (await client.get(QUEUE, params={"limit": 999})).status_code == 401
