"""FIN-002: generated real PostgreSQL postings, checked after each operation."""

from decimal import Decimal

from httpx import AsyncClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_sessionmaker
from app.modules.finance.service import finance_service as finance
from tests.test_finance_service import invariant, prepared


@settings(max_examples=200, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    operations=st.lists(
        st.tuples(
            st.sampled_from(["DEBIT", "CREDIT", "PAYMENT", "CANCEL", "REJECT", "REFUND"]),
            st.integers(min_value=1, max_value=100000),
        ),
        min_size=1,
        max_size=12,
    )
)
async def test_fin_002_invariant_after_random_operations(
    client: AsyncClient, session: AsyncSession, operations: list[tuple[str, int]]
):
    ctx, _, pid = await prepared(client, session)
    expected = Decimal("0")
    for kind, cents in operations:
        amount = Decimal(cents) / 100
        if kind in {"DEBIT", "CREDIT"}:
            await finance.create_adjustment(session, ctx, pid, kind, amount, "Generated invariant scenario")
            expected += amount if kind == "DEBIT" else -amount
        elif kind == "REFUND":
            summary = await finance.balance(session, pid)
            if summary.unapplied:
                refund = min(amount, summary.unapplied)
                await finance.create_adjustment(session, ctx, pid, "REFUND", refund, "Generated unused credit refund")
                expected += refund
        else:
            payment = await finance.record_payment(session, ctx, pid, amount, "CASH")
            if kind == "PAYMENT":
                await finance.confirm_payment(session, ctx, payment.id, payment.version)
                expected -= amount
            elif kind == "CANCEL":
                await finance.cancel_payment(session, ctx, payment.id, payment.version)
            else:
                await finance.reject_payment(session, ctx, payment.id, "Generated rejection", payment.version)
        await session.commit()
        async with get_sessionmaker()() as reader:
            await invariant(reader, pid, expected)
