"""Exercise the P10 database protections on migrated PostgreSQL, including direct SQL."""

from dataclasses import dataclass
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.modules.catalog.models import Product, ProductUnit
from app.modules.identity.models import User
from app.modules.orders.models import Order, OrderItem
from app.modules.organizations.models import Company, Store
from app.modules.partnerships.models import Partnership
from app.modules.returns.models import Dispute, DisputeMessage, Return, ReturnItem, ReturnStatusHistory
from tests.factories import make_org, make_user


@dataclass
class Fixture:
    user: User
    company: Company
    store: Store
    partnership: Partnership
    order: Order
    order_item: OrderItem
    returned: Return
    return_item: ReturnItem
    dispute: Dispute


async def records(session: AsyncSession) -> Fixture:
    user = await make_user(session)
    company = await make_org(session, user)
    store = await make_org(session, user, "STORE")
    partnership = Partnership(
        company_id=company.id, store_id=store.id, initiated_by=user.id, initiated_by_side="COMPANY"
    )
    product = Product(company_id=company.id, sku="SKU-1", name="Sugar", base_unit="KG", created_by=user.id)
    session.add_all([partnership, product])
    await session.flush()
    unit = ProductUnit(
        product_id=product.id, code="box", name={"tg": "Қуттӣ"}, coefficient=Decimal("12.000"), allow_fraction=False
    )
    order = Order(
        company_id=company.id,
        store_id=store.id,
        partnership_id=partnership.id,
        order_number="ORD-2026-000001",
        source="STORE",
        status="DELIVERED",
        requested_subtotal=Decimal("1000.00"),
        subtotal=Decimal("1000.00"),
        discount=Decimal("100.00"),
        discount_reason="Promotion",
        total=Decimal("900.00"),
        delivery_address="Dushanbe, Rudaki 1",
        created_by=user.id,
        delivered_at=utcnow(),
    )
    session.add_all([unit, order])
    await session.flush()
    item = OrderItem(
        order_id=order.id,
        product_id=product.id,
        product_unit_id=unit.id,
        product_name_snapshot="Sugar",
        sku_snapshot="SKU-1",
        unit_code_snapshot="box",
        unit_name_snapshot={"tg": "Қуттӣ"},
        unit_coefficient_snapshot=Decimal("12.000"),
        allow_fraction_snapshot=False,
        base_unit_snapshot="KG",
        requested_quantity=Decimal("4.000"),
        confirmed_quantity=Decimal("4.000"),
        unit_price=Decimal("250.00"),
        line_total=Decimal("1000.00"),
    )
    returned = Return(
        return_number="RET-2026-000001",
        company_id=company.id,
        store_id=store.id,
        partnership_id=partnership.id,
        order_id=order.id,
        status="REQUESTED",
        reason_code="DAMAGED",
        requested_by=user.id,
        requested_at=utcnow(),
    )
    dispute = Dispute(
        dispute_number="DSP-2026-000001",
        company_id=company.id,
        store_id=store.id,
        partnership_id=partnership.id,
        target_type="ORDER",
        order_id=order.id,
        type="QUANTITY",
        description="Two boxes arrived damaged",
        opened_by=user.id,
    )
    session.add_all([item, returned, dispute])
    await session.flush()
    return_item = ReturnItem(return_id=returned.id, order_item_id=item.id, requested_quantity=Decimal("2.000"))
    session.add(return_item)
    await session.commit()
    return Fixture(user, company, store, partnership, order, item, returned, return_item, dispute)


@pytest.mark.parametrize("table", ["return_status_history", "dispute_messages"])
@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
async def test_return_and_dispute_history_is_append_only(session: AsyncSession, table: str, operation: str):
    rows = await records(session)
    if table == "return_status_history":
        row = ReturnStatusHistory(
            return_id=rows.returned.id, to_status="REQUESTED", actor_id=rows.user.id, actor_type="USER"
        )
    else:
        row = DisputeMessage(
            dispute_id=rows.dispute.id, author_id=rows.user.id, author_side="STORE", body="Photos attached"
        )
    session.add(row)
    await session.commit()
    query = (
        f"UPDATE {table} SET created_at = now() WHERE id = :id"
        if operation == "UPDATE"
        else f"DELETE FROM {table} WHERE id = :id"
    )
    with pytest.raises(DBAPIError, match="append-only table"):
        async with session.begin_nested():
            await session.execute(text(query), {"id": row.id})


async def test_return_identity_is_immutable(session: AsyncSession):
    rows = await records(session)
    with pytest.raises(DBAPIError, match="return identity is immutable"):
        async with session.begin_nested():
            await session.execute(
                text("UPDATE returns SET reason_code = 'QUALITY' WHERE id = :id"), {"id": rows.returned.id}
            )
    # The state machine itself is allowed to move the return forward.
    await session.execute(
        text("UPDATE returns SET status = 'APPROVED', approved_at = now() WHERE id = :id"), {"id": rows.returned.id}
    )


async def test_finished_return_cannot_be_rewritten(session: AsyncSession):
    rows = await records(session)
    await session.execute(
        text("UPDATE returns SET status = 'CANCELLED', cancel_reason = 'Store changed its mind' WHERE id = :id"),
        {"id": rows.returned.id},
    )
    with pytest.raises(DBAPIError, match="a finished return is immutable"):
        async with session.begin_nested():
            await session.execute(
                text("UPDATE returns SET status = 'APPROVED' WHERE id = :id"), {"id": rows.returned.id}
            )
    with pytest.raises(DBAPIError, match="returns cannot be deleted"):
        async with session.begin_nested():
            await session.execute(text("DELETE FROM returns WHERE id = :id"), {"id": rows.returned.id})


async def test_return_quantities_are_decided_once(session: AsyncSession):
    rows = await records(session)
    await session.execute(
        text("UPDATE return_items SET approved_quantity = 2.000 WHERE id = :id"), {"id": rows.return_item.id}
    )
    with pytest.raises(DBAPIError, match="return quantities are decided once"):
        async with session.begin_nested():
            await session.execute(
                text("UPDATE return_items SET approved_quantity = 1.000 WHERE id = :id"), {"id": rows.return_item.id}
            )
    with pytest.raises(DBAPIError, match="return item identity is immutable"):
        async with session.begin_nested():
            await session.execute(
                text("UPDATE return_items SET requested_quantity = 4.000 WHERE id = :id"), {"id": rows.return_item.id}
            )


@pytest.mark.parametrize(
    "column,value,constraint",
    [
        ("approved_quantity", "3.000", "ck_return_items_approved_range"),
        ("received_quantity", "1.000", "ck_return_items_received_range"),
        ("accepted_quantity", "1.000", "ck_return_items_accepted_range"),
        ("restock_quantity", "1.000", "ck_return_items_restock_range"),
    ],
)
async def test_quantity_ladder_is_enforced_by_the_database(
    session: AsyncSession, column: str, value: str, constraint: str
):
    rows = await records(session)
    # Each step needs the step before it: a received quantity without an approved one, and
    # never more than its own source (approved 3.000 exceeds the requested 2.000).
    with pytest.raises(DBAPIError, match=constraint):
        async with session.begin_nested():
            await session.execute(
                text(f"UPDATE return_items SET {column} = {value} WHERE id = :id"), {"id": rows.return_item.id}
            )


async def test_ret_004_one_open_return_per_order(session: AsyncSession):
    rows = await records(session)
    with pytest.raises(IntegrityError, match="uq_returns_open_order"):
        async with session.begin_nested():
            session.add(
                Return(
                    return_number="RET-2026-000002",
                    company_id=rows.company.id,
                    store_id=rows.store.id,
                    partnership_id=rows.partnership.id,
                    order_id=rows.order.id,
                    status="REQUESTED",
                    reason_code="QUALITY",
                    requested_by=rows.user.id,
                )
            )
            await session.flush()
    # A closed return frees the order for another attempt.
    await session.execute(
        text("UPDATE returns SET status = 'REJECTED', rejection_reason = 'Outside policy' WHERE id = :id"),
        {"id": rows.returned.id},
    )
    session.add(
        Return(
            return_number="RET-2026-000003",
            company_id=rows.company.id,
            store_id=rows.store.id,
            partnership_id=rows.partnership.id,
            order_id=rows.order.id,
            status="REQUESTED",
            reason_code="QUALITY",
            requested_by=rows.user.id,
        )
    )
    await session.flush()


async def test_dsp_003_one_open_dispute_per_order(session: AsyncSession):
    rows = await records(session)
    with pytest.raises(IntegrityError, match="uq_disputes_open_order"):
        async with session.begin_nested():
            session.add(
                Dispute(
                    dispute_number="DSP-2026-000002",
                    company_id=rows.company.id,
                    store_id=rows.store.id,
                    partnership_id=rows.partnership.id,
                    target_type="ORDER",
                    order_id=rows.order.id,
                    type="PRICE",
                    description="The price does not match the agreed terms",
                    opened_by=rows.user.id,
                )
            )
            await session.flush()


async def test_closed_dispute_is_immutable(session: AsyncSession):
    rows = await records(session)
    await session.execute(
        text(
            "UPDATE disputes SET status = 'RESOLVED', resolution_type = 'NO_ACTION', "
            "resolution_note = 'Checked with the courier', resolved_at = now() WHERE id = :id"
        ),
        {"id": rows.dispute.id},
    )
    with pytest.raises(DBAPIError, match="a closed dispute is immutable"):
        async with session.begin_nested():
            await session.execute(
                text("UPDATE disputes SET status = 'OPEN', resolved_at = NULL WHERE id = :id"), {"id": rows.dispute.id}
            )
    with pytest.raises(DBAPIError, match="disputes cannot be deleted"):
        async with session.begin_nested():
            await session.execute(text("DELETE FROM disputes WHERE id = :id"), {"id": rows.dispute.id})


async def test_dispute_identity_is_immutable(session: AsyncSession):
    rows = await records(session)
    with pytest.raises(DBAPIError, match="dispute identity is immutable"):
        async with session.begin_nested():
            await session.execute(
                text("UPDATE disputes SET description = 'A different complaint entirely' WHERE id = :id"),
                {"id": rows.dispute.id},
            )
    # A review may still start and record its outcome fields.
    await session.execute(text("UPDATE disputes SET status = 'UNDER_REVIEW' WHERE id = :id"), {"id": rows.dispute.id})


@pytest.mark.parametrize("table", ["returns", "disputes"])
async def test_p10_records_belong_to_their_partnership(session: AsyncSession, table: str):
    rows = await records(session)
    other_user = await make_user(session, email="other@example.com")
    other_company = await make_org(session, other_user)
    await session.commit()
    with pytest.raises(DBAPIError, match="partnership ownership mismatch"):
        async with session.begin_nested():
            await session.execute(
                text(f"UPDATE {table} SET company_id = :company WHERE id = :id"),
                {"company": other_company.id, "id": rows.returned.id if table == "returns" else rows.dispute.id},
            )


async def test_return_checks_reason_note_and_credit_note(session: AsyncSession):
    rows = await records(session)
    party = dict(
        company_id=rows.company.id,
        store_id=rows.store.id,
        partnership_id=rows.partnership.id,
        requested_by=rows.user.id,
    )
    # OTHER without a note explains nothing, so the database refuses it.
    with pytest.raises(IntegrityError, match="ck_returns_other_needs_note"):
        async with session.begin_nested():
            session.add(
                Return(
                    return_number="RET-2026-000004",
                    order_id=rows.order.id,
                    status="CANCELLED",
                    reason_code="OTHER",
                    **party,
                )
            )
            await session.flush()
    # A credit note can only hang off a completed return that actually earned credit.
    with pytest.raises(IntegrityError, match="ck_returns_credit_note_completed"):
        async with session.begin_nested():
            await session.execute(
                text("UPDATE returns SET credit_note_id = :note WHERE id = :id"),
                {"note": rows.order.id, "id": rows.returned.id},
            )


@pytest.mark.parametrize(
    "values,constraint",
    [
        ({"description": "Too short"}, "ck_disputes_description_length"),
        ({"target_type": "PAYMENT"}, "ck_disputes_target_reference"),
        ({"type": "LATE"}, "ck_disputes_type"),
    ],
)
async def test_dispute_checks_target_and_description(session: AsyncSession, values: dict[str, str], constraint: str):
    rows = await records(session)
    fields = dict(
        dispute_number="DSP-2026-000009",
        company_id=rows.company.id,
        store_id=rows.store.id,
        partnership_id=rows.partnership.id,
        target_type="ORDER",
        order_id=rows.order.id,
        type="QUANTITY",
        description="Two boxes arrived damaged",
        status="WITHDRAWN",
        resolved_at=utcnow(),
        opened_by=rows.user.id,
    )
    fields.update(values)
    with pytest.raises(IntegrityError, match=constraint):
        async with session.begin_nested():
            session.add(Dispute(**fields))
            await session.flush()


async def test_dispute_message_body_and_system_author(session: AsyncSession):
    rows = await records(session)
    with pytest.raises(IntegrityError, match="ck_dispute_messages_body_length"):
        async with session.begin_nested():
            session.add(
                DisputeMessage(dispute_id=rows.dispute.id, author_id=rows.user.id, author_side="STORE", body=" ")
            )
            await session.flush()
    with pytest.raises(IntegrityError, match="ck_dispute_messages_system_has_no_author"):
        async with session.begin_nested():
            session.add(
                DisputeMessage(
                    dispute_id=rows.dispute.id, author_id=rows.user.id, author_side="SYSTEM", body="Adjustment rejected"
                )
            )
            await session.flush()
    # The system itself reports an outcome with no user behind it (DSP-021).
    session.add(DisputeMessage(dispute_id=rows.dispute.id, author_side="SYSTEM", body="Adjustment rejected"))
    await session.flush()
