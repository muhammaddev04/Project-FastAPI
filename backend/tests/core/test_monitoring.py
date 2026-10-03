from unittest.mock import Mock

import pytest

from app.core import monitoring
from app.core.config import Settings


@pytest.mark.parametrize("dsn", ["", "https://public@example.invalid/1"])
def test_fnd_008_monitoring_optional_and_excludes_request_data(monkeypatch: pytest.MonkeyPatch, dsn: str) -> None:
    settings = Settings(_env_file=None, sentry_dsn=dsn)
    monkeypatch.setattr(monitoring, "get_settings", lambda: settings)
    initialize, capture = Mock(), Mock()
    monkeypatch.setattr(monitoring.sentry_sdk, "init", initialize)
    monkeypatch.setattr(monitoring.sentry_sdk, "capture_message", capture)
    monitoring.configure_monitoring()
    monitoring.report_bug("ledger_immutable")
    if dsn:
        assert initialize.call_args.kwargs["default_integrations"] is False
        assert initialize.call_args.kwargs["send_default_pii"] is False
        capture.assert_called_once_with("ledger_immutable", level="error")
    else:
        initialize.assert_not_called()
        capture.assert_not_called()
