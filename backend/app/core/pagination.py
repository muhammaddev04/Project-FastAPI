"""FND-009 / API-002 (GLOBAL §7.5): limit/offset pagination with one envelope for every list endpoint.

    GET /things?limit=20&offset=0  ->  {"count": 134, "limit": 20, "offset": 0, "results": [...]}

`limit` is 1..100 (default 20) and `offset` >= 0; anything else is a `validation_error`. An offset past the end is not
an error: it returns an empty `results` with the real `count`. `count` comes from its own query over the same filters.

Every page is ordered by the requested columns **plus a unique tie-breaker** (the row id), so rows with equal sort
values keep one fixed order and never move between pages from one request to the next.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Annotated, Any, Self

from fastapi import Depends, Query
from pydantic import BaseModel
from sqlalchemy import Result, Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

DEFAULT_LIMIT = 20
MAX_LIMIT = 100


@dataclass(frozen=True)
class PageParams:
    """FND-009 `PageParams(limit, offset)`, validated as query parameters."""

    limit: int = DEFAULT_LIMIT
    offset: int = 0


def _page_params(
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT, description="Page size, 1..100.")] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0, description="Rows to skip.")] = 0,
) -> PageParams:
    return PageParams(limit=limit, offset=offset)


PageParamsDep = Annotated[PageParams, Depends(_page_params)]


class Page[T](BaseModel):
    """FND-009 `Page[T]`: the API-002 envelope."""

    count: int
    limit: int
    offset: int
    results: list[T]

    @classmethod
    def of(cls, params: PageParams, count: int, results: Sequence[Any]) -> Self:
        return cls(count=count, limit=params.limit, offset=params.offset, results=list(results))


async def fetch_page(
    session: AsyncSession,
    query: Select[Any],
    params: PageParams,
    *,
    order_by: Sequence[ColumnElement[Any]],
    tie_breaker: ColumnElement[Any],
) -> tuple[int, Result[Any]]:
    """Run `query` as one page: `(count, rows)`. `tie_breaker` must be a unique column (normally the primary key)."""
    count = (await session.execute(select(func.count()).select_from(query.order_by(None).subquery()))).scalar_one()
    rows = await session.execute(query.order_by(*order_by, tie_breaker).limit(params.limit).offset(params.offset))
    return count, rows
