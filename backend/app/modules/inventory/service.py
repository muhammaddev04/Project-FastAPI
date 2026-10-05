"""P05: the sole stock writer; callers own the transaction and never commit here."""

from dataclasses import dataclass
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.errors import AppError
from app.core.events import DomainEvent, event_bus
from app.core.outbox import OutboxEvent
from app.core.time import utcnow
from app.modules.catalog import service as catalog
from app.modules.catalog.models import Product, ProductUnit
from app.modules.inventory.models import Stock, StockMovement, StockReservation

ZERO = Decimal("0.000")
MAX_QUANTITY = Decimal("99999999999.999")
Line = tuple[UUID, Decimal]


@dataclass(frozen=True)
class SourceRef:
    company_id: UUID
    source_id: UUID
    source_type: Literal["ORDER", "RETURN", "IMPORT"] = "ORDER"


@dataclass(frozen=True)
class Availability:
    quantity: Decimal
    reserved: Decimal
    available: Decimal


def quantity(value: Decimal, *, positive: bool = True) -> Decimal:
    if not value.is_finite() or value < 0 or value > MAX_QUANTITY or (positive and value <= 0):
        raise AppError("validation_error", 422, {"field": "quantity"})
    rounded = value.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    if (positive and rounded <= 0) or rounded != value:
        raise AppError("validation_error", 422, {"field": "quantity", "decimal_places": 3})
    return rounded


def grouped(lines: list[Line]) -> dict[UUID, Decimal]:
    if not lines:
        raise AppError("validation_error", 422, {"field": "items"})
    result: dict[UUID, Decimal] = {}
    for product_id, value in lines:
        result[product_id] = quantity(result.get(product_id, ZERO) + quantity(value))
    return result


async def to_base(session: AsyncSession, company_id: UUID, product_id: UUID, unit_id: UUID, value: Decimal) -> Decimal:
    product = await catalog.get_owned_entity(session, Product, company_id, product_id)
    unit = await session.get(ProductUnit, unit_id)
    if unit is None or unit.product_id != product_id:
        raise AppError("not_found", 404)
    if not product.is_active or not unit.is_active:
        raise AppError("validation_error", 422, {"field": "unit_id", "reason": "inactive"})
    quantity(value)
    if not unit.allow_fraction and value != value.to_integral_value():
        raise AppError("validation_error", 422, {"field": "quantity", "reason": "fraction_forbidden"})
    return quantity((value * unit.coefficient).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))


class StockService:
    async def set_threshold(
        self,
        session: AsyncSession,
        company_id: UUID,
        product_id: UUID,
        threshold: Decimal | None,
        expected_version: int,
        actor: UUID,
    ) -> None:
        if threshold is not None:
            quantity(threshold, positive=False)
        async with session.begin_nested():
            stock = (await self._lock(session, company_id, [product_id]))[product_id]
            if stock.version != expected_version:
                raise AppError("version_conflict", 409, {"current_version": stock.version})
            old = stock.low_stock_threshold
            stock.low_stock_threshold = threshold
            stock.version += 1
            await audit.record(
                session,
                "stock.threshold_changed",
                "stocks",
                product_id,
                actor_id=actor,
                org_id=company_id,
                old={"low_stock_threshold": str(old) if old is not None else None},
                new={"low_stock_threshold": str(threshold) if threshold is not None else None},
            )
            await session.flush()

    async def _source_lock(self, session: AsyncSession, source: SourceRef) -> None:
        # Serialize retries and closing a source even when its product sets differ.
        await session.execute(
            select(
                func.pg_advisory_xact_lock(
                    func.hashtextextended(f"inventory:{source.company_id}:{source.source_type}:{source.source_id}", 0)
                )
            )
        )

    async def _lock(self, session: AsyncSession, company_id: UUID, product_ids: list[UUID]) -> dict[UUID, Stock]:
        rows = list(
            await session.scalars(
                select(Stock)
                .where(Stock.company_id == company_id, Stock.product_id.in_(product_ids))
                .order_by(Stock.product_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        if len(rows) != len(set(product_ids)):
            raise AppError("not_found", 404)
        return {row.product_id: row for row in rows}

    async def availability(
        self, session: AsyncSession, company_id: UUID, product_ids: list[UUID]
    ) -> dict[UUID, Availability]:
        rows = await session.scalars(
            select(Stock).where(Stock.company_id == company_id, Stock.product_id.in_(product_ids))
        )
        return {row.product_id: Availability(row.quantity, row.reserved_quantity, row.available) for row in rows}

    async def _move(
        self,
        session: AsyncSession,
        stock: Stock,
        kind: str,
        delta: Decimal,
        reserved: Decimal,
        actor: UUID | None,
        source: SourceRef | None = None,
        reason: str | None = None,
    ) -> None:
        after = stock.quantity + delta
        reserved_after = stock.reserved_quantity + reserved
        if after < 0 or reserved_after < 0 or reserved_after > after:
            raise AppError("negative_stock_forbidden", 409, {"reserved": str(stock.reserved_quantity)})
        quantity(after, positive=False)
        stock.quantity, stock.reserved_quantity = after, reserved_after
        stock.version += 1
        stock.last_movement_at = stock.updated_at = utcnow()
        session.add(
            StockMovement(
                company_id=stock.company_id,
                product_id=stock.product_id,
                type=kind,
                quantity_delta=delta,
                reserved_delta=reserved,
                quantity_after=after,
                reserved_after=reserved_after,
                source_type=source.source_type if source else "MANUAL",
                source_id=source.source_id if source else None,
                reason=reason,
                created_by=actor,
            )
        )
        await session.flush()
        if stock.low_stock_threshold is not None and stock.available < stock.low_stock_threshold:
            recent = await session.scalar(
                select(OutboxEvent.id)
                .where(
                    OutboxEvent.event_type == "LOW_STOCK",
                    OutboxEvent.org_id == stock.company_id,
                    OutboxEvent.payload["product_id"].astext == str(stock.product_id),
                    OutboxEvent.created_at > utcnow() - timedelta(hours=24),
                )
                .limit(1)
            )
            if recent is None:
                await event_bus.publish(
                    session,
                    DomainEvent(
                        "LOW_STOCK",
                        {
                            "product_id": str(stock.product_id),
                            "available": str(stock.available),
                            "threshold": str(stock.low_stock_threshold),
                        },
                        org_id=stock.company_id,
                    ),
                )

    async def receive(
        self,
        session: AsyncSession,
        company_id: UUID,
        lines: list[Line],
        actor: UUID | None,
        note: str | None = None,
        source: SourceRef | None = None,
    ) -> None:
        totals = grouped(lines)
        if source and source.company_id != company_id:
            raise AppError("not_found", 404)
        async with session.begin_nested():
            rows = await self._lock(session, company_id, list(totals))
            for product_id in sorted(totals):
                await self._move(session, rows[product_id], "RECEIPT", totals[product_id], ZERO, actor, source, note)
                await audit.record(
                    session,
                    "stock.received",
                    "stocks",
                    product_id,
                    actor_id=actor,
                    org_id=company_id,
                    new={"quantity": str(rows[product_id].quantity)},
                    reason=note,
                )

    async def adjust(
        self,
        session: AsyncSession,
        company_id: UUID,
        product_id: UUID,
        actual_qty: Decimal,
        reason: str,
        actor: UUID | None,
    ) -> None:
        quantity(actual_qty, positive=False)
        self._reason(reason)
        async with session.begin_nested():
            stock = (await self._lock(session, company_id, [product_id]))[product_id]
            old = stock.quantity
            await self._move(session, stock, "ADJUSTMENT", actual_qty - old, ZERO, actor, reason=reason.strip())
            await audit.record(
                session,
                "stock.adjusted",
                "stocks",
                product_id,
                actor_id=actor,
                org_id=company_id,
                old={"quantity": str(old)},
                new={"quantity": str(actual_qty)},
                reason=reason.strip(),
            )

    @staticmethod
    def _reason(reason: str) -> None:
        if len(reason.strip()) < 5:
            raise AppError("validation_error", 422, {"field": "reason", "min_length": 5})

    async def write_off(
        self, session: AsyncSession, company_id: UUID, product_id: UUID, qty: Decimal, reason: str, actor: UUID | None
    ) -> None:
        quantity(qty)
        self._reason(reason)
        async with session.begin_nested():
            stock = (await self._lock(session, company_id, [product_id]))[product_id]
            await self._move(session, stock, "WRITE_OFF", -qty, ZERO, actor, reason=reason.strip())
            await audit.record(
                session,
                "stock.written_off",
                "stocks",
                product_id,
                actor_id=actor,
                org_id=company_id,
                new={"quantity": str(stock.quantity)},
                reason=reason.strip(),
            )

    async def reserve(
        self, session: AsyncSession, company_id: UUID, lines: list[Line], source: SourceRef, actor: UUID | None
    ) -> None:
        if source.company_id != company_id or source.source_type != "ORDER":
            raise AppError("validation_error", 422, {"field": "source"})
        totals = grouped(lines)
        async with session.begin_nested():
            await self._source_lock(session, source)
            rows = await self._lock(session, company_id, list(totals))
            existing = list(
                await session.scalars(
                    select(StockReservation).where(
                        StockReservation.company_id == company_id,
                        StockReservation.source_id == source.source_id,
                        StockReservation.source_type == "ORDER",
                        StockReservation.status == "ACTIVE",
                    )
                )
            )
            if existing:
                if {row.product_id: row.quantity for row in existing} == totals:
                    return
                raise AppError("validation_error", 409, {"field": "source", "reason": "reservation_exists"})
            insufficient = [
                {"product_id": str(key), "requested": str(value), "available": str(rows[key].available)}
                for key, value in totals.items()
                if rows[key].available < value
            ]
            if insufficient:
                raise AppError("insufficient_stock", 409, {"items": insufficient})
            for product_id in sorted(totals):
                session.add(
                    StockReservation(
                        company_id=company_id,
                        product_id=product_id,
                        source_type="ORDER",
                        source_id=source.source_id,
                        quantity=totals[product_id],
                    )
                )
                await self._move(session, rows[product_id], "RESERVE", ZERO, totals[product_id], actor, source)

    async def _close(
        self, session: AsyncSession, source: SourceRef, actor: UUID | None, *, ship: bool, reason: str | None = None
    ) -> None:
        if source.source_type != "ORDER":
            raise AppError("validation_error", 422, {"field": "source"})
        query = select(StockReservation).where(
            StockReservation.company_id == source.company_id,
            StockReservation.source_type == "ORDER",
            StockReservation.source_id == source.source_id,
            StockReservation.status == "ACTIVE",
        )
        async with session.begin_nested():
            await self._source_lock(session, source)
            candidates = list(await session.scalars(query))
            if not candidates:
                return
            rows = await self._lock(session, source.company_id, [row.product_id for row in candidates])
            reservations = await session.scalars(
                query.order_by(StockReservation.product_id).with_for_update().execution_options(populate_existing=True)
            )
            for reservation in reservations:
                reservation.status = "SHIPPED" if ship else "RELEASED"
                reservation.closed_at = utcnow()
                await self._move(
                    session,
                    rows[reservation.product_id],
                    "SHIP" if ship else "RELEASE",
                    -reservation.quantity if ship else ZERO,
                    -reservation.quantity,
                    actor,
                    source,
                    reason,
                )

    async def release(
        self, session: AsyncSession, source: SourceRef, actor: UUID | None, reason: str | None = None
    ) -> None:
        await self._close(session, source, actor, ship=False, reason=reason)

    async def ship(self, session: AsyncSession, source: SourceRef, actor: UUID | None) -> None:
        await self._close(session, source, actor, ship=True)

    async def return_in(
        self, session: AsyncSession, company_id: UUID, lines: list[Line], source: SourceRef, actor: UUID | None
    ) -> None:
        if source.company_id != company_id or source.source_type != "RETURN":
            raise AppError("validation_error", 422, {"field": "source"})
        totals = grouped(lines)
        async with session.begin_nested():
            rows = await self._lock(session, company_id, list(totals))
            for product_id in sorted(totals):
                await self._move(session, rows[product_id], "RETURN_IN", totals[product_id], ZERO, actor, source)


stock_service = StockService()


async def product_created(session: AsyncSession, event: DomainEvent) -> None:
    await session.execute(
        insert(Stock)
        .values(product_id=UUID(event.payload["id"]), company_id=UUID(event.payload["company_id"]))
        .on_conflict_do_nothing(index_elements=[Stock.product_id])
    )


class InventoryReferences:
    async def has_activity(self, session: AsyncSession, product_id: UUID) -> bool:
        return (
            await session.scalar(select(StockMovement.id).where(StockMovement.product_id == product_id).limit(1))
            is not None
        )


async def reconcile(session: AsyncSession) -> int:
    mismatches = 0
    products = list(await session.scalars(select(Stock.product_id).order_by(Stock.product_id)))
    for product_id in products:
        stock = await session.scalar(
            select(Stock)
            .where(Stock.product_id == product_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if stock is None:
            continue
        moved, reserved = (
            await session.execute(
                select(
                    func.coalesce(func.sum(StockMovement.quantity_delta), 0),
                    func.coalesce(func.sum(StockMovement.reserved_delta), 0),
                ).where(StockMovement.product_id == product_id)
            )
        ).one()
        active = await session.scalar(
            select(func.coalesce(func.sum(StockReservation.quantity), 0)).where(
                StockReservation.product_id == product_id, StockReservation.status == "ACTIVE"
            )
        )
        if stock.quantity != moved or stock.reserved_quantity != reserved or reserved != active:
            mismatches += 1
            await event_bus.publish(
                session,
                DomainEvent(
                    "STOCK_RECONCILIATION_MISMATCH",
                    {
                        "product_id": str(product_id),
                        "quantity": str(stock.quantity),
                        "movement_quantity": str(moved),
                        "reserved": str(stock.reserved_quantity),
                        "movement_reserved": str(reserved),
                        "active_reserved": str(active),
                    },
                    org_id=stock.company_id,
                ),
            )
    return mismatches


def install() -> None:
    event_bus.subscribe("PRODUCT_CREATED", product_created)
    catalog.references = InventoryReferences()
