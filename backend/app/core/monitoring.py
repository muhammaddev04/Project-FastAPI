"""Optional error reporting without request bodies, credentials or SQL parameter values."""

import sentry_sdk

from app.core.config import get_settings
from app.core.request_context import get_request_id


def configure_monitoring() -> None:
    settings = get_settings()
    if settings.sentry_dsn.get_secret_value():
        sentry_sdk.init(
            dsn=settings.sentry_dsn.get_secret_value(),
            environment=settings.app_env,
            release=settings.app_version,
            default_integrations=False,
            send_default_pii=False,
        )


def report_bug(code: str) -> None:
    if get_settings().sentry_dsn.get_secret_value():
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("request_id", get_request_id())
            sentry_sdk.capture_message(code, level="error")
