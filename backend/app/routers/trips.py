"""Trips router with real Odoo data."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.services.fleet_odoo_service import get_fleet_trips, get_fleet_trip_by_id
from app.models.trip import TripCreate, TripUpdate, ExpenseLine

router = APIRouter()


def _trip_to_dict(trip) -> dict:
    """Convert FleetTrip dataclass to response dict."""
    return {
        "id": trip.id,
        "name": trip.name,
        "vehicle_id": trip.vehicle_id,
        "driver_id": trip.driver_id,
        "state": trip.state,
        "departure_date": trip.departure_date,
        "arrival_date": trip.arrival_date,
        "current_location_note": trip.current_location_note,
        "note": trip.note,
        "general_note": trip.general_note,
        "expense_note": trip.expense_note,
        "revenue_note": trip.revenue_note,
        "create_date": trip.create_date,
        "write_date": trip.write_date,
    }


@router.get("")
async def list_trips(
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=500),
    db: AsyncSession = Depends(get_session),
) -> list[dict]:
    """List all trips from Odoo."""
    trips = await get_fleet_trips(db, skip=skip, limit=limit)
    return [_trip_to_dict(t) for t in trips]


@router.get("/{trip_id}")
async def get_trip(trip_id: int, db: AsyncSession = Depends(get_session)) -> dict:
    """Get a specific trip by ID."""
    trip = await get_fleet_trip_by_id(db, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return _trip_to_dict(trip)


@router.get("/{trip_id}/timeline")
async def get_trip_timeline(
    trip_id: int,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Get timeline entries for a specific trip from Odoo."""
    from app.routers.journeys import get_journey_timeline

    data = await get_journey_timeline(trip_id, db)
    return {"trip_id": trip_id, "timeline": data["timeline"]}


@router.post("")
async def create_trip(payload: TripCreate) -> dict:
    """Create a trip (in-memory for now)."""
    return {"message": "Trip creation is read-only from Odoo. Use Odoo to create trips."}


@router.patch("/{trip_id}")
async def update_trip(trip_id: int, payload: TripUpdate) -> dict:
    """Update a trip (read-only from Odoo)."""
    return {"message": "Trip updates must be done in Odoo."}


@router.post("/{trip_id}/expense-lines")
async def add_expense_line(trip_id: int, line: ExpenseLine) -> dict:
    """Add expense line (in-memory for now)."""
    return {"message": "Expense lines managed in Odoo."}
