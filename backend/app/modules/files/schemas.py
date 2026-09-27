from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

FileCategory = Literal["VERIFICATION", "IMPORT", "EXPORT", "PRODUCT_IMAGE"]


class FileOut(BaseModel):
    """P02 §5 POST /files response."""

    id: UUID
    display_name: str
    size_bytes: int
    content_type: str
    category: FileCategory
    created_at: datetime


class SignedUrlOut(BaseModel):
    url: str
    expires_at: datetime
