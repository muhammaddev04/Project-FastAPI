"""P02 §6 `GET /admin/verifications` query (FND-011): filter `status`, `org_type`; ordering `submitted_at`."""

from __future__ import annotations

from typing import Literal

from app.core.filtering import ListQuery
from app.modules.identity.models import Organization
from app.modules.verification.models import VerificationRequest


class QueueQuery(ListQuery):
    status: Literal["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"] | None = None
    org_type: Literal["COMPANY", "STORE"] | None = None
    ordering: Literal["submitted_at", "-submitted_at"] = "submitted_at"

    filter_columns = {"status": VerificationRequest.status, "org_type": Organization.type}
    ordering_columns = {"submitted_at": VerificationRequest.submitted_at}
