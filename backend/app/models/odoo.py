from __future__ import annotations

from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field


class TripWorkflowState(str, Enum):
    draft = "draft"
    available = "available"
    assigned = "assigned"
    dispatched = "dispatched"
    done = "done"
    cancelled = "cancelled"


class TripLocation(BaseModel):
    id: str | None = None
    name: str


class TripExpenseType(BaseModel):
    id: str | None = None
    name: str


class TripRevenueType(BaseModel):
    id: str | None = None
    name: str


class TripExpenseLine(BaseModel):
    id: str | None = None
    expense_type_id: str | None = None
    description: str
    amount: float = 0
    quantity: float = 1


class TripRevenueLine(BaseModel):
    id: str | None = None
    revenue_type_id: str | None = None
    description: str
    amount: float = 0
    quantity: float = 1


class TripFinancialTemplateExpenseLine(BaseModel):
    id: str | None = None
    expense_type_id: str | None = None
    description: str
    amount: float = 0
    quantity: float = 1


class TripFinancialTemplateRevenueLine(BaseModel):
    id: str | None = None
    revenue_type_id: str | None = None
    description: str
    amount: float = 0
    quantity: float = 1


class TripFinancialTemplate(BaseModel):
    id: str | None = None
    name: str
    expense_lines: list[TripFinancialTemplateExpenseLine] = Field(default_factory=list)
    revenue_lines: list[TripFinancialTemplateRevenueLine] = Field(default_factory=list)


class TripTimelineEntry(BaseModel):
    id: str | None = None
    trip_id: str | None = None
    message: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TripTimeline(BaseModel):
    id: str | None = None
    trip_id: str | None = None
    entries: list[TripTimelineEntry] = Field(default_factory=list)


class TripReceivableLine(BaseModel):
    id: str | None = None
    description: str
    amount: float = 0
    quantity: float = 1


class TripReceivable(BaseModel):
    id: str | None = None
    reference: str
    trip_id: str | None = None
    receivable_type: str
    customer_name: str | None = None
    contact: str | None = None
    amount_due: float = 0
    payment_reference: str | None = None
    state: str = "draft"
    line_ids: list[TripReceivableLine] = Field(default_factory=list)


class FleetVehicleSupervisor(BaseModel):
    vehicle_id: str
    user_id: str
