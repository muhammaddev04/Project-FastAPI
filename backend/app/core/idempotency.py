"""P00 §3.2 / FND-014 / GLOBAL §7.7 (API-004): `Idempotency-Key` for state-changing endpoints.

A protected endpoint declares the dependency and is served by `IdempotentRoute`:

    router = APIRouter(route_class=IdempotentRoute)

    @router.post("/things", status_code=201, dependencies=[idempotent()])
    async def create_thing(...): ...

Flow for one request, keyed by `scope = <user_id>:<METHOD>:<route_template>` and the client's UUID key:

1. The key is claimed as `IN_PROGRESS` in a separate, immediately committed transaction, so a parallel request with
   the same key sees it (and gets `409 request_in_progress`) instead of executing the operation a second time.
2. An existing record with a different `request_hash` (SHA-256 of the body) -> `409 idempotency_key_reused`; a
   `COMPLETED` one with the same hash -> the stored status + body are returned and the endpoint does not run.
3. After the endpoint has built a successful response, the record becomes `COMPLETED` (status + body) **in the
   request's own session** and that session is committed before the response is sent: the business change and the
   stored result commit or roll back together.
4. A failed attempt (any exception, or a response with status >= 400) rolls the request's transaction back and deletes
   its `IN_PROGRESS` claim, so the client can retry with the same key.

Records expire after 24 hours (7 days for offline sync); an expired record no longer binds its key, and
`purge_expired` deletes them (scheduled daily by the Celery part, FND-022).
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Annotated, Any
from uuid import UUID

import anyio
from fastapi import Depends, Header, Request, Response
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy import CHAR, CheckConstraint, DateTime, SmallInteger, String, UniqueConstraint, delete, select, update
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, CreatedAtMixin, IdMixin, get_sessionmaker
from app.core.errors import AppError
from app.core.time import new_id, utcnow
from app.modules.identity.deps import CurrentUser, SessionDep

logger = logging.getLogger("tezfarmo.idempotency")

#: GLOBAL §7.7 rule 5 / OPS-060.
DEFAULT_TTL = timedelta(hours=24)
OFFLINE_SYNC_TTL = timedelta(days=7)

_CLAIM_STATE = "idempotency_claim"


class IdempotencyRecord(IdMixin, CreatedAtMixin, Base):
    """P00 §3.2 `idempotency_records`: the claim and, once completed, the stored result of one keyed request.

    Only the SHA-256 of the request body is kept, never the body itself.
    """

    __tablename__ = "idempotency_records"
    __table_args__ = (
        UniqueConstraint("scope", "key"),
        CheckConstraint("status IN ('IN_PROGRESS','COMPLETED')", name="status"),
    )

    key: Mapped[UUID]
    scope: Mapped[str] = mapped_column(String(255))
    request_hash: Mapped[str] = mapped_column(CHAR(64))
    status: Mapped[str] = mapped_column(String(16))
    response_status: Mapped[int | None] = mapped_column(SmallInteger)
    response_body: Mapped[Any | None] = mapped_column(JSONB(none_as_null=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class IdempotentReplay(Exception):
    """Raised by the dependency for a completed key; `IdempotentRoute` answers with the stored result."""

    def __init__(self, status: int, body: Any | None) -> None:
        super().__init__(status)
        self.status = status
        self.body = body

    def response(self) -> Response:
        if self.body is None:
            return Response(status_code=self.status)
        return JSONResponse(self.body, status_code=self.status)


@dataclass(frozen=True)
class IdempotencyClaim:
    """The `IN_PROGRESS` record this request owns, and the request's session that will complete it."""

    record_id: UUID
    session: AsyncSession


def request_hash(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


async def claim(scope: str, key: UUID, body_hash: str, ttl: timedelta = DEFAULT_TTL) -> UUID:
    """Rules 2-4 of GLOBAL §7.7; returns the id of the `IN_PROGRESS` record now owned by the caller.

    Runs in its own transaction and commits at once. A new key is inserted; an expired record of the same key is taken
    over (new id, so the previous owner can no longer complete it). The unique (`scope`, `key`) index serializes
    concurrent claims: exactly one caller gets the record.
    """
    for _ in range(3):
        async with get_sessionmaker()() as session:
            now = utcnow()
            values = {
                "id": new_id(),
                "key": key,
                "scope": scope,
                "request_hash": body_hash,
                "status": "IN_PROGRESS",
                "response_status": None,
                "response_body": None,
                "created_at": now,
                "expires_at": now + ttl,
            }
            statement = insert(IdempotencyRecord).values(**values)
            returning_statement = statement.on_conflict_do_update(
                index_elements=[IdempotencyRecord.scope, IdempotencyRecord.key],
                set_={name: statement.excluded[name] for name in values if name not in ("key", "scope")},
                where=IdempotencyRecord.expires_at <= now,
            ).returning(IdempotencyRecord.id)
            record_id = (await session.execute(returning_statement)).scalar_one_or_none()
            if record_id is not None:
                await session.commit()
                return record_id
            existing = (
                await session.execute(
                    select(
                        IdempotencyRecord.request_hash,
                        IdempotencyRecord.status,
                        IdempotencyRecord.response_status,
                        IdempotencyRecord.response_body,
                    ).where(IdempotencyRecord.scope == scope, IdempotencyRecord.key == key)
                )
            ).one_or_none()
            await session.rollback()
        if existing is None:
            continue  # released by its owner between the two statements: claim again
        stored_hash, status, response_status, response_body = existing
        if stored_hash != body_hash:
            raise AppError("idempotency_key_reused", 409)
        if status == "IN_PROGRESS":
            raise AppError("request_in_progress", 409)
        raise IdempotentReplay(response_status or 200, response_body)
    raise AppError("request_in_progress", 409)


async def mark_completed(session: AsyncSession, record_id: UUID, status: int, body: Any | None) -> None:
    """Store the result in the caller's (business) transaction; it becomes visible only when that transaction commits.

    Fails if the record is no longer this request's `IN_PROGRESS` claim, which rolls the business change back.
    """
    result = await session.execute(
        update(IdempotencyRecord)
        .where(IdempotencyRecord.id == record_id, IdempotencyRecord.status == "IN_PROGRESS")
        .values(status="COMPLETED", response_status=status, response_body=body)
    )
    if result.rowcount != 1:  # type: ignore[attr-defined]
        raise RuntimeError("idempotency claim was lost before completion")


async def release(record_id: UUID) -> None:
    """Delete a failed attempt's `IN_PROGRESS` claim (own transaction) so the key can be used again."""
    async with get_sessionmaker()() as session:
        await session.execute(
            delete(IdempotencyRecord).where(
                IdempotencyRecord.id == record_id, IdempotencyRecord.status == "IN_PROGRESS"
            )
        )
        await session.commit()


async def purge_expired(session: AsyncSession, now: datetime | None = None) -> int:
    """P00 §3.2 cleanup (`expires_at < now()`) in the caller's transaction; returns the number of deleted records."""
    result = await session.execute(delete(IdempotencyRecord).where(IdempotencyRecord.expires_at < (now or utcnow())))
    deleted: int = result.rowcount  # type: ignore[attr-defined]
    return deleted


def idempotent(ttl: timedelta = DEFAULT_TTL, *, permission: str | None = None) -> Any:
    """FND-014 dependency: `Idempotency-Key` is required; the route must use `IdempotentRoute`."""

    async def dependency(
        request: Request,
        user: CurrentUser,
        session: SessionDep,
        idempotency_key: Annotated[UUID | None, Header(alias="Idempotency-Key")] = None,
    ) -> IdempotencyClaim:
        route = request.scope.get("route")
        if not isinstance(route, IdempotentRoute):
            raise RuntimeError("idempotent() requires a route served by IdempotentRoute")
        if idempotency_key is None:
            raise AppError("idempotency_key_required", 400)
        body = await request.body()
        if request.path_params:
            # A reused key must never replay a payment for a different subscription/resource.
            body = request.url.path.encode() + b"\n" + body
        if permission is not None:
            from app.modules.identity.deps import get_org_context

            context = await get_org_context(session, user, request.headers.get("X-Org-Id"))
            if permission not in context.permissions:
                raise AppError("permission_denied", 403)
            # Bind a key to its tenant as well as its payload; replay never bypasses current access checks.
            body = str(context.organization.id).encode() + b"\n" + body
        scope = f"{user.id}:{request.method}:{route.path}"
        record_id = await claim(scope, idempotency_key, request_hash(body), ttl)
        idempotency_claim = IdempotencyClaim(record_id=record_id, session=session)
        setattr(request.state, _CLAIM_STATE, idempotency_claim)
        return idempotency_claim

    return Depends(dependency)


async def _abandon(idempotency_claim: IdempotencyClaim) -> None:
    """Failed attempt: roll the business transaction back first, then free the key."""
    with anyio.CancelScope(shield=True):
        try:
            await idempotency_claim.session.rollback()
        finally:
            try:
                await release(idempotency_claim.record_id)
            except Exception:
                # The claim then stays IN_PROGRESS until it expires; the original error is what the client sees.
                logger.exception("could not release idempotency claim %s", idempotency_claim.record_id)


class IdempotentRoute(APIRoute):
    """Completes or releases the claim of an `idempotent()` endpoint around the built response (see module doc)."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def idempotent_handler(request: Request) -> Response:
            try:
                response = await handler(request)
            except IdempotentReplay as replay:
                return replay.response()
            except BaseException:
                pending = getattr(request.state, _CLAIM_STATE, None)
                if pending is not None:
                    await _abandon(pending)
                raise
            idempotency_claim: IdempotencyClaim | None = getattr(request.state, _CLAIM_STATE, None)
            if idempotency_claim is None:
                return response
            if response.status_code >= 400:
                await _abandon(idempotency_claim)
                return response
            try:
                body = json.loads(bytes(response.body)) if response.body else None
                await mark_completed(idempotency_claim.session, idempotency_claim.record_id, response.status_code, body)
                await idempotency_claim.session.commit()
            except BaseException:
                await _abandon(idempotency_claim)
                raise
            return response

        return idempotent_handler
