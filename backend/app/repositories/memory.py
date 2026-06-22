from collections.abc import Iterable
from datetime import datetime

from app.models.trip import DashboardSnapshot, Trip, TripTimelineEntry, TripState, VehicleSupervisor


class MemoryRepository:
    def __init__(self) -> None:
        self.trips: dict[str, Trip] = {}
        self.timeline_entries: list[TripTimelineEntry] = []
        self.supervisors: list[VehicleSupervisor] = []

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
        )

    def _recalculate_trip(self, trip: Trip) -> None:
        trip.expense_total = sum(line.amount * line.quantity for line in trip.expense_line_ids)
        trip.revenue_total = sum(line.amount * line.quantity for line in trip.revenue_line_ids)
        trip.profit = trip.revenue_total - trip.expense_total
        trip.pending_expense_total = trip.expense_total
        trip.payment_request_count = len(trip.expense_line_ids)
        trip.receivable_count = len(trip.revenue_line_ids)
        trip.order_receivable_count = len(trip.revenue_line_ids)


repo = MemoryRepository()
