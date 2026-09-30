"""FND-011 / API-003 (GLOBAL §7.6): `ListQuery` filters, search and ordering whitelists on the two list endpoints.

`GET /api/v1/members` (P01 §6: filter `role`, `status`; search `full_name`, `phone`) and
`GET /api/v1/admin/verifications` (P02 §6: filter `status`, `org_type`; ordering `submitted_at`).
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Literal

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.filtering import ListQuery
from app.core.time import utcnow
from app.modules.identity.models import Membership, Organization, User
from app.modules.verification.models import VerificationRequest
from tests.factories import add_member, auth, make_org, make_user

MEMBERS = "/api/v1/members"
QUEUE = "/api/v1/admin/verifications"


async def _team(session: AsyncSession) -> tuple[User, Organization]:
    """Company with: owner "Owner Person", Farrukh (OPERATOR, ACTIVE, +992901110001), Madina (MANAGER, SUSPENDED,
    +992901110002), Zarina (OPERATOR, REVOKED, no phone), "100% Real_Name" (WAREHOUSE, ACTIVE)."""
    owner = await make_user(session, full_name="Owner Person")
    org = await make_org(session, owner)
    members = [
        ("Farrukh Karimov", "OPERATOR", "ACTIVE", "+992901110001"),
        ("Madina Saidova", "MANAGER", "SUSPENDED", "+992901110002"),
        ("Zarina Nazarova", "OPERATOR", "REVOKED", None),
        ("100% Real_Name", "WAREHOUSE", "ACTIVE", "+992901110004"),
    ]
    for full_name, role, status, phone in members:
        await add_member(session, org, await make_user(session, full_name=full_name, phone=phone), role, status)
    await session.commit()
    return owner, org


async def _members(client: AsyncClient, owner: User, org: Organization, **params: Any) -> Response:
    return await client.get(MEMBERS, params=params, headers={**auth(owner, org), "Accept-Language": "en"})


def _names(response: Response) -> list[str]:
    return [row["full_name"] for row in response.json()["results"]]


# ---------------------------------------------------------------- filters


async def test_fnd_011_no_filter_returns_everyone(client: AsyncClient, session: AsyncSession) -> None:
    owner, org = await _team(session)
    body = (await _members(client, owner, org)).json()
    assert body["count"] == 5


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"role": "OPERATOR"}, ["Farrukh Karimov", "Zarina Nazarova"]),
        ({"role": "OWNER"}, ["Owner Person"]),
        ({"status": "SUSPENDED"}, ["Madina Saidova"]),
        ({"status": "ACTIVE"}, ["Owner Person", "Farrukh Karimov", "100% Real_Name"]),
        ({"role": "OPERATOR", "status": "ACTIVE"}, ["Farrukh Karimov"]),  # filters combine with AND
        ({"role": "MANAGER", "status": "ACTIVE"}, []),  # no match
        ({"role": "COURIER"}, []),
    ],
    ids=["role", "role_owner", "status", "status_active", "role_and_status", "and_no_match", "role_no_match"],
)
async def test_fnd_011_member_filters(
    client: AsyncClient, session: AsyncSession, params: dict[str, str], expected: list[str]
) -> None:
    owner, org = await _team(session)
    response = await _members(client, owner, org, **params)
    assert response.status_code == 200
    assert _names(response) == expected
    assert response.json()["count"] == len(expected)


@pytest.mark.parametrize(
    ("search", "expected"),
    [
        ("farr", ["Farrukh Karimov"]),  # part of the name
        ("FARRUKH", ["Farrukh Karimov"]),  # ILIKE: case-insensitive
        ("  saidova  ", ["Madina Saidova"]),  # trimmed
        ("901110002", ["Madina Saidova"]),  # phone
        ("+99290111000", ["Farrukh Karimov", "Madina Saidova", "100% Real_Name"]),
        ("100%", ["100% Real_Name"]),  # % is literal, not "anything"
        ("l_N", ["100% Real_Name"]),  # _ is literal, not "any one character"
        ("%", ["100% Real_Name"]),
        ("_", ["100% Real_Name"]),
        ("   ", ["Owner Person", "Farrukh Karimov", "Madina Saidova", "Zarina Nazarova", "100% Real_Name"]),  # blank
        ("", ["Owner Person", "Farrukh Karimov", "Madina Saidova", "Zarina Nazarova", "100% Real_Name"]),
        ("nobody", []),
    ],
    ids=[
        "name_part",
        "case_insensitive",
        "trimmed",
        "phone",
        "phone_prefix",
        "percent_literal",
        "underscore_literal",
        "percent_only",
        "underscore_only",
        "blank_is_no_search",
        "empty_is_no_search",
        "no_match",
    ],
)
async def test_fnd_011_member_search(
    client: AsyncClient, session: AsyncSession, search: str, expected: list[str]
) -> None:
    owner, org = await _team(session)
    assert _names(await _members(client, owner, org, search=search)) == expected


async def test_fnd_011_search_only_covers_the_listed_fields(client: AsyncClient, session: AsyncSession) -> None:
    """P01 §6 lists full_name and phone: email (and role/status text) are not searched."""
    owner, org = await _team(session)
    email = (await session.execute(text("SELECT email FROM users WHERE full_name = 'Farrukh Karimov'"))).scalar_one()
    assert _names(await _members(client, owner, org, search=email)) == []
    assert _names(await _members(client, owner, org, search="OPERATOR")) == []


async def test_fnd_011_search_and_filters_combine(client: AsyncClient, session: AsyncSession) -> None:
    owner, org = await _team(session)
    assert _names(await _members(client, owner, org, search="a", role="OPERATOR", status="REVOKED")) == [
        "Zarina Nazarova"
    ]


async def test_fnd_011_sql_in_search_is_only_text(client: AsyncClient, session: AsyncSession) -> None:
    owner, org = await _team(session)
    response = await _members(client, owner, org, search="'; DROP TABLE users; --")
    assert (response.status_code, response.json()["count"]) == (200, 0)
    assert (await session.execute(text("SELECT count(*) FROM users"))).scalar_one() == 5


# ---------------------------------------------------------------- validation (translated, API-001 envelope)


@pytest.mark.parametrize(
    ("params", "field", "code"),
    [
        ({"foo": "1"}, "foo", "extra_forbidden"),  # GLOBAL §7.6: unknown field -> validation_error
        ({"ordering": "joined_at"}, "ordering", "extra_forbidden"),  # /members has no ordering in P01 §6
        ({"email": "a@b.tj"}, "email", "extra_forbidden"),
        ({"role": ""}, "role", "literal_error"),  # an empty enum value is not a value
        ({"role": "operator"}, "role", "literal_error"),  # enum values are exact (case-sensitive)
        ({"role": "ADMIN"}, "role", "literal_error"),
        ({"status": "DELETED"}, "status", "literal_error"),
        ({"search": "x" * 101}, "search", "string_too_long"),
    ],
    ids=[
        "unknown",
        "ordering_not_listed",
        "email_not_a_filter",
        "empty_enum",
        "lowercase",
        "bad_role",
        "bad_status",
        "long",
    ],
)
async def test_fnd_011_invalid_member_query_is_a_validation_error(
    client: AsyncClient, session: AsyncSession, params: dict[str, str], field: str, code: str
) -> None:
    owner, org = await _team(session)
    response = await _members(client, owner, org, **params)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    [issue] = error["details"]["fields"]
    assert (issue["field"], issue["code"]) == (field, code)
    assert not issue["message"].startswith("validation.")


async def test_fnd_011_every_invalid_parameter_is_reported(client: AsyncClient, session: AsyncSession) -> None:
    owner, org = await _team(session)
    response = await _members(client, owner, org, foo="1", role="x", limit="0")
    fields = {issue["field"]: issue["code"] for issue in response.json()["error"]["details"]["fields"]}
    assert fields == {"foo": "extra_forbidden", "role": "literal_error", "limit": "greater_than_equal"}


async def test_fnd_011_validation_messages_are_translated(client: AsyncClient, session: AsyncSession) -> None:
    owner, org = await _team(session)
    for language in ("tg", "ru", "en"):
        response = await client.get(
            MEMBERS, params={"foo": "1"}, headers={**auth(owner, org), "Accept-Language": language}
        )
        assert not response.json()["error"]["details"]["fields"][0]["message"].startswith("validation."), language


# ---------------------------------------------------------------- filter + pagination, tenant boundary, authorization


async def test_fnd_011_filter_then_page(client: AsyncClient, session: AsyncSession) -> None:
    owner, org = await _team(session)
    first = (await _members(client, owner, org, status="ACTIVE", limit=2)).json()
    second = (await _members(client, owner, org, status="ACTIVE", limit=2, offset=2)).json()
    assert (first["count"], second["count"]) == (3, 3)  # count is the filtered total
    names = [r["full_name"] for r in first["results"] + second["results"]]
    assert names == ["Owner Person", "Farrukh Karimov", "100% Real_Name"]


async def test_fnd_011_filters_never_cross_the_organization(client: AsyncClient, session: AsyncSession) -> None:
    owner, org = await _team(session)
    other_owner = await make_user(session, full_name="Farrukh Other Org")
    other = await make_org(session, other_owner, name="Other")
    await add_member(session, other, await make_user(session, full_name="Farrukh Second"), "OPERATOR")
    await session.commit()
    assert _names(await _members(client, owner, org, search="farrukh")) == ["Farrukh Karimov"]
    assert _names(await _members(client, other_owner, other, search="farrukh", role="OPERATOR")) == ["Farrukh Second"]
    # the organization comes from X-Org-Id + membership, never from a query parameter
    injected = await _members(client, owner, org, organization_id=str(other.id))
    assert injected.status_code == 422


async def test_fnd_011_authorization_is_checked_before_filters(client: AsyncClient, session: AsyncSession) -> None:
    owner, org = await _team(session)
    assert (await client.get(MEMBERS, params={"foo": "1"})).status_code == 401
    admin = await make_user(session, is_superadmin=True)
    await session.commit()
    assert (await client.get(QUEUE, params={"status": "bad"}, headers=auth(owner))).status_code == 403
    assert (await client.get(QUEUE, params={"status": "SUBMITTED"}, headers=auth(admin))).status_code == 200


# ---------------------------------------------------------------- admin queue: filters + ordering


async def _queue(session: AsyncSession) -> User:
    """6 requests. minute: status/type — 0 SUBMITTED/STORE, 1 SUBMITTED/COMPANY, 2 APPROVED/STORE,
    3 SUBMITTED/STORE, 4 REJECTED/COMPANY, and a second SUBMITTED/STORE at minute 0 (a tie)."""
    admin = await make_user(session, is_superadmin=True)
    base = utcnow() - timedelta(hours=2)
    rows = [
        (0, "SUBMITTED", "STORE"),
        (1, "SUBMITTED", "COMPANY"),
        (2, "APPROVED", "STORE"),
        (3, "SUBMITTED", "STORE"),
        (4, "REJECTED", "COMPANY"),
        (0, "SUBMITTED", "STORE"),
    ]
    for index, (minute, status, org_type) in enumerate(rows):
        owner = await make_user(session)
        org = await make_org(session, owner, org_type=org_type, name=f"Q{index}")
        session.add(
            VerificationRequest(
                organization_id=org.id,
                submitted_by=owner.id,
                submitted_at=base + timedelta(minutes=minute),
                status=status,
                rejection_reason="Unreadable document." if status == "REJECTED" else None,
                legal_snapshot={},
            )
        )
        await session.flush()
    await session.commit()
    return admin


async def _queue_page(client: AsyncClient, admin: User, **params: Any) -> dict[str, Any]:
    response = await client.get(QUEUE, params=params, headers=auth(admin))
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


@pytest.mark.parametrize(
    ("params", "count"),
    [
        ({}, 6),
        ({"status": "SUBMITTED"}, 4),
        ({"status": "APPROVED"}, 1),
        ({"status": "UNDER_REVIEW"}, 0),
        ({"org_type": "COMPANY"}, 2),
        ({"status": "SUBMITTED", "org_type": "STORE"}, 3),
        ({"status": "REJECTED", "org_type": "STORE"}, 0),
    ],
    ids=["none", "status", "approved", "empty", "org_type", "status_and_type", "and_no_match"],
)
async def test_fnd_011_queue_filters(
    client: AsyncClient, session: AsyncSession, params: dict[str, str], count: int
) -> None:
    admin = await _queue(session)
    body = await _queue_page(client, admin, **params)
    assert body["count"] == len(body["results"]) == count
    for key, value in params.items():
        assert all(row[key] == value for row in body["results"])


async def test_fnd_011_queue_filter_with_ordering_and_pages_is_stable(
    client: AsyncClient, session: AsyncSession
) -> None:
    admin = await _queue(session)
    for ordering in ("submitted_at", "-submitted_at"):
        full = (await _queue_page(client, admin, status="SUBMITTED", org_type="STORE", ordering=ordering))["results"]
        times = [row["submitted_at"] for row in full]
        assert times == sorted(times, reverse=ordering.startswith("-"))
        paged = []
        for offset in range(0, 3):
            page = await _queue_page(
                client, admin, status="SUBMITTED", org_type="STORE", ordering=ordering, limit=1, offset=offset
            )
            assert page["count"] == 3
            paged += page["results"]
        assert [row["id"] for row in paged] == [row["id"] for row in full]


@pytest.mark.parametrize(
    ("params", "field", "code"),
    [
        ({"search": "x"}, "search", "extra_forbidden"),  # P02 §6 defines no search for the queue
        ({"status": ""}, "status", "literal_error"),
        ({"org_type": "store"}, "org_type", "literal_error"),
        ({"ordering": "org_name"}, "ordering", "literal_error"),
        ({"ordering": "-"}, "ordering", "literal_error"),
    ],
    ids=["no_search", "empty_status", "lowercase_type", "unlisted_ordering", "bare_minus"],
)
async def test_fnd_011_invalid_queue_query(
    client: AsyncClient, session: AsyncSession, params: dict[str, str], field: str, code: str
) -> None:
    admin = await _queue(session)
    response = await client.get(QUEUE, params=params, headers=auth(admin))
    assert response.status_code == 422
    [issue] = response.json()["error"]["details"]["fields"]
    assert (issue["field"], issue["code"]) == (field, code)


# ---------------------------------------------------------------- the base class guards its whitelists


def test_fnd_011_whitelists_must_match_the_declared_fields() -> None:
    with pytest.raises(TypeError, match="filter_columns without a field"):

        class _Filter(ListQuery):
            filter_columns = {"role": Membership.role}

    with pytest.raises(TypeError, match="search"):

        class _Search(ListQuery):
            search_columns = (User.full_name,)

    with pytest.raises(TypeError, match="ordering values"):

        class _Ordering(ListQuery):
            ordering: Literal["joined_at"] = "joined_at"
            ordering_columns = {"joined_at": Membership.joined_at}


def test_fnd_011_query_models_forbid_unknown_fields() -> None:
    from pydantic import ValidationError

    from app.modules.identity.filters import MemberQuery

    with pytest.raises(ValidationError, match="extra_forbidden"):
        MemberQuery.model_validate({"unknown": "1"})
    assert MemberQuery.model_validate({}).page.limit == 20
