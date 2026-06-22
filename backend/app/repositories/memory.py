from collections.abc import Iterable
from datetime import datetime

from app.models.trip import (
    DashboardSnapshot,
    ExpenseType,
    FinancialTemplate,
    PaymentRequest,
    Receivable,
    RevenueType,
    Trip,
    TripLocation,
    TripTimelineEntry,
    TripState,
    VehicleSupervisor,
)


class MemoryRepository:
    def __init__(self) -> None:
        self.trips: dict[str, Trip] = {}
        self.timeline_entries: list[TripTimelineEntry] = []
        self.supervisors: list[VehicleSupervisor] = []
        self.locations: dict[str, TripLocation] = {}
        self.expense_types: dict[str, ExpenseType] = {}
        self.revenue_types: dict[str, RevenueType] = {}
        self.financial_templates: dict[str, FinancialTemplate] = {}
        self.receivables: dict[str, Receivable] = {}
        self.payment_requests: dict[str, PaymentRequest] = {}

    def list_trips(self) -> list[Trip]:
        return list(self.trips.values())

    def get_trip(self, trip_id: str) -> Trip | None:
        return self.trips.get(trip_id)

    def create_trip(self, trip: Trip) -> Trip:
        self.trips[trip.id] = trip
        self._recalculate_trip(trip)
        return trip

    def update_trip(self, trip_id: str, payload: dict) -> Trip | None:
        trip = self.trips.get(trip_id)
        if not trip:
            return None
        updated = trip.model_copy(update=payload | {"updated_at": datetime.utcnow()})
        self.trips[trip_id] = updated
        self._recalculate_trip(updated)
        return updated

    def add_timeline_entry(self, entry: TripTimelineEntry) -> TripTimelineEntry:
        self.timeline_entries.append(entry)
        trip = self.trips.get(entry.trip_id)
        if trip:
            trip.timeline.append(entry.message)
        return entry

    def list_active_trips(self) -> list[Trip]:
        return [trip for trip in self.trips.values() if trip.state in {TripState.available, TripState.assigned, TripState.dispatched}]

    def list_pending_assignment(self) -> list[Trip]:
        return [trip for trip in self.trips.values() if trip.state == TripState.available]

    def set_supervisors(self, supervisors: Iterable[VehicleSupervisor]) -> None:
        self.supervisors = list(supervisors)

    def snapshot(self) -> DashboardSnapshot:
        active = self.list_active_trips()
        pending = self.list_pending_assignment()
        payment_summary = {
            "trip_count": len(self.trips),
            "active_count": len(active),
            "pending_assignment_count": len(pending),
        }
        return DashboardSnapshot(
            active_trips=active,
            pending_assignment=pending,
            current_location_summary=[
                {
                    "trip_id": trip.id,
                    "reference": trip.reference,
                    "current_location_note": trip.current_location_note,
                    "current_location_days": trip.current_location_days,
                }
                for trip in active
            ],
            payment_summary=payment_summary,
            trip_supervisors=self.supervisors,
            receivables=list(self.receivables.values()),
            payment_requests=list(self.payment_requests.values()),
        )

    def _recalculate_trip(self, trip: Trip) -> None:
        trip.expense_total = sum(line.amount * line.quantity for line in trip.expense_line_ids)
        trip.revenue_total = sum(line.amount * line.quantity for line in trip.revenue_line_ids)
        trip.profit = trip.revenue_total - trip.expense_total
        trip.pending_expense_total = trip.expense_total
        trip.payment_request_count = len(trip.expense_line_ids)
        trip.receivable_count = len(trip.revenue_line_ids)
        trip.order_receivable_count = len(trip.revenue_line_ids)

    def list_locations(self) -> list[TripLocation]:
        return list(self.locations.values())

    def save_location(self, location: TripLocation) -> TripLocation:
        self.locations[location.id] = location
        return location

    def list_expense_types(self) -> list[ExpenseType]:
        return list(self.expense_types.values())

    def save_expense_type(self, expense_type: ExpenseType) -> ExpenseType:
        self.expense_types[expense_type.id] = expense_type
        return expense_type

    def list_revenue_types(self) -> list[RevenueType]:
        return list(self.revenue_types.values())

    def save_revenue_type(self, revenue_type: RevenueType) -> RevenueType:
        self.revenue_types[revenue_type.id] = revenue_type
        return revenue_type

    def list_financial_templates(self) -> list[FinancialTemplate]:
        return list(self.financial_templates.values())

    def save_financial_template(self, template: FinancialTemplate) -> FinancialTemplate:
        self.financial_templates[template.id] = template
        return template

    def list_receivables(self) -> list[Receivable]:
        return list(self.receivables.values())

    def save_receivable(self, receivable: Receivable) -> Receivable:
        self.receivables[receivable.id] = receivable
        return receivable

    def list_payment_requests(self) -> list[PaymentRequest]:
        return list(self.payment_requests.values())

    def save_payment_request(self, payment_request: PaymentRequest) -> PaymentRequest:
        self.payment_requests[payment_request.id] = payment_request
        return payment_request


repo = MemoryRepository()
