"""P00 §3.2 / FND-014 / GLOBAL §7.7: `idempotency_records`, the `idempotent()` dependency and `IdempotentRoute`.

The protected operation of the probe endpoint is a real business mutation in the request's session (a `sequences`
counter), so "executed" and "committed" can be checked separately.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import idempotency
from app.core.db import get_sessionmaker
from app.core.errors import AppError, register_error_handlers
from app.core.idempotency import (
    DEFAULT_TTL,
    OFFLINE_SYNC_TTL,
    IdempotencyRecord,
    IdempotentReplay,
    IdempotentRoute,
    claim,
    idempotent,
    mark_completed,
    purge_expired,
    request_hash,
)
from app.core.request_context import RequestContextMiddleware
from app.core.sequences import NumberSequence, SequenceService
from app.core.time import utcnow
from app.modules.identity.deps import SessionDep
from app.modules.identity.models import User
from tests.factories import make_user, token_for

COUNTER = ("fnd014", "things")


@dataclass
class Probe:
    """Controls and observations of the probe endpoints for one test."""

    executions: int = 0
    fail: str | None = None
    delay: float = 0.0
    seen_during_execution: list[tuple[Any, ...]] = field(default_factory=list)


def _build_app(probe: Probe) -> FastAPI:
    router = APIRouter(route_class=IdempotentRoute)

    async def operation(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
        probe.executions += 1
        probe.seen_during_execution = await _records()
        if probe.delay:
            await asyncio.sleep(probe.delay)
        number = await SequenceService(session).next(*COUNTER)
        if probe.fail == "business":
            raise AppError("tax_identifier_taken", 409)
        if probe.fail == "crash":
            raise RuntimeError("boom")
        if probe.fail == "commit":
            session.add(NumberSequence(scope="x" * 65, key="too-long-scope", last_value=0))  # fails at commit
        return {"number": number, "echo": payload}

    @router.post("/things", status_code=201, dependencies=[idempotent()])
    async def create_thing(payload: dict[str, Any], session: SessionDep) -> Any:
        if probe.fail == "error_response":
            await SequenceService(session).next(*COUNTER)
            probe.executions += 1
            return JSONResponse({"error": {"code": "validation_error"}}, status_code=422)
        return await operation(session, payload)

    @router.put("/things", dependencies=[idempotent()])
    async def replace_thing(payload: dict[str, Any], session: SessionDep) -> dict[str, Any]:
        return await operation(session, payload)

    @router.post("/other", status_code=201, dependencies=[idempotent()])
    async def create_other(payload: dict[str, Any], session: SessionDep) -> dict[str, Any]:
        return await operation(session, payload)

    @router.post("/sync", status_code=201, dependencies=[idempotent(OFFLINE_SYNC_TTL)])
    async def sync(payload: dict[str, Any], session: SessionDep) -> dict[str, Any]:
        return await operation(session, payload)

    plain = APIRouter()

    @plain.post("/misconfigured", dependencies=[idempotent()])
    async def misconfigured(payload: dict[str, Any], session: SessionDep) -> dict[str, Any]:
        return await operation(session, payload)

    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)
    register_error_handlers(app)
    app.include_router(router)
    app.include_router(plain)
    return app


@pytest.fixture
def probe() -> Probe:
    return Probe()


@pytest.fixture
async def api(probe: Probe) -> AsyncIterator[AsyncClient]:
    # 5xx paths must come back as responses, the way a real server answers them.
    transport = ASGITransport(app=_build_app(probe), raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="https://testserver") as http:
        yield http


async def _user(session: AsyncSession) -> User:
    user = await make_user(session)
    await session.commit()
    return user


@pytest.fixture
async def user(session: AsyncSession) -> User:
    return await _user(session)


def _headers(user: User, key: UUID | str | None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token_for(user)}", "Content-Type": "application/json"}
    if key is not None:
        headers["Idempotency-Key"] = str(key)
    return headers


async def _send(
    api: AsyncClient,
    user: User,
    key: UUID | str | None,
    body: dict[str, Any],
    method: str = "POST",
    path: str = "/things",
) -> Response:
    return await api.request(method, path, content=json.dumps(body), headers=_headers(user, key))


async def _records() -> list[tuple[Any, ...]]:
    async with get_sessionmaker()() as db:
        rows = await db.execute(
            select(
                IdempotencyRecord.scope,
                IdempotencyRecord.key,
                IdempotencyRecord.status,
                IdempotencyRecord.request_hash,
                IdempotencyRecord.response_status,
                IdempotencyRecord.response_body,
            ).order_by(IdempotencyRecord.created_at)
        )
        return [tuple(row) for row in rows]


async def _counter() -> int | None:
    async with get_sessionmaker()() as db:
        return (
            await db.execute(
                select(NumberSequence.last_value).where(
                    NumberSequence.scope == COUNTER[0], NumberSequence.key == COUNTER[1]
                )
            )
        ).scalar_one_or_none()


def _hash(body: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(body).encode()).hexdigest()


# ---------------------------------------------------------------- claim and completion


async def test_fnd_014_first_request_is_claimed_in_progress_in_a_committed_transaction(
    api: AsyncClient, probe: Probe, user: User
) -> None:
    """The claim is visible to other transactions while the operation runs (so a parallel request can see it)."""
    key, body = uuid4(), {"name": "first"}
    await _send(api, user, key, body)
    assert probe.seen_during_execution == [(f"{user.id}:POST:/things", key, "IN_PROGRESS", _hash(body), None, None)]


async def test_fnd_014_success_becomes_completed_with_the_response(api: AsyncClient, probe: Probe, user: User) -> None:
    key, body = uuid4(), {"name": "first"}
    response = await _send(api, user, key, body)
    assert response.status_code == 201
    assert response.json() == {"number": 1, "echo": body}
    assert await _records() == [(f"{user.id}:POST:/things", key, "COMPLETED", _hash(body), 201, response.json())]
    assert await _counter() == 1


async def test_fnd_014_same_key_same_body_returns_cached(api: AsyncClient, probe: Probe, user: User) -> None:
    key, body = uuid4(), {"name": "first"}
    first = await _send(api, user, key, body)
    second = await _send(api, user, key, body)
    assert (
        (second.status_code, second.json()) == (first.status_code, first.json()) == (201, {"number": 1, "echo": body})
    )
    assert probe.executions == 1
    assert await _counter() == 1


async def test_fnd_014_same_key_different_body_409(api: AsyncClient, probe: Probe, user: User) -> None:
    key = uuid4()
    await _send(api, user, key, {"name": "first"})
    response = await _send(api, user, key, {"name": "second"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "idempotency_key_reused"
    assert probe.executions == 1
    assert await _counter() == 1


async def test_fnd_014_parallel_same_key_one_executes(api: AsyncClient, probe: Probe, user: User) -> None:
    """GLOBAL §14 concurrency: 10 parallel requests with one key -> one execution; the rest wait-free 409 or replay."""
    probe.delay = 0.3
    key, body = uuid4(), {"name": "parallel"}
    responses = await asyncio.gather(*(_send(api, user, key, body) for _ in range(10)))
    assert probe.executions == 1
    assert await _counter() == 1
    created = [r for r in responses if r.status_code == 201]
    in_progress = [r for r in responses if r.status_code == 409]
    assert len(created) + len(in_progress) == 10
    assert len(created) >= 1 and all(r.json() == {"number": 1, "echo": body} for r in created)
    assert in_progress and all(r.json()["error"]["code"] == "request_in_progress" for r in in_progress)


async def test_fnd_014_parallel_claims_of_one_key_have_one_owner() -> None:
    """The claim itself, in 20 separate sessions: exactly one caller owns the key."""
    key, body_hash = uuid4(), request_hash(b"{}")

    async def attempt() -> UUID | str:
        try:
            return await claim("user:POST:/things", key, body_hash)
        except AppError as error:
            return error.code

    results = await asyncio.gather(*(attempt() for _ in range(20)))
    owners = [r for r in results if isinstance(r, UUID)]
    assert len(owners) == 1
    assert sorted(set(results) - set(owners)) == ["request_in_progress"]


async def test_fnd_014_in_progress_key_returns_request_in_progress(api: AsyncClient, probe: Probe, user: User) -> None:
    key, body = uuid4(), {"name": "first"}
    await claim(f"{user.id}:POST:/things", key, _hash(body))
    response = await _send(api, user, key, body)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "request_in_progress"
    assert probe.executions == 0
    # the rejected request must not free the claim of the request that owns the key
    assert [row[2] for row in await _records()] == ["IN_PROGRESS"]
    # a different body with an in-progress key is still a reused key
    other = await _send(api, user, key, {"name": "other"})
    assert other.json()["error"]["code"] == "idempotency_key_reused"


# ---------------------------------------------------------------- failed attempts do not consume the key


@pytest.mark.parametrize(
    ("fail", "status", "code"),
    [("business", 409, "tax_identifier_taken"), ("crash", 500, "internal_error")],
    ids=["4xx_business_error", "5xx_error"],
)
async def test_fnd_014_failed_attempt_releases_the_key(
    api: AsyncClient, probe: Probe, user: User, fail: str, status: int, code: str
) -> None:
    key, body = uuid4(), {"name": "retry-me"}
    probe.fail = fail
    failed = await _send(api, user, key, body)
    assert failed.status_code == status
    assert failed.json()["error"]["code"] == code
    assert await _records() == []
    assert await _counter() is None  # the business change was rolled back

    probe.fail = None
    retried = await _send(api, user, key, body)
    assert retried.status_code == 201
    assert retried.json() == {"number": 1, "echo": body}
    assert probe.executions == 2
    assert [row[2] for row in await _records()] == ["COMPLETED"]


async def test_fnd_014_error_response_releases_the_key(api: AsyncClient, probe: Probe, user: User) -> None:
    """An endpoint that returns (instead of raises) a >= 400 response is a failed attempt too."""
    key, body = uuid4(), {"name": "retry-me"}
    probe.fail = "error_response"
    assert (await _send(api, user, key, body)).status_code == 422
    assert await _records() == []
    assert await _counter() is None

    probe.fail = None
    assert (await _send(api, user, key, body)).status_code == 201


async def test_fnd_014_commit_failure_leaves_no_false_completed_result(
    api: AsyncClient, probe: Probe, user: User
) -> None:
    """COMPLETED is written, then the business transaction fails at commit: both roll back, the key is free."""
    key, body = uuid4(), {"name": "commit-fails"}
    probe.fail = "commit"
    failed = await _send(api, user, key, body)
    assert failed.status_code == 500
    assert await _records() == []
    assert await _counter() is None

    probe.fail = None
    retried = await _send(api, user, key, body)
    assert (retried.status_code, retried.json()) == (201, {"number": 1, "echo": body})
    assert [row[2] for row in await _records()] == ["COMPLETED"]


async def test_fnd_014_route_commits_business_change_only_with_completed_result(
    api: AsyncClient, probe: Probe, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """IdempotentRoute path: the COMPLETED update runs, then completion fails before the commit. The business change
    must roll back with it, so it can never be committed before (or apart from) the stored result."""
    real_mark_completed = idempotency.mark_completed

    async def completed_then_failure(*args: Any) -> None:
        await real_mark_completed(*args)
        raise RuntimeError("failure after COMPLETED, before commit")

    key, body = uuid4(), {"name": "completion-fails"}
    monkeypatch.setattr(idempotency, "mark_completed", completed_then_failure)
    failed = await _send(api, user, key, body)
    assert failed.status_code == 500
    assert await _records() == []
    assert await _counter() is None

    monkeypatch.setattr(idempotency, "mark_completed", real_mark_completed)
    retried = await _send(api, user, key, body)
    assert (retried.status_code, retried.json()) == (201, {"number": 1, "echo": body})
    assert probe.executions == 2
    assert [row[2] for row in await _records()] == ["COMPLETED"]


async def test_fnd_014_business_change_and_completed_result_are_atomic(session: AsyncSession) -> None:
    record_id = await claim("user:POST:/things", uuid4(), request_hash(b"{}"))
    await SequenceService(session).next(*COUNTER)
    await mark_completed(session, record_id, 201, {"number": 1})
    # neither is visible before the business transaction commits
    assert [row[2] for row in await _records()] == ["IN_PROGRESS"]
    assert await _counter() is None
    await session.commit()
    assert [(row[2], row[4], row[5]) for row in await _records()] == [("COMPLETED", 201, {"number": 1})]
    assert await _counter() == 1


async def test_fnd_014_rollback_leaves_the_claim_in_progress(session: AsyncSession) -> None:
    record_id = await claim("user:POST:/things", uuid4(), request_hash(b"{}"))
    await SequenceService(session).next(*COUNTER)
    await mark_completed(session, record_id, 201, {"number": 1})
    await session.rollback()
    assert [(row[2], row[4], row[5]) for row in await _records()] == [("IN_PROGRESS", None, None)]
    assert await _counter() is None


async def test_fnd_014_lost_claim_cannot_be_completed(session: AsyncSession) -> None:
    """A claim taken over after it expired can no longer complete: the stale request's transaction must fail."""
    key = uuid4()
    stale = await claim("user:POST:/things", key, request_hash(b"{}"))
    await _expire_all()
    fresh = await claim("user:POST:/things", key, request_hash(b"{}"))
    assert fresh != stale
    with pytest.raises(RuntimeError, match="lost"):
        await mark_completed(session, stale, 201, {"number": 1})


# ---------------------------------------------------------------- header, auth and wiring


async def test_fnd_014_missing_key_400(api: AsyncClient, probe: Probe, user: User) -> None:
    response = await _send(api, user, None, {"name": "x"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "idempotency_key_required"
    assert probe.executions == 0
    assert await _records() == []


async def test_fnd_014_malformed_key_is_a_validation_error(api: AsyncClient, probe: Probe, user: User) -> None:
    response = await _send(api, user, "not-a-uuid", {"name": "x"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert response.json()["error"]["details"]["fields"][0]["field"] == "Idempotency-Key"
    assert probe.executions == 0


async def test_fnd_014_unauthenticated_request_claims_nothing(api: AsyncClient, probe: Probe) -> None:
    response = await api.post("/things", json={"name": "x"}, headers={"Idempotency-Key": str(uuid4())})
    assert response.status_code == 401
    assert probe.executions == 0
    assert await _records() == []


async def test_fnd_014_requires_idempotent_route(api: AsyncClient, probe: Probe, user: User) -> None:
    response = await _send(api, user, uuid4(), {"name": "x"}, path="/misconfigured")
    assert response.status_code == 500
    assert probe.executions == 0
    assert await _records() == []


# ---------------------------------------------------------------- scope isolation


async def test_fnd_014_scope_is_user_method_and_route(
    api: AsyncClient, probe: Probe, user: User, session: AsyncSession
) -> None:
    other_user = await _user(session)
    key, body = uuid4(), {"name": "same"}
    responses = [
        await _send(api, user, key, body),
        await _send(api, other_user, key, body),
        await _send(api, user, key, body, method="PUT"),
        await _send(api, user, key, body, path="/other"),
    ]
    assert [r.status_code for r in responses] == [201, 201, 200, 201]
    assert probe.executions == 4
    assert sorted(row[0] for row in await _records()) == sorted(
        [
            f"{user.id}:POST:/things",
            f"{other_user.id}:POST:/things",
            f"{user.id}:PUT:/things",
            f"{user.id}:POST:/other",
        ]
    )


async def test_fnd_014_another_user_never_gets_a_stored_result(
    api: AsyncClient, probe: Probe, user: User, session: AsyncSession
) -> None:
    key, body = uuid4(), {"name": "private"}
    await _send(api, user, key, body)
    other = await _send(api, await _user(session), key, body)
    assert other.json()["number"] == 2  # executed for the other user, not replayed
    assert probe.executions == 2


# ---------------------------------------------------------------- expiry, cleanup and storage


async def _expire_all() -> None:
    async with get_sessionmaker()() as db:
        await db.execute(update(IdempotencyRecord).values(expires_at=utcnow() - timedelta(seconds=1)))
        await db.commit()


async def _lifetimes() -> list[timedelta]:
    async with get_sessionmaker()() as db:
        rows = await db.execute(select(IdempotencyRecord.created_at, IdempotencyRecord.expires_at))
        return [expires_at - created_at for created_at, expires_at in rows]


async def test_fnd_014_ttl_is_24_hours_and_7_days_for_offline_sync(api: AsyncClient, user: User) -> None:
    await _send(api, user, uuid4(), {"name": "x"})
    assert await _lifetimes() == [DEFAULT_TTL] == [timedelta(hours=24)]
    await _expire_all()
    async with get_sessionmaker()() as db:
        await purge_expired(db)
        await db.commit()
    await _send(api, user, uuid4(), {"name": "x"}, path="/sync")
    assert await _lifetimes() == [OFFLINE_SYNC_TTL] == [timedelta(days=7)]


async def test_fnd_014_expired_key_no_longer_binds(api: AsyncClient, probe: Probe, user: User) -> None:
    key = uuid4()
    await _send(api, user, key, {"name": "first"})
    await _expire_all()
    response = await _send(api, user, key, {"name": "after-expiry"})
    assert (response.status_code, response.json()["number"]) == (201, 2)
    assert probe.executions == 2
    assert [(row[2], row[5]["echo"]) for row in await _records()] == [("COMPLETED", {"name": "after-expiry"})]


async def test_fnd_014_cleanup_removes_only_expired_records(session: AsyncSession) -> None:
    now = utcnow()
    for label, expires_at in (("expired", now - timedelta(seconds=1)), ("live", now + timedelta(hours=1))):
        for status in ("IN_PROGRESS", "COMPLETED"):
            session.add(
                IdempotencyRecord(
                    key=uuid4(),
                    scope=f"{label}:{status}",
                    request_hash="0" * 64,
                    status=status,
                    created_at=now - timedelta(hours=24),
                    expires_at=expires_at,
                )
            )
    session.add(
        IdempotencyRecord(
            key=uuid4(), scope="boundary", request_hash="0" * 64, status="COMPLETED", created_at=now, expires_at=now
        )
    )
    await session.commit()
    assert await purge_expired(session, now) == 2
    await session.commit()
    assert sorted(row[0] for row in await _records()) == ["boundary", "live:COMPLETED", "live:IN_PROGRESS"]


async def test_fnd_014_request_body_is_stored_only_as_its_hash(api: AsyncClient, user: User) -> None:
    body = {"name": "x", "password": "Secret-Value-123"}
    await _send(api, user, uuid4(), body)
    async with get_sessionmaker()() as db:
        stored = (
            await db.execute(text("SELECT row_to_json(r)::text, r.request_hash FROM idempotency_records r"))
        ).one()
    assert stored[1] == _hash(body)
    # the response of the probe echoes the body, so only the non-response columns are checked
    assert "Secret-Value-123" not in json.dumps(
        {k: v for k, v in json.loads(stored[0]).items() if k != "response_body"}
    )


def test_fnd_014_replay_of_an_empty_body_has_no_content() -> None:
    assert IdempotentReplay(204, None).response().body == b""
    assert json.loads(IdempotentReplay(201, {"a": 1}).response().body) == {"a": 1}


# ---------------------------------------------------------------- migration / model


async def test_idempotency_records_table_matches_p00_data_model(session: AsyncSession) -> None:
    columns = (
        await session.execute(
            text(
                "SELECT column_name, data_type, character_maximum_length, is_nullable "
                "FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'idempotency_records' "
                "ORDER BY ordinal_position"
            )
        )
    ).all()
    assert [tuple(c) for c in columns] == [
        ("id", "uuid", None, "NO"),
        ("key", "uuid", None, "NO"),
        ("scope", "character varying", 255, "NO"),
        ("request_hash", "character", 64, "NO"),
        ("status", "character varying", 16, "NO"),
        ("response_status", "smallint", None, "YES"),
        ("response_body", "jsonb", None, "YES"),
        ("created_at", "timestamp with time zone", None, "NO"),
        ("expires_at", "timestamp with time zone", None, "NO"),
    ]
    constraints = dict(
        (
            await session.execute(
                text(
                    "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint "
                    "WHERE conrelid = 'idempotency_records'::regclass"
                )
            )
        ).all()
    )
    assert constraints == {
        "pk_idempotency_records": "PRIMARY KEY (id)",
        "uq_idempotency_records_scope_key": "UNIQUE (scope, key)",
        "ck_idempotency_records_status": (
            "CHECK (((status)::text = ANY ((ARRAY['IN_PROGRESS'::character varying, "
            "'COMPLETED'::character varying])::text[])))"
        ),
    }
    index = (
        await session.execute(
            text("SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_idempotency_records_expires_at'")
        )
    ).scalar_one()
    assert index.endswith("USING btree (expires_at)")


async def test_idempotency_status_check_rejects_unknown_values(session: AsyncSession) -> None:
    from sqlalchemy.exc import IntegrityError

    session.add(
        IdempotencyRecord(
            key=uuid4(), scope="s", request_hash="0" * 64, status="FAILED", expires_at=utcnow() + DEFAULT_TTL
        )
    )
    with pytest.raises(IntegrityError, match="ck_idempotency_records_status"):
        await session.commit()
