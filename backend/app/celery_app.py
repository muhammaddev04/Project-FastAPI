"""FND-022: workers and periodic durable-event dispatch."""

import asyncio
from functools import lru_cache

from celery import Celery
from kombu import Queue

from app.core.config import get_settings

celery_app = Celery("tezfarmo", broker=get_settings().celery_broker_url)
celery_app.conf.update(
    task_queues=(Queue("default"), Queue("notifications"), Queue("heavy")),
    task_default_queue="default",
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "dispatch-outbox": {"task": "tezfarmo.dispatch_outbox", "schedule": 5.0},
        "purge-expired-idempotency": {"task": "tezfarmo.purge_expired_idempotency", "schedule": 86400.0},
    },
)


@lru_cache(maxsize=1)
def _runner() -> asyncio.Runner:
    # Created after the worker forks; reuse the loop that owns pooled async DB connections.
    return asyncio.Runner()


@celery_app.task(name="tezfarmo.dispatch_outbox")
def dispatch_outbox() -> int:
    from app.core.outbox import dispatch_pending

    return _runner().run(dispatch_pending())


@celery_app.task(name="tezfarmo.purge_expired_idempotency")
def purge_expired_idempotency() -> int:
    from app.core.db import get_sessionmaker
    from app.core.idempotency import purge_expired

    async def purge() -> int:
        async with get_sessionmaker()() as session, session.begin():
            return await purge_expired(session)

    return _runner().run(purge())
