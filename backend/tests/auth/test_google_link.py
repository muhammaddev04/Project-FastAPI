"""Linking a Google account to the signed-in user (owner request): its own LINK_GOOGLE transaction bound to the user
and the browser, state/nonce/PKCE like login, link by Google `sub` only, never moving a `sub` between users, and a
direct login for an unlinked password account with a verified Google-hosted email."""

from __future__ import annotations

import base64
import hashlib
import logging
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.modules.identity.models import OAuthIdentity
from tests.auth.test_google import (  # noqa: F401 - `configured` is an autouse fixture
    CLIENT_SECRET,
    callback,
    code,
    configured,
    google_answers,
    start,
    token_response,
)
from tests.auth.test_logout import log_out
from tests.auth.test_refresh import LOGIN, ME, PASSWORD, login, make_account, set_cookies
from tests.factories import auth, make_user

LINK = "/api/v1/auth/google/link"
LINK_START = "/api/v1/auth/google/link/start"
LINK_CALLBACK = "/api/v1/auth/google/link/callback"
EMAIL = "nigina@gmail.com"


@dataclass
class Linking:
    state: str
    nonce: str
    challenge: str
    binding: str


async def link_start(client: AsyncClient, headers: dict[str, str]) -> Linking:
    response = await client.post(LINK_START, headers=headers)
    assert response.status_code == 200, response.text
    query = {key: values[0] for key, values in parse_qs(urlparse(response.json()["authorization_url"]).query).items()}
    binding = set_cookies(response)["google_oauth"].split(";", 1)[0].split("=", 1)[1]
    client.cookies.clear()
    return Linking(query["state"], query["nonce"], query["code_challenge"], binding)


async def link_callback(
    client: AsyncClient,
    headers: dict[str, str],
    started: Linking,
    *,
    binding: str | None = None,
    code_value: str = "code-1",
) -> Response:
    cookie = started.binding if binding is None else binding
    response = await client.post(
        LINK_CALLBACK,
        json={"code": code_value, "state": started.state},
        headers={**headers, "Cookie": f"google_oauth={cookie}"} if cookie else headers,
    )
    client.cookies.clear()
    return response


async def password_user(session: AsyncSession, email: str = EMAIL) -> tuple[UUID, dict[str, str]]:
    user_id, _ = await make_account(session, email)
    from app.modules.identity.models import User

    user = await session.get(User, user_id)
    assert user is not None
    return user_id, auth(user)


async def link(client: AsyncClient, headers: dict[str, str], **claims: object) -> Response:
    started = await link_start(client, headers)
    google_answers(token_response(started.nonce, **claims))
    return await link_callback(client, headers, started)


async def identities(session: AsyncSession) -> list[OAuthIdentity]:
    session.expire_all()
    return list((await session.scalars(select(OAuthIdentity))).all())


async def google_login(client: AsyncClient, code_value: str = "login-code", **claims: object) -> Response:
    started = await start(client)
    google_answers(token_response(started.nonce, **claims))
    return await callback(client, started, code=code_value)


# --- the whole story ------------------------------------------------------------------------------------------------


async def test_password_account_links_google_and_then_signs_in_with_it_after_logout(
    client: AsyncClient, session: AsyncSession
) -> None:
    user_id, headers = await password_user(session)

    linked = await link(client, headers)
    assert linked.status_code == 200, linked.text
    assert linked.json()["connected"] is True and linked.json()["status"] == "linked"
    assert linked.json()["email"] == "nigina@gmail.com"
    [identity] = await identities(session)
    assert identity.user_id == user_id and identity.subject == "google-sub-1" and identity.provider == "google"

    # Sign in with the password, log out: the link stays.
    device = await login(client, EMAIL, PASSWORD)
    assert (await log_out(client, device)).status_code == 204
    assert len(await identities(session)) == 1

    after = await google_login(client, "login-code-2")
    assert after.status_code == 200, after.text
    assert after.json()["user"]["id"] == str(user_id)
    me = await client.get(ME, headers={"Authorization": f"Bearer {after.json()['access_token']}"})
    assert me.status_code == 200 and me.json()["id"] == str(user_id)
    # The password keeps working too.
    assert (await client.post(LOGIN, json={"email": EMAIL, "password": PASSWORD})).status_code == 200


async def test_status_shows_the_connection(client: AsyncClient, session: AsyncSession) -> None:
    _, headers = await password_user(session)
    assert (await client.get(LINK, headers=headers)).json() == {
        "connected": False,
        "status": None,
        "email": None,
        "linked_at": None,
    }

    await link(client, headers)

    status = (await client.get(LINK, headers=headers)).json()
    assert status["connected"] is True and status["email"] == "nigina@gmail.com" and status["linked_at"]


# --- who may link ---------------------------------------------------------------------------------------------------


async def test_linking_needs_a_signed_in_user(client: AsyncClient, session: AsyncSession) -> None:
    _, headers = await password_user(session)
    started = await link_start(client, headers)

    assert (await client.post(LINK_START)).status_code == 401
    assert (await client.get(LINK)).status_code == 401
    anonymous = await client.post(
        LINK_CALLBACK, json={"code": "c", "state": started.state}, headers={"Cookie": f"google_oauth={started.binding}"}
    )
    assert anonymous.status_code == 401
    assert await identities(session) == []


async def test_start_redirects_to_google_with_state_nonce_and_pkce(client: AsyncClient, session: AsyncSession) -> None:
    _, headers = await password_user(session)

    response = await client.post(LINK_START, headers=headers)

    url = response.json()["authorization_url"]
    query = {key: values[0] for key, values in parse_qs(urlparse(url).query).items()}
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert query["code_challenge_method"] == "S256" and len(query["state"]) >= 43 and len(query["nonce"]) >= 43
    assert CLIENT_SECRET not in url and CLIENT_SECRET not in response.text
    cookie = set_cookies(response)["google_oauth"].lower()
    assert all(part in cookie for part in ("httponly", "secure", "samesite=lax", "path=/api/v1/auth/google"))
    assert response.headers["Cache-Control"] == "no-store"


async def test_a_link_started_by_one_user_cannot_be_finished_by_another(
    client: AsyncClient, session: AsyncSession
) -> None:
    _, victim_headers = await password_user(session)
    _, attacker_headers = await password_user(session, "attacker@example.tj")
    started = await link_start(client, attacker_headers)
    seen = google_answers(token_response(started.nonce))

    # Even with the attacker's own browser cookie, the victim's session cannot finish it (and vice versa).
    stolen = await link_callback(client, victim_headers, started)

    assert stolen.status_code == 400 and code(stolen) == "oauth_state_invalid"
    assert seen == [] and await identities(session) == []


async def test_login_and_link_transactions_do_not_mix(client: AsyncClient, session: AsyncSession) -> None:
    user_id, headers = await password_user(session)
    login_started = await start(client)
    google_answers(token_response(login_started.nonce))
    as_link = await client.post(
        LINK_CALLBACK,
        json={"code": "c", "state": login_started.state},
        headers={**headers, "Cookie": f"google_oauth={login_started.binding}"},
    )
    link_started = await link_start(client, headers)
    as_login = await client.post(
        "/api/v1/auth/google/callback",
        json={"code": "c", "state": link_started.state},
        headers={"Cookie": f"google_oauth={link_started.binding}"},
    )

    assert as_link.status_code == 400 and code(as_link) == "oauth_state_invalid"
    assert as_login.status_code == 400 and code(as_login) == "oauth_state_invalid"
    assert "refresh_token" not in set_cookies(as_login)
    assert await identities(session) == []


@pytest.mark.parametrize("binding", ["", "someone-elses-binding"])
async def test_link_state_is_bound_to_the_browser(client: AsyncClient, session: AsyncSession, binding: str) -> None:
    _, headers = await password_user(session)
    started = await link_start(client, headers)
    seen = google_answers(token_response(started.nonce))

    response = await link_callback(client, headers, started, binding=binding)

    assert response.status_code == 400 and code(response) == "oauth_state_invalid"
    assert seen == []


async def test_link_callback_is_single_use(client: AsyncClient, session: AsyncSession) -> None:
    _, headers = await password_user(session)
    started = await link_start(client, headers)
    google_answers(token_response(started.nonce))
    assert (await link_callback(client, headers, started)).status_code == 200

    replay = await link_callback(client, headers, started, code_value="code-2")

    assert replay.status_code == 400 and code(replay) == "oauth_state_invalid"


@pytest.mark.parametrize(
    "overrides", [{"nonce": "wrong-nonce"}, {"aud": "another-client"}, {"iss": "https://evil.example"}]
)
async def test_id_token_is_checked_like_login(
    client: AsyncClient, session: AsyncSession, overrides: dict[str, object]
) -> None:
    _, headers = await password_user(session)

    response = await link(client, headers, **overrides)

    assert response.status_code == 400 and code(response) == "oauth_failed"
    assert await identities(session) == []


async def test_pkce_verifier_matches_the_challenge(client: AsyncClient, session: AsyncSession) -> None:
    _, headers = await password_user(session)
    started = await link_start(client, headers)
    seen = google_answers(token_response(started.nonce))

    await link_callback(client, headers, started)

    form = {key: values[0] for key, values in parse_qs(seen[0].content.decode()).items()}
    digest = base64.urlsafe_b64encode(hashlib.sha256(form["code_verifier"].encode()).digest()).rstrip(b"=").decode()
    assert digest == started.challenge and form["client_secret"] == CLIENT_SECRET


# --- ownership rules ------------------------------------------------------------------------------------------------


async def test_a_google_account_of_another_user_is_never_moved(client: AsyncClient, session: AsyncSession) -> None:
    owner_id, owner_headers = await password_user(session)
    await link(client, owner_headers)
    _, other_headers = await password_user(session, "other@example.tj")

    response = await link(client, other_headers)

    assert response.status_code == 409 and code(response) == "oauth_identity_already_linked"
    assert "nigina" not in response.text.lower()  # nothing about the other account leaks
    [identity] = await identities(session)
    assert identity.user_id == owner_id


async def test_one_google_account_per_user(client: AsyncClient, session: AsyncSession) -> None:
    _, headers = await password_user(session)
    await link(client, headers)

    again = await client.post(LINK_START, headers=headers)

    assert again.status_code == 409 and code(again) == "oauth_provider_already_linked"
    assert len(await identities(session)) == 1


async def test_same_google_account_again_is_already_linked(client: AsyncClient, session: AsyncSession) -> None:
    user_id, headers = await password_user(session)
    started = await link_start(client, headers)
    session.add(OAuthIdentity(user_id=user_id, provider="google", subject="google-sub-1", email=EMAIL))
    await session.commit()
    google_answers(token_response(started.nonce))

    response = await link_callback(client, headers, started)

    assert response.status_code == 200 and response.json()["status"] == "already_linked"
    assert len(await identities(session)) == 1


async def test_matching_email_alone_links_nothing(client: AsyncClient, session: AsyncSession) -> None:
    """User B links a Google account whose email equals user A's address: it links to B (who proved control of that
    Google account), never to A, and A keeps signing in with the password."""
    a_id, _ = await password_user(session, "nigina@gmail.com")
    b_id, b_headers = await password_user(session, "b@example.tj")

    linked = await link(client, b_headers, email="Nigina@Gmail.com")

    assert linked.status_code == 200
    [identity] = await identities(session)
    assert identity.user_id == b_id and identity.user_id != a_id
    signed_in = await google_login(client)
    assert signed_in.json()["user"]["id"] == str(b_id)
    assert (await client.post(LOGIN, json={"email": "nigina@gmail.com", "password": PASSWORD})).status_code == 200


# --- audit and secrecy ------------------------------------------------------------------------------------------------


async def test_link_is_audited_without_secrets(
    client: AsyncClient, session: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    user_id, headers = await password_user(session)
    with caplog.at_level(logging.DEBUG):
        started = await link_start(client, headers)
        seen = google_answers(token_response(started.nonce))
        response = await link_callback(client, headers, started)

    [identity] = await identities(session)
    identity_id = str(identity.id)
    [entry] = (await session.scalars(select(AuditLog).where(AuditLog.action == "auth.google_linked"))).all()
    assert entry.entity_id == user_id and entry.actor_id == user_id
    assert entry.new_data == {"provider": "google", "identity_id": identity_id}
    verifier = parse_qs(seen[0].content.decode())["code_verifier"][0]
    for secret in (CLIENT_SECRET, verifier, started.binding, "code-1"):
        assert secret not in caplog.text and secret not in response.text
        assert secret not in str(entry.new_data)
    assert "id_token" not in response.text and "access_token" not in response.text


async def test_unlinked_password_account_signs_in_without_profile_linking(
    client: AsyncClient, session: AsyncSession
) -> None:
    user = await make_user(session, email=EMAIL)
    await session.commit()
    user_id = user.id

    response = await google_login(client)

    assert response.status_code == 200
    assert response.json()["user"]["id"] == str(user_id)
    [identity] = await identities(session)
    assert identity.user_id == user_id


async def test_google_sign_in_keeps_the_accounts_onboarding_state(client: AsyncClient, session: AsyncSession) -> None:
    """Google authenticates the same user: after linking, a Google sign-in sees the same registration intent and
    creates no organization."""
    user = await make_user(session, email=EMAIL, onboarding_org_type="STORE", onboarding_org_name="Corner Market")
    await session.commit()
    await link(client, auth(user))

    signed_in = await google_login(client)
    me = await client.get(ME, headers={"Authorization": f"Bearer {signed_in.json()['access_token']}"})

    assert signed_in.json()["user"]["onboarding"] == {"org_type": "STORE", "org_name": "Corner Market"}
    assert me.json()["onboarding"] == {"org_type": "STORE", "org_name": "Corner Market"}
    assert me.json()["memberships"] == []


async def test_account_created_by_google_has_no_intent(client: AsyncClient) -> None:
    signed_in = await google_login(client)

    assert signed_in.status_code == 200
    assert signed_in.json()["user"]["onboarding"] == {"org_type": None, "org_name": None}
