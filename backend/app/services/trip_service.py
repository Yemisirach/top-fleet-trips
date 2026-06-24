from __future__ import annotations

from app.models.trip import ExpenseLine, Trip, TripCreate, TripState, TripTimelineEntry, TripUpdate, VehicleSupervisor
from app.services.catalog_service import seed_catalog_data
from app.repositories.memory import repo


def seed_sample_data() -> None:
    seed_catalog_data()
    if repo.list_trips():
        return

    repo.create_trip(
        Trip(
            reference="TRIP-001",
            vehicle_id="VEH-001",
            driver_id="EMP-001",
            state=TripState.available,
            current_location_note="Awaiting assignment",
        )
    )
    repo.create_trip(
        Trip(
            reference="TRIP-002",
            vehicle_id="VEH-002",
            driver_id="EMP-002",
            state=TripState.dispatched,
            current_location_note="On route to destination",
        )
    )
    repo.set_supervisors(
        [
            VehicleSupervisor(vehicle_id="VEH-001", user_id="USR-001"),
            VehicleSupervisor(vehicle_id="VEH-002", user_id="USR-002"),
        ]
    )


def list_trips() -> list[Trip]:
    seed_sample_data()
    return repo.list_trips()


def create_trip(payload: TripCreate) -> Trip:
    seed_sample_data()
    trip = Trip(**payload.model_dump())
    return repo.create_trip(trip)


def update_trip(trip_id: str, payload: TripUpdate) -> Trip | None:
    seed_sample_data()
    data = payload.model_dump(exclude_unset=True)
    return repo.update_trip(trip_id, data)


def add_expense_line(trip_id: str, line: ExpenseLine) -> Trip | None:
    trip = repo.get_trip(trip_id)
    if not trip:
        return None
    trip.expense_line_ids.append(line)
    repo._recalculate_trip(trip)
    repo.add_timeline_entry(TripTimelineEntry(trip_id=trip_id, message=f"Expense line added: {line.description}"))
    return trip


def assign_supervisors(supervisors: list[VehicleSupervisor]) -> None:
    repo.set_supervisors(supervisors)
