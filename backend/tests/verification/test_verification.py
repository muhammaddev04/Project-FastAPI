"""P02 verification: VER-001 (OWNER submits), VER-003 (required documents), §2.1 state machine
(SUBMITTED -> UNDER_REVIEW -> APPROVED/REJECTED by SUPERADMIN only), VER-004 (audited document access), VER-006
(`organization_not_verified`), ORG-005 (legal fields frozen while PENDING and after APPROVED), audit per transition."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.core.errors import AppError
from app.core.outbox import OutboxEvent
from app.modules.files.models import StoredFile
from app.modules.identity.models import Organization, User
from app.modules.verification.service import ensure_approved
from tests.factories import add_member, auth, make_org, make_user

PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n"
VERIFY = "/api/v1/verification"
ADMIN = "/api/v1/admin/verifications"


async def upload(client: AsyncClient, owner: User, org: Organization, name: str = "cert.pdf") -> str:
    response = await client.post(
        "/api/v1/files",
        headers=auth(owner, org),
        data={"category": "VERIFICATION"},
        files={"file": (name, PDF, "application/pdf")},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def documents_for(client: AsyncClient, owner: User, org: Organization) -> list[dict[str, str]]:
    docs = [{"doc_type": "REGISTRATION_CERTIFICATE", "file_id": await upload(client, owner, org, "reg.pdf")}]
    if org.type == "COMPANY":
        docs.append({"doc_type": "TAX_CERTIFICATE", "file_id": await upload(client, owner, org, "tax.pdf")})
    return docs


async def submit(client: AsyncClient, owner: User, org: Organization) -> Response:
    return await client.post(
        VERIFY, json={"documents": await documents_for(client, owner, org)}, headers=auth(owner, org)
    )


async def setup(session: AsyncSession, org_type: str = "COMPANY") -> tuple[User, Organization, User]:
    owner = await make_user(session)
    org = await make_org(session, owner, org_type, name=f"{org_type.title()} One")
    admin = await make_user(session, is_superadmin=True)
    await session.commit()
    return owner, org, admin


async def request_id(client: AsyncClient, owner: User, org: Organization) -> str:
    response = await submit(client, owner, org)
    assert response.status_code == 201, response.text
    return str(response.json()["latest_request"]["id"])


async def actions(session: AsyncSession, prefix: str = "verification.") -> list[str]:
    session.expire_all()
    rows = (await session.scalars(select(AuditLog.action).order_by(AuditLog.created_at))).all()
    return [action for action in rows if action.startswith(prefix)]


def error(response: Response) -> Any:
    return response.json()["error"]["code"]


# --- submission (organization side) ---------------------------------------------------------------------------------


@pytest.mark.parametrize("org_type", ["COMPANY", "STORE"])
async def test_new_organization_is_not_submitted_and_can_submit(
    client: AsyncClient, session: AsyncSession, org_type: str
) -> None:
    owner, org, _ = await setup(session, org_type)

    state = (await client.get(VERIFY, headers=auth(owner, org))).json()

    assert state["verification_status"] == "NOT_SUBMITTED" and state["can_submit"] is True
    assert state["latest_request"] is None and state["verified_at"] is None
    expected = (
        ["REGISTRATION_CERTIFICATE", "TAX_CERTIFICATE"] if org_type == "COMPANY" else ["REGISTRATION_CERTIFICATE"]
    )
    assert state["required_documents"] == expected


@pytest.mark.parametrize("org_type", ["COMPANY", "STORE"])
async def test_submission_makes_the_organization_pending_not_verified(
    client: AsyncClient, session: AsyncSession, org_type: str
) -> None:
    owner, org, _ = await setup(session, org_type)

    response = await submit(client, owner, org)

    assert response.status_code == 201, response.text
    state = response.json()
    assert state["verification_status"] == "PENDING" and state["verified_at"] is None and state["can_submit"] is False
    request = state["latest_request"]
    assert request["status"] == "SUBMITTED" and request["rejection_reason"] is None
    assert {doc["doc_type"] for doc in request["documents"]} == set(state["required_documents"])
    profile = (await client.get("/api/v1/organization", headers=auth(owner, org))).json()
    assert profile["verification_status"] == "PENDING" and profile["legal_locked"] is True
    assert await actions(session) == ["verification.submitted"]


async def test_company_needs_both_certificates(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, _ = await setup(session, "COMPANY")
    only_registration = [{"doc_type": "REGISTRATION_CERTIFICATE", "file_id": await upload(client, owner, org)}]

    response = await client.post(VERIFY, json={"documents": only_registration}, headers=auth(owner, org))

    assert response.status_code == 422 and error(response) == "verification_documents_missing"
    assert response.json()["error"]["details"]["missing"] == ["TAX_CERTIFICATE"]
    assert (await client.get(VERIFY, headers=auth(owner, org))).json()["verification_status"] == "NOT_SUBMITTED"


async def test_documents_must_be_this_organizations_verification_files(
    client: AsyncClient, session: AsyncSession
) -> None:
    owner, org, _ = await setup(session, "STORE")
    other_owner = await make_user(session)
    other_org = await make_org(session, other_owner, "STORE")
    import_file = StoredFile(
        organization_id=org.id,
        category="IMPORT",
        storage_key=f"{org.id}/import/x.pdf",
        content_type="application/pdf",
        size_bytes=10,
        sha256="0" * 64,
        display_name="x.pdf",
        uploaded_by=owner.id,
    )
    session.add(import_file)
    await session.commit()
    foreign = await upload(client, other_owner, other_org)

    stolen = await client.post(
        VERIFY,
        json={"documents": [{"doc_type": "REGISTRATION_CERTIFICATE", "file_id": foreign}]},
        headers=auth(owner, org),
    )
    wrong_category = await client.post(
        VERIFY,
        json={"documents": [{"doc_type": "REGISTRATION_CERTIFICATE", "file_id": str(import_file.id)}]},
        headers=auth(owner, org),
    )

    assert stolen.status_code == 404
    assert wrong_category.status_code == 422 and error(wrong_category) == "validation_error"


async def test_ver_001_only_the_owner_submits(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, _ = await setup(session, "COMPANY")
    manager, operator = await make_user(session), await make_user(session)
    await add_member(session, org, manager, "MANAGER")
    await add_member(session, org, operator, "OPERATOR")
    await session.commit()
    docs = await documents_for(client, owner, org)

    by_manager = await client.post(VERIFY, json={"documents": docs}, headers=auth(manager, org))

    assert by_manager.status_code == 403 and error(by_manager) == "permission_denied"
    assert (await client.get(VERIFY, headers=auth(manager, org))).status_code == 200  # verification.view
    assert (await client.get(VERIFY, headers=auth(operator, org))).status_code == 403


async def test_one_open_request_at_a_time(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, _ = await setup(session, "STORE")
    assert (await submit(client, owner, org)).status_code == 201

    again = await submit(client, owner, org)

    assert again.status_code == 409 and error(again) == "invalid_transition"


async def test_concurrent_submissions_open_one_request(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, _ = await setup(session, "STORE")
    doc_sets = [await documents_for(client, owner, org) for _ in range(3)]

    responses = await asyncio.gather(
        *(client.post(VERIFY, json={"documents": docs}, headers=auth(owner, org)) for docs in doc_sets)
    )

    assert sorted(r.status_code for r in responses) == [201, 409, 409]


async def test_suspended_organization_cannot_submit(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, _ = await setup(session, "STORE")
    docs = await documents_for(client, owner, org)
    org.status = "SUSPENDED"
    await session.commit()

    response = await client.post(VERIFY, json={"documents": docs}, headers=auth(owner, org))

    assert response.status_code == 403 and error(response) == "organization_blocked"


# --- no self-verification -------------------------------------------------------------------------------------------


async def test_owner_cannot_verify_itself(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, _ = await setup(session, "COMPANY")
    rid = await request_id(client, owner, org)
    profile = (await client.get("/api/v1/organization", headers=auth(owner, org))).json()

    patched = await client.patch(
        "/api/v1/organization",
        json={"version": profile["version"], "verification_status": "APPROVED"},
        headers=auth(owner, org),
    )
    admin_calls = [
        await client.get(ADMIN, headers=auth(owner)),
        await client.get(f"{ADMIN}/{rid}", headers=auth(owner)),
        await client.post(f"{ADMIN}/{rid}/start-review", headers=auth(owner)),
        await client.post(f"{ADMIN}/{rid}/approve", headers=auth(owner, org)),
    ]

    assert patched.status_code == 422 and error(patched) == "validation_error"
    assert all(r.status_code == 403 and error(r) == "permission_denied" for r in admin_calls)
    assert (await client.get(VERIFY, headers=auth(owner, org))).json()["verification_status"] == "PENDING"


async def test_admin_endpoints_need_a_signed_in_superadmin(client: AsyncClient, session: AsyncSession) -> None:
    await setup(session)

    assert (await client.get(ADMIN)).status_code == 401
    assert (await client.get(ADMIN, headers={"Authorization": "Bearer nope"})).status_code == 401


# --- SUPERADMIN review ----------------------------------------------------------------------------------------------


@pytest.mark.parametrize("org_type", ["COMPANY", "STORE"])
async def test_admin_reviews_and_approves(client: AsyncClient, session: AsyncSession, org_type: str) -> None:
    owner, org, admin = await setup(session, org_type)
    admin_id, org_id = admin.id, org.id
    rid = await request_id(client, owner, org)

    queue = (await client.get(ADMIN, params={"status": "SUBMITTED"}, headers=auth(admin))).json()
    assert [item["id"] for item in queue["results"]] == [rid] and queue["results"][0]["org_type"] == org_type
    detail = (await client.get(f"{ADMIN}/{rid}", headers=auth(admin))).json()
    assert detail["legal_snapshot"]["legal_name"] == f"{org_type.title()} One LLC"
    assert set(detail["legal_snapshot"]) == {"legal_name", "tax_identifier", "address"}
    assert detail["org_verification_status"] == "PENDING" and detail["history"] == []

    early = await client.post(f"{ADMIN}/{rid}/approve", headers=auth(admin))
    assert early.status_code == 409 and error(early) == "invalid_transition"
    started = await client.post(f"{ADMIN}/{rid}/start-review", headers=auth(admin))
    assert started.status_code == 200 and started.json()["status"] == "UNDER_REVIEW"
    assert started.json()["reviewer_id"] == str(admin_id)
    approved = await client.post(f"{ADMIN}/{rid}/approve", headers=auth(admin))

    assert approved.status_code == 200 and approved.json()["status"] == "APPROVED"
    state = (await client.get(VERIFY, headers=auth(owner, org))).json()
    assert state["verification_status"] == "APPROVED" and state["verified_at"] is not None
    assert await actions(session) == ["verification.submitted", "verification.under_review", "verification.approved"]
    [entry] = (await session.scalars(select(AuditLog).where(AuditLog.action == "verification.approved"))).all()
    assert entry.actor_id == admin_id and entry.org_id == org_id
    assert entry.old_data == {"request_status": "UNDER_REVIEW", "verification_status": "PENDING"}
    assert entry.new_data == {"request_status": "APPROVED", "verification_status": "APPROVED"}
    events = (await session.scalars(select(OutboxEvent).order_by(OutboxEvent.created_at))).all()
    assert [event.event_type for event in events] == ["VERIFICATION_SUBMITTED", "VERIFICATION_APPROVED"]
    assert all(event.org_id == org_id and event.payload["request_id"] == rid for event in events)


async def test_only_the_reviewer_approves(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, admin = await setup(session, "STORE")
    other_admin = await make_user(session, is_superadmin=True)
    await session.commit()
    rid = await request_id(client, owner, org)
    await client.post(f"{ADMIN}/{rid}/start-review", headers=auth(admin))

    response = await client.post(f"{ADMIN}/{rid}/approve", headers=auth(other_admin))

    assert response.status_code == 403
    assert (await client.get(VERIFY, headers=auth(owner, org))).json()["verification_status"] == "PENDING"


async def test_rejection_needs_a_reason_and_the_owner_sees_it_and_can_resubmit(
    client: AsyncClient, session: AsyncSession
) -> None:
    owner, org, admin = await setup(session, "COMPANY")
    rid = await request_id(client, owner, org)
    await client.post(f"{ADMIN}/{rid}/start-review", headers=auth(admin))

    short = await client.post(f"{ADMIN}/{rid}/reject", json={"reason": "  too   short "}, headers=auth(admin))
    assert short.status_code == 422 and error(short) == "rejection_reason_required"
    reason = "The tax certificate is unreadable; upload a clear scan."
    rejected = await client.post(f"{ADMIN}/{rid}/reject", json={"reason": reason}, headers=auth(admin))

    assert rejected.status_code == 200 and rejected.json()["status"] == "REJECTED"
    state = (await client.get(VERIFY, headers=auth(owner, org))).json()
    assert state["verification_status"] == "REJECTED" and state["can_submit"] is True
    assert state["latest_request"]["rejection_reason"] == reason
    [entry] = (await session.scalars(select(AuditLog).where(AuditLog.action == "verification.rejected"))).all()
    assert entry.reason == reason and entry.actor_id == admin.id
    # A rejected organization is not treated as verified, and it can submit a new request.
    with pytest.raises(AppError) as blocked:
        await ensure_approved(session, org, "company")
    assert blocked.value.code == "organization_not_verified"
    new_id = await request_id(client, owner, org)
    detail = (await client.get(f"{ADMIN}/{new_id}", headers=auth(admin))).json()
    assert detail["status"] == "SUBMITTED"
    assert [(item["id"], item["status"], item["rejection_reason"]) for item in detail["history"]] == [
        (rid, "REJECTED", reason)
    ]


@pytest.mark.parametrize("action", ["start-review", "approve", "reject"])
async def test_decisions_are_final(client: AsyncClient, session: AsyncSession, action: str) -> None:
    owner, org, admin = await setup(session, "STORE")
    rid = await request_id(client, owner, org)
    await client.post(f"{ADMIN}/{rid}/start-review", headers=auth(admin))
    await client.post(f"{ADMIN}/{rid}/approve", headers=auth(admin))

    body = {"reason": "Changed my mind after approval."} if action == "reject" else None
    response = await client.post(f"{ADMIN}/{rid}/{action}", json=body, headers=auth(admin))

    assert response.status_code == 409 and error(response) == "invalid_transition"
    assert (await client.get(VERIFY, headers=auth(owner, org))).json()["verification_status"] == "APPROVED"


async def test_approved_organization_cannot_resubmit(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, admin = await setup(session, "STORE")
    rid = await request_id(client, owner, org)
    await client.post(f"{ADMIN}/{rid}/start-review", headers=auth(admin))
    await client.post(f"{ADMIN}/{rid}/approve", headers=auth(admin))

    again = await submit(client, owner, org)

    assert again.status_code == 409 and error(again) == "verification_not_editable"


async def test_queue_filters_by_status_and_type(client: AsyncClient, session: AsyncSession) -> None:
    owner_c, company, admin = await setup(session, "COMPANY")
    owner_s = await make_user(session)
    store = await make_org(session, owner_s, "STORE", name="Shop")
    await session.commit()
    company_rid = await request_id(client, owner_c, company)
    store_rid = await request_id(client, owner_s, store)

    stores = (await client.get(ADMIN, params={"org_type": "STORE"}, headers=auth(admin))).json()
    newest_first = (await client.get(ADMIN, params={"ordering": "-submitted_at"}, headers=auth(admin))).json()

    assert [item["id"] for item in stores["results"]] == [store_rid] and stores["count"] == 1
    assert [item["id"] for item in newest_first["results"]] == [store_rid, company_rid]


async def test_document_access_by_superadmin_is_signed_and_audited(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, admin = await setup(session, "STORE")
    rid = await request_id(client, owner, org)
    detail = (await client.get(f"{ADMIN}/{rid}", headers=auth(admin))).json()
    doc_id = detail["documents"][0]["id"]

    signed = await client.get(f"{ADMIN}/{rid}/documents/{doc_id}/url", headers=auth(admin))
    by_owner = await client.get(f"{ADMIN}/{rid}/documents/{doc_id}/url", headers=auth(owner))
    wrong_request = await client.get(f"{ADMIN}/{doc_id}/documents/{doc_id}/url", headers=auth(admin))

    assert signed.status_code == 200 and signed.json()["url"].startswith("http")
    assert signed.headers["Cache-Control"] == "no-store"
    assert by_owner.status_code == 403 and wrong_request.status_code == 404
    [viewed] = (await session.scalars(select(AuditLog).where(AuditLog.action == "verification.document_viewed"))).all()
    assert viewed.actor_id == admin.id and viewed.entity_id is not None


# --- VER-006 and ORG-005 --------------------------------------------------------------------------------------------


async def test_ver_006_guard_needs_an_approved_organization(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, admin = await setup(session, "COMPANY")
    org_id = org.id
    with pytest.raises(AppError) as not_submitted:
        await ensure_approved(session, org, "company")
    assert not_submitted.value.code == "organization_not_verified" and not_submitted.value.http_status == 409
    assert not_submitted.value.details == {"side": "company"}

    rid = await request_id(client, owner, org)
    with pytest.raises(AppError):
        await ensure_approved(session, org, "company")  # PENDING is not verified either
    await client.post(f"{ADMIN}/{rid}/start-review", headers=auth(admin))
    await client.post(f"{ADMIN}/{rid}/approve", headers=auth(admin))
    session.expire_all()
    fresh = await session.get(Organization, org_id)
    assert fresh is not None

    await ensure_approved(session, fresh, "company")  # no error once APPROVED


async def test_legal_fields_are_frozen_while_pending_but_contacts_stay_editable(
    client: AsyncClient, session: AsyncSession
) -> None:
    owner, org, _ = await setup(session, "COMPANY")
    await request_id(client, owner, org)
    profile = (await client.get("/api/v1/organization", headers=auth(owner, org))).json()

    legal = await client.patch(
        "/api/v1/organization",
        json={"version": profile["version"], "legal_name": "Another LLC"},
        headers=auth(owner, org),
    )
    contact = await client.patch(
        "/api/v1/organization", json={"version": profile["version"], "city": "Khujand"}, headers=auth(owner, org)
    )

    assert legal.status_code == 409 and error(legal) == "verification_not_editable"
    assert contact.status_code == 200 and contact.json()["city"] == "Khujand"
