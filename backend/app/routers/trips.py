from fastapi import APIRouter, HTTPException

from app.models.trip import ExpenseLine, Trip, TripCreate, TripUpdate
from app.services.trip_service import add_expense_line, create_trip, list_trips, update_trip

router = APIRouter()


@router.get("")
async def get_trips() -> list[Trip]:
    return list_trips()


@router.post("")
async def post_trip(payload: TripCreate) -> Trip:
    return create_trip(payload)


@router.get("/{trip_id}")
async def get_trip(trip_id: str) -> Trip:
    for trip in list_trips():
        if trip.id == trip_id:
            return trip
    raise HTTPException(status_code=404, detail="Trip not found")


@router.patch("/{trip_id}")
async def patch_trip(trip_id: str, payload: TripUpdate) -> Trip:
    trip = update_trip(trip_id, payload)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return trip


@router.post("/{trip_id}/expense-lines")
async def post_expense_line(trip_id: str, line: ExpenseLine) -> Trip:
    trip = add_expense_line(trip_id, line)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return trip
