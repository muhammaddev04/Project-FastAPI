"""FND-022: workers and periodic durable-event dispatch."""

import asyncio
from functools import lru_cache

from celery import Celery
from kombu import Queue

import app.model_registry  # noqa: F401 - standalone workers need every foreign-key target before flushing.
from app.core.config import get_settings
from app.modules.organizations.ports import install_handlers
from app.modules.subscriptions.service import install as install_subscriptions

install_handlers()
install_subscriptions()

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
        "expire-membership-invitations": {"task": "tezfarmo.expire_membership_invitations", "schedule": 3600.0},
        "subscription-tick": {"task": "tezfarmo.subscription_tick", "schedule": 900.0},
        "subscription-reminders": {"task": "tezfarmo.subscription_reminders", "schedule": 3600.0},
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


@celery_app.task(name="tezfarmo.expire_membership_invitations")
def expire_membership_invitations() -> int:
    from app.core.db import get_sessionmaker
    from app.modules.identity.team_service import expire_invitations

    async def expire() -> int:
        async with get_sessionmaker()() as session, session.begin():
            return await expire_invitations(session)

    return _runner().run(expire())


@celery_app.task(name="tezfarmo.subscription_tick")
def subscription_tick() -> int:
    from app.core.db import get_sessionmaker
    from app.modules.subscriptions.service import tick

    async def run() -> int:
        async with get_sessionmaker()() as session, session.begin():
            return await tick(session)

    return _runner().run(run())


@celery_app.task(name="tezfarmo.subscription_reminders")
def subscription_reminders() -> int:
    from app.core.db import get_sessionmaker
    from app.modules.subscriptions.service import send_reminders

    async def run() -> int:
        async with get_sessionmaker()() as session, session.begin():
            return await send_reminders(session)

    return _runner().run(run())
