from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime

from app.core.request_context import get_request_id

_PHONE = re.compile(r"\+(\d{3})\d{3,8}(\d{4})")


def mask_phone(text: str) -> str:
    """SEC-011: +992*****1234."""
    return _PHONE.sub(lambda match: f"+{match.group(1)}*****{match.group(2)}", text)


class JsonFormatter(logging.Formatter):
    """FND-019: one JSON object per line with request_id; phone numbers are masked."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": mask_phone(record.getMessage()),
            "request_id": get_request_id(),
        }
        if record.exc_info:
            payload["exc"] = mask_phone(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
