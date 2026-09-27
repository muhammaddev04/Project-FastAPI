"""P01 §10 onboarding intent + ORG-004 business identity.

Registration stores the Company/Store choice (and organization name) as an intent only; `/me` returns it together with
each membership's verification status so the app can route without asking again. Signing in (password or Google)
never creates an organization. The tax identifier (ИНН) is unique per organization type (TZ P02 §1.1/§1.2), enforced
by the database and answered as 409 even when two requests race.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Iterator
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.email import MemoryEmailProvider, OutgoingEmail, set_email_provider
from app.modules.identity.models import Organization, User
from tests.factories import auth, make_org, make_user

REGISTER = "/api/v1/auth/register"
LOGIN = "/api/v1/auth/login"
ME = "/api/v1/me"
COMPANIES = "/api/v1/organizations/companies"
STORES = "/api/v1/organizations/stores"
PASSWORD = "Dushanbe2026x"
CODE_IN_EMAIL = re.compile(r":\s*([0-9]{6})\s*$", re.M)
COMPANY = {
    "name": "Pamir Trade",
    "legal_name": "Pamir Trade LLC",
    "tax_identifier": "510012345",
    "phone": "+992901234567",
    "city": "Dushanbe",
    "address": "Rudaki Ave 12",
}
STORE = {**COMPANY, "name": "Pamir Shop", "legal_name": "Pamir Shop LLC"}


@pytest.fixture
def outbox() -> Iterator[list[OutgoingEmail]]:
    provider = MemoryEmailProvider()
    set_email_provider(provider)
    yield provider.outbox
    set_email_provider(None)


async def register_and_sign_in(
    client: AsyncClient, outbox: list[OutgoingEmail], email: str = "nigina@example.tj", **intent: Any
) -> str:
    body = {"email": email, "password": PASSWORD, "full_name": "Nigina Karimova", "language": "en", **intent}
    assert (await client.post(REGISTER, json=body)).status_code == 202
    code = CODE_IN_EMAIL.search(outbox[-1].text).group(1)  # type: ignore[union-attr]
    assert (await client.post("/api/v1/auth/email/verify", json={"email": email, "code": code})).status_code == 204
    return await sign_in(client, email)


async def sign_in(client: AsyncClient, email: str = "nigina@example.tj") -> str:
    response = await client.post(LOGIN, json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    client.cookies.clear()
    return str(response.json()["access_token"])


async def me(client: AsyncClient, token: str) -> dict[str, Any]:
    response = await client.get(ME, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    return response.json()


async def organizations(session: AsyncSession) -> int:
    session.expire_all()
    return await session.scalar(select(func.count()).select_from(Organization)) or 0


def error(response: Response) -> str:
    return response.json()["error"]["code"]


# --- onboarding intent ----------------------------------------------------------------------------------------------


@pytest.mark.parametrize(("org_type", "org_name"), [("COMPANY", "Pamir Trade"), ("STORE", "Corner Market")])
async def test_registration_intent_survives_logout_and_login(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail], org_type: str, org_name: str
) -> None:
    token = await register_and_sign_in(client, outbox, org_type=org_type, org_name=f"  {org_name} ")

    first = await me(client, token)
    again = await me(client, await sign_in(client))  # a later, separate sign-in

    for view in (first, again):
        assert view["onboarding"] == {"org_type": org_type, "org_name": org_name}
        assert view["memberships"] == []
    # Registration and sign-in never create an organization.
    assert await organizations(session) == 0


async def test_registration_without_intent_is_allowed(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    token = await register_and_sign_in(client, outbox)

    assert (await me(client, token))["onboarding"] == {"org_type": None, "org_name": None}


@pytest.mark.parametrize(
    ("extra", "field"),
    [
        ({"org_type": "BANK"}, "org_type"),
        ({"org_type": "COMPANY", "org_name": "x"}, "org_name"),
        ({"org_name": "Pamir Trade"}, None),  # a name without a type
    ],
)
async def test_malformed_intent_is_a_validation_error(
    client: AsyncClient, outbox: list[OutgoingEmail], extra: dict[str, str], field: str | None
) -> None:
    body = {"email": "a@example.tj", "password": PASSWORD, "full_name": "Nigina Karimova", "language": "en", **extra}

    response = await client.post(REGISTER, json=body)

    assert response.status_code == 422 and error(response) == "validation_error"
    if field:
        assert field in {f["field"] for f in response.json()["error"]["details"]["fields"]}
    assert outbox == []


async def test_registering_an_existing_email_never_changes_that_account(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    await register_and_sign_in(client, outbox, org_type="COMPANY", org_name="Pamir Trade")

    again = await client.post(
        REGISTER,
        json={
            "email": "Nigina@Example.tj",
            "password": "Other2027pass",
            "full_name": "Somebody Else",
            "language": "ru",
            "org_type": "STORE",
            "org_name": "Other Shop",
        },
    )

    assert again.status_code == 202  # the same neutral answer (IAM-001)
    session.expire_all()
    users = (await session.scalars(select(User))).all()
    assert len(users) == 1
    assert (users[0].onboarding_org_type, users[0].onboarding_org_name, users[0].full_name) == (
        "COMPANY",
        "Pamir Trade",
        "Nigina Karimova",
    )


async def test_me_reports_each_organizations_verification_status(client: AsyncClient, session: AsyncSession) -> None:
    owner = await make_user(session, onboarding_org_type="COMPANY")
    await make_org(session, owner, "COMPANY", name="Pending Co", verification_status="PENDING")
    await make_org(session, owner, "STORE", name="Approved Shop", verification_status="APPROVED")
    await session.commit()

    view = (await client.get(ME, headers=auth(owner))).json()

    assert {(m["org_name"], m["verification_status"]) for m in view["memberships"]} == {
        ("Pending Co", "PENDING"),
        ("Approved Shop", "APPROVED"),
    }
    assert view["onboarding"]["org_type"] == "COMPANY"


async def test_creating_the_intended_organization_ends_onboarding_without_duplicates(
    client: AsyncClient, session: AsyncSession, outbox: list[OutgoingEmail]
) -> None:
    token = await register_and_sign_in(client, outbox, org_type="COMPANY", org_name="Pamir Trade")
    headers = {"Authorization": f"Bearer {token}"}

    created = await client.post(COMPANIES, json=COMPANY, headers=headers)
    view = await me(client, await sign_in(client))

    assert created.status_code == 201
    assert created.json()["membership"]["verification_status"] == "NOT_SUBMITTED"
    [membership] = view["memberships"]
    assert membership["org_type"] == "COMPANY" and membership["role"] == "OWNER"
    assert membership["verification_status"] == "NOT_SUBMITTED"
    assert await organizations(session) == 1  # signing in again created nothing


# --- ORG-004: tax identifier per organization type -------------------------------------------------------------


async def test_duplicate_company_tax_identifier_is_rejected(client: AsyncClient, session: AsyncSession) -> None:
    first, second = await make_user(session), await make_user(session)
    await session.commit()
    assert (await client.post(COMPANIES, json=COMPANY, headers=auth(first))).status_code == 201

    duplicate = await client.post(COMPANIES, json={**COMPANY, "tax_identifier": " 510012345 "}, headers=auth(second))

    assert duplicate.status_code == 409 and error(duplicate) == "tax_identifier_taken"
    assert await organizations(session) == 1


async def test_duplicate_store_tax_identifier_is_rejected(client: AsyncClient, session: AsyncSession) -> None:
    first, second = await make_user(session), await make_user(session)
    await session.commit()
    assert (await client.post(STORES, json=STORE, headers=auth(first))).status_code == 201

    duplicate = await client.post(STORES, json=STORE, headers=auth(second))
    without_tax_id = await client.post(STORES, json={**STORE, "tax_identifier": None}, headers=auth(second))

    assert duplicate.status_code == 409 and error(duplicate) == "tax_identifier_taken"
    assert without_tax_id.status_code == 201  # ИНН is optional for a store (TZ P02 §1.2)


async def test_one_legal_entity_may_be_a_company_and_a_store(client: AsyncClient, session: AsyncSession) -> None:
    """TZ P02 §1.1/§1.2 make the ИНН unique per type: a distributor may also run its own shop (owner decision)."""
    user = await make_user(session)
    await session.commit()

    company = await client.post(COMPANIES, json=COMPANY, headers=auth(user))
    store = await client.post(STORES, json=STORE, headers=auth(user))

    assert company.status_code == 201 and store.status_code == 201


@pytest.mark.parametrize(("url", "payload"), [(COMPANIES, COMPANY), (STORES, STORE)])
async def test_concurrent_duplicates_create_one_organization_and_answer_409(
    client: AsyncClient, session: AsyncSession, url: str, payload: dict[str, str]
) -> None:
    users = [await make_user(session) for _ in range(4)]
    await session.commit()

    responses = await asyncio.gather(*(client.post(url, json=payload, headers=auth(user)) for user in users))

    statuses = sorted(response.status_code for response in responses)
    assert statuses == [201, 409, 409, 409], [r.text for r in responses]
    assert {error(r) for r in responses if r.status_code == 409} == {"tax_identifier_taken"}
    assert await organizations(session) == 1


async def test_editing_to_a_taken_tax_identifier_is_rejected(client: AsyncClient, session: AsyncSession) -> None:
    first, second = await make_user(session), await make_user(session)
    await session.commit()
    await client.post(COMPANIES, json=COMPANY, headers=auth(first))
    created = await client.post(COMPANIES, json={**COMPANY, "tax_identifier": "510099999"}, headers=auth(second))
    org_id = created.json()["organization"]["id"]
    headers = {**auth(second), "X-Org-Id": org_id}
    version = (await client.get("/api/v1/organization", headers=headers)).json()["version"]

    response = await client.patch(
        "/api/v1/organization", json={"version": version, "tax_identifier": "510012345"}, headers=headers
    )

    assert response.status_code == 409 and error(response) == "tax_identifier_taken"


async def test_another_users_organization_is_invisible(client: AsyncClient, session: AsyncSession) -> None:
    owner, stranger = await make_user(session), await make_user(session)
    org = await make_org(session, owner, "COMPANY")
    await session.commit()

    response = await client.get("/api/v1/organization", headers=auth(stranger, org))

    assert response.status_code == 404
