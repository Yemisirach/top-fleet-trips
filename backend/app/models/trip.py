from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Optional
from uuid import uuid4

from pydantic import BaseModel, Field


class TripState(str, Enum):
    draft = "Draft"
    available = "Available"
    assigned = "Assigned"
    dispatched = "Dispatched"
    done = "Done"
    cancelled = "Cancelled"


class TripLocation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    notes: Optional[str] = None


class TripLine(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    description: str
    amount: float = 0
    quantity: float = 1


class ExpenseLine(TripLine):
    expense_type_id: Optional[str] = None


class RevenueLine(TripLine):
    revenue_type_id: Optional[str] = None


class Trip(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    reference: str
    vehicle_id: str
    driver_id: Optional[str] = None
    departure_id: Optional[str] = None
    departure_date: Optional[datetime] = None
    destination_id: Optional[str] = None
    arrival_date: Optional[datetime] = None
    current_location_id: Optional[str] = None
    current_location_note: Optional[str] = None
    financial_template_id: Optional[str] = None
    state: TripState = TripState.draft
    expense_note: Optional[str] = None
    revenue_note: Optional[str] = None
    general_note: Optional[str] = None
    expense_line_ids: list[ExpenseLine] = Field(default_factory=list)
    revenue_line_ids: list[RevenueLine] = Field(default_factory=list)
    timeline: list[str] = Field(default_factory=list)
    supervisor_names: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    current_location_days: int = 0
    expense_total: float = 0
    revenue_total: float = 0
    profit: float = 0
    pending_expense_total: float = 0
    payment_request_count: int = 0
    receivable_count: int = 0
    order_receivable_count: int = 0


class TripCreate(BaseModel):
    reference: str
    vehicle_id: str
    driver_id: Optional[str] = None
    departure_id: Optional[str] = None
    departure_date: Optional[datetime] = None
    destination_id: Optional[str] = None
    arrival_date: Optional[datetime] = None
    current_location_id: Optional[str] = None
    current_location_note: Optional[str] = None
    financial_template_id: Optional[str] = None
    state: TripState = TripState.draft
    expense_note: Optional[str] = None
    revenue_note: Optional[str] = None
    general_note: Optional[str] = None


class TripUpdate(BaseModel):
    driver_id: Optional[str] = None
    departure_id: Optional[str] = None
    departure_date: Optional[datetime] = None
    destination_id: Optional[str] = None
    arrival_date: Optional[datetime] = None
    current_location_id: Optional[str] = None
    current_location_note: Optional[str] = None
    financial_template_id: Optional[str] = None
    state: Optional[TripState] = None
    expense_note: Optional[str] = None
    revenue_note: Optional[str] = None
    general_note: Optional[str] = None


class TripTimelineEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    trip_id: str
    message: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class VehicleSupervisor(BaseModel):
    vehicle_id: str
    user_id: str


class DashboardSnapshot(BaseModel):
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    active_trips: list[Trip] = Field(default_factory=list)
    pending_assignment: list[Trip] = Field(default_factory=list)
    current_location_summary: list[dict] = Field(default_factory=list)
    payment_summary: dict = Field(default_factory=dict)
    trip_supervisors: list[VehicleSupervisor] = Field(default_factory=list)
