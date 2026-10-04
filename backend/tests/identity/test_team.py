import asyncio
from collections.abc import Iterator
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.cli import create_superadmin
from app.core.audit import AuditLog
from app.core.email import EmailDeliveryError, MemoryEmailProvider, OutgoingEmail, set_email_provider
from app.core.errors import AppError
from app.core.outbox import OutboxEvent
from app.core.time import utcnow
from app.modules.identity import ports
from app.modules.identity.models import Membership, MembershipInvitation, Organization, User
from app.modules.identity.team_service import expire_invitations
from tests.factories import add_member, auth, make_org, make_user


@pytest.fixture(autouse=True)
def email_outbox() -> Iterator[list[OutgoingEmail]]:
    provider = MemoryEmailProvider()
    set_email_provider(provider)
    yield provider.outbox
    set_email_provider(None)


async def setup(session: AsyncSession, org_type: str = "COMPANY") -> tuple[User, Organization, User]:
    owner = await make_user(session)
    org = await make_org(session, owner, org_type)
    recipient = await make_user(session)
    await session.commit()
    return owner, org, recipient


async def create_invite(client: AsyncClient, owner: User, org: Organization, recipient: User) -> dict:
    response = await client.post(
        "/api/v1/members/invitations",
        headers=auth(owner, org),
        json={"email": recipient.email, "role": "MANAGER" if org.type == "COMPANY" else "SELLER"},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize("org_type", ["COMPANY", "STORE"])
async def test_iam_team_full_lifecycle(
    client: AsyncClient, session: AsyncSession, email_outbox: list[OutgoingEmail], org_type: str
) -> None:
    owner, org, recipient = await setup(session, org_type)
    invitation = await create_invite(client, owner, org, recipient)
    assert len(email_outbox) == 1 and email_outbox[0].to == recipient.email
    assert "/invitations" in email_outbox[0].text
    inbox = (await client.get("/api/v1/me/invitations", headers=auth(recipient))).json()
    assert inbox["count"] == 1
    assert (await client.get("/api/v1/me/invitations", headers=auth(owner))).json()["count"] == 0
    accepted = await client.post(f"/api/v1/me/invitations/{invitation['id']}/accept", headers=auth(recipient))
    assert accepted.status_code == 200, accepted.text
    member_id = accepted.json()["id"]
    me = (await client.get("/api/v1/me", headers=auth(recipient))).json()
    assert me["memberships"][0]["organization_id"] == str(org.id)
    headers = auth(owner, org)
    updated = await client.patch(
        f"/api/v1/members/{member_id}",
        headers=headers,
        json={"role": "OPERATOR" if org_type == "COMPANY" else "SELLER", "version": 1},
    )
    assert updated.status_code == 200 and updated.json()["version"] == 2
    assert (
        await client.post(f"/api/v1/members/{member_id}/suspend", headers=headers, json={"reason": "On leave"})
    ).status_code == 200
    assert (await client.get("/api/v1/organization", headers=auth(recipient, org))).status_code == 403
    assert (await client.post(f"/api/v1/members/{member_id}/reactivate", headers=headers)).status_code == 200
    assert (await client.get("/api/v1/organization", headers=auth(recipient, org))).status_code == 200
    assert (
        await client.post(f"/api/v1/members/{member_id}/revoke", headers=headers, json={"reason": "Contract ended"})
    ).status_code == 200
    assert (await client.get("/api/v1/organization", headers=auth(recipient, org))).json()["error"][
        "code"
    ] == "membership_inactive"
    assert (await client.get("/api/v1/me", headers=auth(recipient))).json()["memberships"] == []
    assert (await client.post(f"/api/v1/members/{member_id}/reactivate", headers=headers)).status_code == 409
    actions = set((await session.scalars(select(AuditLog.action))).all())
    assert {
        "invitation.created",
        "invitation.accepted",
        "membership.created",
        "membership.role_changed",
        "membership.suspended",
        "membership.reactivated",
        "membership.revoked",
    } <= actions
    events = set((await session.scalars(select(OutboxEvent.event_type))).all())
    assert {"INVITATION_CREATED", "MEMBERSHIP_CREATED", "MEMBERSHIP_ROLE_CHANGED", "MEMBERSHIP_REVOKED"} <= events


ROLES = [("COMPANY", role) for role in ("OWNER", "MANAGER", "OPERATOR", "WAREHOUSE", "COURIER")] + [
    ("STORE", role) for role in ("OWNER", "SELLER")
]


@pytest.mark.parametrize(("org_type", "role"), ROLES)
@pytest.mark.parametrize("permission", ["view", "invite", "change_role", "suspend", "revoke"])
async def test_permission_matrix_p01_all_cells(
    client: AsyncClient, session: AsyncSession, org_type: str, role: str, permission: str
) -> None:
    owner, org, recipient = await setup(session, org_type)
    actor = owner if role == "OWNER" else await make_user(session)
    if role != "OWNER":
        await add_member(session, org, actor, role)
    member = await add_member(session, org, recipient, "MANAGER" if org_type == "COMPANY" else "SELLER")
    await session.commit()
    headers = auth(actor, org)
    if permission == "view":
        response = await client.get("/api/v1/members", headers=headers)
    elif permission == "invite":
        response = await client.post(
            "/api/v1/members/invitations",
            headers=headers,
            json={"email": "next-member@example.tj", "role": "MANAGER" if org_type == "COMPANY" else "SELLER"},
        )
    elif permission == "change_role":
        response = await client.patch(
            f"/api/v1/members/{member.id}",
            headers=headers,
            json={"role": "OPERATOR" if org_type == "COMPANY" else "SELLER", "version": 1},
        )
    else:
        response = await client.post(
            f"/api/v1/members/{member.id}/{permission}", headers=headers, json={"reason": "Test"}
        )
    allowed = role == "OWNER" or permission == "view" and role == "MANAGER"
    assert response.status_code == (201 if permission == "invite" else 200) if allowed else response.status_code == 403


async def test_iam_011_self_owner_cross_type_and_version(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, recipient = await setup(session)
    member = await add_member(session, org, recipient, "MANAGER")
    own = (await session.scalars(select(Membership).where(Membership.user_id == owner.id))).one()
    await session.commit()
    headers = auth(owner, org)
    own_response = await client.patch(
        f"/api/v1/members/{own.id}", headers=headers, json={"role": "MANAGER", "version": 1}
    )
    assert own_response.json()["error"]["code"] == "self_role_change_forbidden"
    for role in ("OWNER", "SELLER"):
        assert (
            await client.patch(f"/api/v1/members/{member.id}", headers=headers, json={"role": role, "version": 1})
        ).status_code == 403
    stale = await client.patch(f"/api/v1/members/{member.id}", headers=headers, json={"role": "OPERATOR", "version": 2})
    assert stale.json()["error"]["code"] == "version_conflict"
    assert (
        await client.post(f"/api/v1/members/{own.id}/suspend", headers=headers, json={"reason": "x"})
    ).status_code == 403
    assert (await client.post("/api/v1/members/leave", headers=headers)).status_code == 403


async def test_iam_012_email_mismatch_and_invalid_invitation(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, recipient = await setup(session)
    invitation = await create_invite(client, owner, org, recipient)
    for action in ("accept", "decline"):
        response = await client.post(f"/api/v1/me/invitations/{invitation['id']}/{action}", headers=auth(owner))
        assert response.json()["error"]["code"] == "invitation_email_mismatch"
    declined = await client.post(f"/api/v1/me/invitations/{invitation['id']}/decline", headers=auth(recipient))
    assert declined.status_code == 200 and declined.json()["status"] == "DECLINED"
    assert (
        await client.post(f"/api/v1/me/invitations/{invitation['id']}/accept", headers=auth(recipient))
    ).status_code == 422


async def test_iam_013_existing_membership_blocks_accept(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, recipient = await setup(session)
    invitation = await create_invite(client, owner, org, recipient)
    await add_member(session, org, recipient, "OPERATOR")
    await session.commit()
    response = await client.post(f"/api/v1/me/invitations/{invitation['id']}/accept", headers=auth(recipient))
    assert response.status_code == 409 and response.json()["error"]["code"] == "membership_already_exists"


async def test_invite_idempotent_case_insensitive_and_parallel_unique(
    client: AsyncClient, session: AsyncSession, email_outbox: list[OutgoingEmail]
) -> None:
    owner, org, recipient = await setup(session)
    headers = auth(owner, org)
    payload = {"email": recipient.email.upper(), "role": "MANAGER"}
    first = await client.post("/api/v1/members/invitations", headers=headers, json=payload)
    replay = await client.post("/api/v1/members/invitations", headers=headers, json=payload)
    assert first.status_code == replay.status_code == 201 and first.json() == replay.json()
    assert first.json()["email"] == recipient.email.lower() and len(email_outbox) == 1
    other = await make_user(session)
    await session.commit()
    responses = await asyncio.gather(
        *(
            client.post(
                "/api/v1/members/invitations", headers=auth(owner, org), json={"email": other.email, "role": "OPERATOR"}
            )
            for _ in range(2)
        )
    )
    assert sorted(r.status_code for r in responses) == [201, 422]
    assert (await session.scalar(select(func.count()).select_from(MembershipInvitation))) == 2


async def test_accept_idempotent_and_concurrent_version(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, recipient = await setup(session)
    invitation = await create_invite(client, owner, org, recipient)
    headers = auth(recipient)
    url = f"/api/v1/me/invitations/{invitation['id']}/accept"
    accepted = await client.post(url, headers=headers)
    replay = await client.post(url, headers=headers)
    assert accepted.status_code == replay.status_code == 200 and accepted.json() == replay.json()
    member_id = accepted.json()["id"]
    responses = await asyncio.gather(
        *(
            client.patch(f"/api/v1/members/{member_id}", headers=auth(owner, org), json={"role": role, "version": 1})
            for role in ("OPERATOR", "WAREHOUSE")
        )
    )
    assert sorted(r.status_code for r in responses) == [200, 409]


async def test_invitation_expiry_reinvite_and_revocation(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, recipient = await setup(session)
    invitation = await create_invite(client, owner, org, recipient)
    row = await session.get(MembershipInvitation, invitation["id"])
    assert row is not None
    row.expires_at = utcnow() - timedelta(seconds=1)
    await session.commit()
    assert (await client.get("/api/v1/me/invitations", headers=auth(recipient))).json()["count"] == 0
    assert (await client.post(f"/api/v1/me/invitations/{row.id}/accept", headers=auth(recipient))).status_code == 422
    assert await expire_invitations(session) == 1
    assert await expire_invitations(session) == 0
    await session.commit()
    assert (
        await session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.action == "invitation.expired", AuditLog.entity_id == row.id)
        )
        == 1
    )
    new = await create_invite(client, owner, org, recipient)
    revoked = await client.post(f"/api/v1/members/invitations/{new['id']}/revoke", headers=auth(owner, org))
    assert revoked.status_code == 200 and revoked.json()["status"] == "REVOKED"
    assert (await client.post(f"/api/v1/me/invitations/{new['id']}/accept", headers=auth(recipient))).status_code == 422


async def test_team_tenant_isolation_and_leave(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, recipient = await setup(session)
    invitation = await create_invite(client, owner, org, recipient)
    foreign_owner = await make_user(session)
    foreign_org = await make_org(session, foreign_owner)
    member = await add_member(session, org, recipient, "OPERATOR")
    await session.commit()
    assert (
        await client.patch(
            f"/api/v1/members/{member.id}",
            headers=auth(foreign_owner, foreign_org),
            json={"role": "MANAGER", "version": 1},
        )
    ).status_code == 404
    assert (
        await client.post(
            f"/api/v1/members/invitations/{invitation['id']}/revoke", headers=auth(foreign_owner, foreign_org)
        )
    ).status_code == 404
    assert (await client.post("/api/v1/members/leave", headers=auth(recipient, org))).status_code == 204
    assert (await client.get("/api/v1/organization", headers=auth(recipient, org))).status_code == 403
    assert "membership.left" in (await session.scalars(select(AuditLog.action))).all()


async def test_invitation_email_failure_rolls_back(client: AsyncClient, session: AsyncSession) -> None:
    owner, org, recipient = await setup(session)

    class FailingEmail:
        async def send(self, email: OutgoingEmail) -> None:
            raise EmailDeliveryError("offline")

    set_email_provider(FailingEmail())
    response = await client.post(
        "/api/v1/members/invitations", headers=auth(owner, org), json={"email": recipient.email, "role": "MANAGER"}
    )
    assert response.status_code == 503
    for model in (MembershipInvitation, AuditLog, OutboxEvent):
        assert await session.scalar(select(func.count()).select_from(model)) == 0


async def test_subscription_port_blocks_accept_and_reactivate(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, org, recipient = await setup(session)
    invitation = await create_invite(client, owner, org, recipient)

    class BlockedGuard:
        async def check_limit(self, session: AsyncSession, org_id: object, kind: str, adding: int = 1) -> None:
            raise AppError("subscription_limit_reached", 403)

    monkeypatch.setattr(ports, "subscription_guard", BlockedGuard())
    response = await client.post(f"/api/v1/me/invitations/{invitation['id']}/accept", headers=auth(recipient))
    assert response.json()["error"]["code"] == "subscription_limit_reached"
    member = await add_member(session, org, recipient, "MANAGER", "SUSPENDED")
    await session.commit()
    assert (await client.post(f"/api/v1/members/{member.id}/reactivate", headers=auth(owner, org))).status_code == 403
    await session.refresh(member)
    assert member.status == "SUSPENDED"


@pytest.mark.parametrize(("org_type", "role"), [("COMPANY", "SELLER"), ("STORE", "MANAGER"), ("STORE", "OWNER")])
async def test_invitation_role_database_constraint(session: AsyncSession, org_type: str, role: str) -> None:
    owner, org, recipient = await setup(session, org_type)
    session.add(
        MembershipInvitation(
            organization_id=org.id,
            email=recipient.email,
            role=role,
            invited_by=owner.id,
            expires_at=utcnow() + timedelta(days=7),
        )
    )
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_superadmin_created_only_by_cli_service(session: AsyncSession) -> None:
    user = await create_superadmin(session, "operator@example.tj", "Platform Admin", "NewAdmin2026!")
    assert user.is_superadmin and user.email_verified_at and user.password_hash != "NewAdmin2026!"
    with pytest.raises(ValueError):
        await create_superadmin(session, "operator@example.tj", "Platform Admin", "NewAdmin2026!")
