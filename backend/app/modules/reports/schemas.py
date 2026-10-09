"""P12 §4 request and response models for dashboards, reports and exports."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.modules.reports.domain import ColumnKind, GroupBy

ExportFormat = Literal["CSV", "XLSX"]
ExportStatus = Literal["PENDING", "RUNNING", "READY", "FAILED", "EXPIRED"]


class ColumnOut(BaseModel):
    """The column list is part of the answer, so a client can render any report without knowing it."""

    key: str
    kind: ColumnKind


class ReportOut(BaseModel):
    code: str
    date_from: date | None
    date_to: date | None
    group_by: GroupBy | None
    columns: list[ColumnOut]
    rows: list[dict[str, Any]]
    totals: dict[str, Any]


class ReportInfoOut(BaseModel):
    """One entry of the report list: what this member may open (§5 reports screen)."""

    code: str
    periodic: bool
    group_by: list[GroupBy]
    columns: list[ColumnOut]


class DeliveryTodayOut(BaseModel):
    """DEL-012: the handover code is never part of a dashboard; the store reads it on the order itself."""

    delivery_id: UUID
    order_id: UUID
    order_number: str
    status: str


class CompanyDashboardOut(BaseModel):
    """§1.3 company dashboard; a figure the member may not read is absent, not zero."""

    type: Literal["COMPANY"] = "COMPANY"
    new_orders: int | None = None
    deliveries_today: int | None = None
    sales_this_month: Decimal | None = None
    receivables: Decimal | None = None
    overdue: Decimal | None = None
    low_stock_products: int | None = None
    payments_to_confirm: int | None = None
    open_disputes: int | None = None


class StoreDashboardOut(BaseModel):
    type: Literal["STORE"] = "STORE"
    active_orders: int | None = None
    deliveries_today: list[DeliveryTodayOut] = Field(default_factory=list)
    debt: Decimal | None = None
    overdue: Decimal | None = None


class ExportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Annotated[str, Field(max_length=32)]
    format: ExportFormat
    params: dict[str, Any] = Field(default_factory=dict)


class ExportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    kind: str
    format: ExportFormat
    status: ExportStatus
    params: dict[str, Any]
    row_count: int | None
    error: str | None
    created_at: datetime
    started_at: datetime | None
    ready_at: datetime | None
    expires_at: datetime | None


class DownloadOut(BaseModel):
    url: str
    expires_at: datetime
