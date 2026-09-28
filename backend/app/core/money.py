"""FND-006: money and quantity (GLOBAL §5 / §7.1, DEC-01).

Money is `NUMERIC(12,2)` / `Decimal` rounded `ROUND_HALF_UP` to 2 places; quantity is `NUMERIC(14,3)` to 3 places.
Float is never used. In JSON both are strings (`"1250.00"`, `"12.500"`), never numbers - also on input.
"""

from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any

from pydantic import BeforeValidator, PlainSerializer, WithJsonSchema
from pydantic_core import PydanticCustomError

Money = Decimal
Quantity = Decimal

_CENT = Decimal("0.01")
_MILLI = Decimal("0.001")

#: Largest values the columns can hold: NUMERIC(12,2) and NUMERIC(14,3).
MONEY_MAX = Decimal("9999999999.99")
QUANTITY_MAX = Decimal("99999999999.999")


def q2(value: Decimal | int | str) -> Money:
    """Money: quantize to 0.01, ROUND_HALF_UP."""
    return Decimal(value).quantize(_CENT, rounding=ROUND_HALF_UP)


def q3(value: Decimal | int | str) -> Quantity:
    """Quantity: quantize to 0.001, ROUND_HALF_UP."""
    return Decimal(value).quantize(_MILLI, rounding=ROUND_HALF_UP)


def _parser(places: int, maximum: Decimal, code: str) -> Any:
    pattern = re.compile(rf"(0|[1-9][0-9]*)(\.[0-9]{{1,{places}}})?")

    def invalid() -> PydanticCustomError:
        return PydanticCustomError(
            code, "must be a non-negative decimal string with at most {places} decimals", {"places": places}
        )

    def parse(value: object) -> Decimal:
        if isinstance(value, Decimal):  # server-side values, e.g. NUMERIC columns read into a response model
            if not value.is_finite() or value < 0 or -int(value.as_tuple().exponent) > places:
                raise invalid()
            amount = value
        elif isinstance(value, str) and pattern.fullmatch(value):
            amount = Decimal(value)
        else:
            # A JSON number is refused on purpose: it may already have lost precision as a float (FE-009).
            raise invalid()
        if amount > maximum:
            raise PydanticCustomError("value_too_large", "must be at most {maximum}", {"maximum": str(maximum)})
        return amount

    return parse


#: Pydantic type: accepts `"1250"`, `"1250.5"`, `"1250.50"`; returns `Decimal`; serializes as `"1250.50"`.
MoneyStr = Annotated[
    Decimal,
    BeforeValidator(_parser(2, MONEY_MAX, "invalid_money")),
    PlainSerializer(lambda value: str(q2(value)), return_type=str),
    WithJsonSchema({"type": "string", "pattern": r"^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$", "examples": ["1250.00"]}),
]

#: Pydantic type: accepts up to 3 decimals; returns `Decimal`; serializes as `"12.500"`.
QuantityStr = Annotated[
    Decimal,
    BeforeValidator(_parser(3, QUANTITY_MAX, "invalid_quantity")),
    PlainSerializer(lambda value: str(q3(value)), return_type=str),
    WithJsonSchema({"type": "string", "pattern": r"^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$", "examples": ["12.500"]}),
]
