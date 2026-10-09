"""DSP-024: transactional, restart-safe SLA warnings for OPEN disputes."""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import DomainEvent, event_bus
from app.core.time import new_id, utcnow
from app.modules.returns.domain import sla_warning_anchor
from app.modules.returns.models import Dispute, DisputeSlaWarning


async def send_sla_warnings(session: AsyncSession, now: datetime | None = None) -> int:
    now = now or utcnow()
    count = 0
    records = await session.scalars(
        select(Dispute)
        .where(Dispute.status == "OPEN", Dispute.created_at <= now - timedelta(hours=48))
        .order_by(Dispute.id)
        .with_for_update(skip_locked=True)
        .execution_options(populate_existing=True)
    )
    for record in records:
        anchor = sla_warning_anchor(record.created_at, now)
        assert anchor is not None
        claim = await session.scalar(
            insert(DisputeSlaWarning)
            .values(id=new_id(), dispute_id=record.id, anchor_at=anchor, created_at=now)
            .on_conflict_do_nothing(index_elements=["dispute_id", "anchor_at"])
            .returning(DisputeSlaWarning.id)
        )
        if claim is None:
            continue
        await event_bus.publish(
            session,
            DomainEvent(
                "DISPUTE_SLA_WARNING",
                {
                    "id": str(record.id),
                    "partnership_id": str(record.partnership_id),
                    "company_id": str(record.company_id),
                    "store_id": str(record.store_id),
                    "anchor_at": anchor.isoformat(),
                },
                org_id=record.company_id,
            ),
        )
        count += 1
    return count
