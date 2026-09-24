from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import uuid_utils


def utcnow() -> datetime:
    """Timezone-aware UTC now (FND-007)."""
    return datetime.now(UTC)


def new_id() -> UUID:
    """UUIDv7 primary keys generated in the application (FND-005)."""
    return UUID(str(uuid_utils.uuid7()))
