"""FND-011 / API-003 (GLOBAL §7.6): one query model per list endpoint - filters, search, ordering and the FND-009 page.

A list endpoint declares a `ListQuery` subclass with exactly the fields its part lists, and maps them to columns:

    class MemberQuery(ListQuery):
        role: Literal["OWNER", ...] | None = None
        search: str | None = Field(None, max_length=100)
        filter_columns = {"role": Membership.role}
        search_columns = (User.full_name, User.phone)
        fixed_ordering = (Membership.joined_at,)

    async def endpoint(query: Annotated[MemberQuery, Query()]): ...
    count, rows = await query.fetch(session, select(...), tie_breaker=Membership.id)

Rules:
- Only the declared fields are accepted: any other query parameter is a `validation_error` (`extra_forbidden`), and so
  is a value outside a field's type (e.g. an empty or unknown enum value).
- Filters combine with AND and compare for equality; a filter that is not given is not applied.
- `search` is trimmed, blank means no search, and it matches any of `search_columns` with `ILIKE '%text%'` (OR);
  `%`, `_` and `\\` are matched literally. The columns carry `pg_trgm` GIN indexes.
- `ordering` (when the endpoint has one) is `name` or `-name` from `ordering_columns`; otherwise `fixed_ordering`.
  The FND-009 unique tie-breaker is always appended, so pages stay stable.

Client input only ever selects entries of these server-side whitelists; it never becomes a column name or SQL.
"""

from __future__ import annotations

import typing
from collections.abc import Mapping, Sequence
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Result, Select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql.elements import ColumnElement

from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT, PageParams, fetch_page

_LIKE_ESCAPE = "\\"
QueryColumn = ColumnElement[Any] | InstrumentedAttribute[Any]


def _literal_pattern(text: str) -> str:
    escaped = text.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2).replace("%", r"\%").replace("_", r"\_")
    return f"%{escaped}%"


class ListQuery(BaseModel):
    """FND-011 base class: `limit`/`offset` (FND-009) plus the subclass's whitelisted filters, search and ordering."""

    model_config = ConfigDict(extra="forbid")

    limit: int = Field(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT, description="Page size, 1..100.")
    offset: int = Field(0, ge=0, description="Rows to skip.")

    #: query field -> column compared for equality.
    filter_columns: ClassVar[Mapping[str, QueryColumn]] = {}
    #: columns matched by `search` (requires a `search` field).
    search_columns: ClassVar[Sequence[QueryColumn]] = ()
    #: ordering name -> column (requires an `ordering` field whose values are exactly `name` and `-name`).
    ordering_columns: ClassVar[Mapping[str, QueryColumn]] = {}
    #: the order of an endpoint without an `ordering` parameter.
    fixed_ordering: ClassVar[Sequence[QueryColumn]] = ()

    @classmethod
    def __pydantic_init_subclass__(cls, **kwargs: Any) -> None:
        """Refuse a subclass whose whitelists and fields disagree (checked once, at import)."""
        super().__pydantic_init_subclass__(**kwargs)
        fields = cls.model_fields
        unknown = set(cls.filter_columns) - set(fields)
        if unknown:
            raise TypeError(f"{cls.__name__}: filter_columns without a field: {sorted(unknown)}")
        if bool(cls.search_columns) != ("search" in fields):
            raise TypeError(f"{cls.__name__}: a `search` field and search_columns go together")
        if cls.ordering_columns or "ordering" in fields:
            if "ordering" not in fields or not cls.ordering_columns:
                raise TypeError(f"{cls.__name__}: an `ordering` field and ordering_columns go together")
            allowed = set(typing.get_args(fields["ordering"].annotation))
            expected = {name for key in cls.ordering_columns for name in (key, f"-{key}")}
            if allowed != expected:
                raise TypeError(f"{cls.__name__}: ordering values {sorted(allowed)} != {sorted(expected)}")

    @property
    def page(self) -> PageParams:
        return PageParams(limit=self.limit, offset=self.offset)

    def apply(self, query: Select[Any]) -> Select[Any]:
        """Filters (AND, equality) and search (OR over search_columns, literal ILIKE)."""
        for name, column in self.filter_columns.items():
            value = getattr(self, name)
            if value is not None:
                query = query.where(column == value)
        text = (getattr(self, "search", None) or "").strip()
        if self.search_columns and text:
            pattern = _literal_pattern(text)
            query = query.where(or_(*(column.ilike(pattern, escape=_LIKE_ESCAPE) for column in self.search_columns)))
        return query

    def order_by(self) -> list[QueryColumn]:
        ordering: str | None = getattr(self, "ordering", None)
        if not ordering:
            return list(self.fixed_ordering)
        column = self.ordering_columns[ordering.removeprefix("-")]
        return [column.desc() if ordering.startswith("-") else column.asc()]

    async def fetch(
        self, session: AsyncSession, query: Select[Any], *, tie_breaker: QueryColumn
    ) -> tuple[int, Result[Any]]:
        """Filter, order and page `query` through FND-009 `fetch_page` (count + stable page)."""
        filtered = self.apply(query)
        return await fetch_page(session, filtered, self.page, order_by=self.order_by(), tie_breaker=tie_breaker)
