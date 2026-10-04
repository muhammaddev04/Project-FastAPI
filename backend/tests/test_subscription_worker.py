"""Run actual Celery task bodies without importing the FastAPI application."""

import os
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.modules.subscriptions import service
from tests.factories import make_org, make_user


async def test_standalone_worker_transitions_and_reminders(session: AsyncSession) -> None:
    owner = await make_user(session)
    org = await make_org(session, owner)
    subscription = await service.get_subscription(session, company_id=org.id)
    subscription.trial_ends_at = utcnow() - timedelta(days=8)
    await session.commit()
    script = """
from app.celery_app import _runner, subscription_tick, subscription_reminders
from app.core.db import get_engine
from app.modules.identity import ports
from app.modules.subscriptions.service import guard
assert ports.subscription_guard is guard
assert subscription_tick() == 2
assert subscription_tick() == 0
assert subscription_reminders() == 0
_runner().run(get_engine().dispose())
_runner().close()
print('standalone worker passed')
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parent.parent,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert "standalone worker passed" in result.stdout
    await session.refresh(subscription)
    assert subscription.status == "SOFT_BLOCK"
