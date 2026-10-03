from datetime import timedelta

from app.celery_app import celery_app
from app.core.config import get_settings
from app.core.time import new_id, utcnow


def test_fnd_003_settings_are_shared() -> None:
    assert get_settings() is get_settings()


def test_fnd_005_ids_are_unique_uuid7() -> None:
    ids = [new_id() for _ in range(1000)]
    assert len(set(ids)) == 1000
    assert all(identifier.version == 7 for identifier in ids)


def test_fnd_007_clock_is_aware_utc() -> None:
    now = utcnow()
    assert now.tzinfo is not None and now.utcoffset() == timedelta(0)


def test_fnd_022_worker_queues_and_recovery_configuration() -> None:
    assert {queue.name for queue in celery_app.conf.task_queues} == {"default", "notifications", "heavy"}
    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.task_reject_on_worker_lost is True
    assert celery_app.conf.accept_content == ["json"]
    schedule = celery_app.conf.beat_schedule
    assert schedule["dispatch-outbox"]["task"] == "tezfarmo.dispatch_outbox"
    assert schedule["purge-expired-idempotency"]["task"] == "tezfarmo.purge_expired_idempotency"
