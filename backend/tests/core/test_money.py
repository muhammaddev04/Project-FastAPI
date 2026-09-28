"""FND-006 / GLOBAL §5, §7.1: `q2`/`q3` rounding and the `MoneyStr`/`QuantityStr` JSON contract."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel, ValidationError

from app.core.errors import register_error_handlers
from app.core.money import MONEY_MAX, QUANTITY_MAX, MoneyStr, QuantityStr, q2, q3
from app.core.request_context import RequestContextMiddleware


class Line(BaseModel):
    price: MoneyStr
    quantity: QuantityStr


def test_fnd_006_money_rounding_half_up() -> None:
    assert q2("2.345") == Decimal("2.35")
    assert q2("2.344") == Decimal("2.34")
    assert q2("0.005") == Decimal("0.01")
    assert q2("-2.345") == Decimal("-2.35")  # half away from zero, not banker's rounding
    assert q2("2.5") == Decimal("2.50")
    assert q2(Decimal("10.125")) == Decimal("10.13")  # ROUND_HALF_EVEN would give 10.12
    assert q2(7) == Decimal("7.00")


def test_fnd_006_quantity_rounding_half_up() -> None:
    assert q3("1.0005") == Decimal("1.001")
    assert q3("1.0004") == Decimal("1.000")
    assert q3(Decimal("12.5")) == Decimal("12.500")
    # DEC-03 / INV-001 style use: qty_base = q3(qty × coefficient)
    assert q3(Decimal("3.333") * Decimal("1.5")) == Decimal("5.000")


def test_fnd_006_money_and_quantity_are_strings_in_json() -> None:
    line = Line.model_validate({"price": "1250", "quantity": "12.5"})
    assert line.price == Decimal("1250") and isinstance(line.price, Decimal)
    assert line.model_dump(mode="json") == {"price": "1250.00", "quantity": "12.500"}
    assert line.model_dump_json() == '{"price":"1250.00","quantity":"12.500"}'


def test_fnd_006_server_side_decimals_are_accepted() -> None:
    """Response models are filled from NUMERIC columns, which arrive as Decimal."""
    line = Line.model_validate({"price": Decimal("0.50"), "quantity": Decimal("3")})
    assert line.model_dump(mode="json") == {"price": "0.50", "quantity": "3.000"}


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("price", 1250, "invalid_money"),  # JSON numbers are never money
        ("price", 12.5, "invalid_money"),
        ("price", True, "invalid_money"),
        ("price", None, "invalid_money"),
        ("price", "-1.00", "invalid_money"),  # >= 0
        ("price", "1.005", "invalid_money"),  # at most 2 decimals
        ("price", "1e3", "invalid_money"),
        ("price", "1,50", "invalid_money"),
        ("price", " 1.00", "invalid_money"),
        ("price", "01.00", "invalid_money"),
        ("price", "1.", "invalid_money"),
        ("price", "NaN", "invalid_money"),
        ("price", Decimal("1.005"), "invalid_money"),
        ("price", Decimal("-1"), "invalid_money"),
        ("price", str(MONEY_MAX + Decimal("0.01")), "value_too_large"),  # NUMERIC(12,2)
        ("quantity", 3, "invalid_quantity"),
        ("quantity", "-0.001", "invalid_quantity"),
        ("quantity", "1.0005", "invalid_quantity"),  # at most 3 decimals
        ("quantity", str(QUANTITY_MAX + Decimal("0.001")), "value_too_large"),  # NUMERIC(14,3)
    ],
    ids=lambda value: repr(value)[:30],
)
def test_fnd_006_invalid_values_are_rejected(field: str, value: Any, code: str) -> None:
    payload: dict[str, Any] = {"price": "1.00", "quantity": "1"}
    payload[field] = value
    with pytest.raises(ValidationError) as error:
        Line.model_validate(payload)
    assert [issue["type"] for issue in error.value.errors()] == [code]


def test_fnd_006_boundaries_are_accepted() -> None:
    line = Line.model_validate({"price": str(MONEY_MAX), "quantity": str(QUANTITY_MAX)})
    assert line.model_dump(mode="json") == {"price": "9999999999.99", "quantity": "99999999999.999"}
    zero = Line.model_validate({"price": "0", "quantity": "0.000"})
    assert zero.model_dump(mode="json") == {"price": "0.00", "quantity": "0.000"}


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)
    register_error_handlers(app)

    @app.post("/lines")
    async def echo(line: Line) -> Line:
        return line

    return app


async def test_fnd_006_api_contract_and_validation_error_envelope() -> None:
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="https://testserver") as http:
        ok = await http.post("/lines", json={"price": "1250.5", "quantity": "2"})
        assert (ok.status_code, ok.json()) == (200, {"price": "1250.50", "quantity": "2.000"})

        bad = await http.post("/lines", json={"price": 1250.5, "quantity": "2"}, headers={"Accept-Language": "en"})
        assert bad.status_code == 422
        error = bad.json()["error"]
        assert error["code"] == "validation_error"
        assert error["details"]["fields"] == [
            {
                "field": "price",
                "code": "invalid_money",
                "message": "Enter an amount such as 1250.00 (not negative, at most 2 decimals).",
            }
        ]


def test_fnd_006_openapi_declares_strings() -> None:
    schema = _app().openapi()["components"]["schemas"]["Line"]["properties"]
    assert schema["price"]["type"] == "string"
    assert schema["quantity"]["type"] == "string"
