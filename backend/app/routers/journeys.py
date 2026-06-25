from fastapi import APIRouter, Query
from datetime import date
from typing import Optional
from app.mock_data import mock_db

router = APIRouter()

@router.get("/journeys")
async def get_journeys(
    plate: Optional[str] = Query(None, description="Filter by vehicle plate number (partial match)"),
    driver: Optional[str] = Query(None, description="Filter by driver name (partial match)"),
    from_date: Optional[date] = Query(None, description="Filter by departure date >= YYYY-MM-DD"),
    to_date: Optional[date] = Query(None, description="Filter by departure date <= YYYY-MM-DD"),
    status: Optional[str] = Query(None, description="Filter by journey status"),
    include_trips: bool = Query(True, description="Include individual trip legs in response"),
):
    """Return all journeys with optional filtering.
    
    Each journey contains multiple trip legs (e.g. Topwater -> Dire Dawa -> Topwater).
    Use `include_trips=false` to reduce payload size if only summary data is needed.
    """
    results = mock_db.filter_journeys(
        plate=plate,
        driver=driver,
        from_date=from_date,
        to_date=to_date,
        status=status,
    )
    
    if not include_trips:
        for j in results:
            j.pop("trips", None)
    
    return {"journeys": results}


@router.get("/journeys/{journey_id}")
async def get_journey_detail(journey_id: int):
    """Get detailed information about a specific journey including all trip legs."""
    journey = next((j for j in mock_db.journeys if j.id == journey_id), None)
    if not journey:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Journey {journey_id} not found")
    return mock_db._journey_to_dict(journey)


@router.get("/journeys/{journey_id}/trips")
async def get_journey_trips(journey_id: int):
    """Get all trip legs within a specific journey."""
    journey = next((j for j in mock_db.journeys if j.id == journey_id), None)
    if not journey:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Journey {journey_id} not found")
    
    return {
        "journey_id": journey_id,
        "trip_count": len(journey.trips),
        "trips": [{
            "id": trip.id,
            "origin": trip.origin,
            "destination": trip.destination,
            "distance_km": trip.distance_km,
            "departure_date": str(trip.departure_date),
            "arrival_date": str(trip.arrival_date) if trip.arrival_date else None,
            "status": trip.status,
            "revenue": trip.revenue,
            "expense": trip.expense,
        } for trip in journey.trips]
    }


@router.get("/journeys/{journey_id}/timeline")
async def get_journey_timeline(journey_id: int):
    """Get timeline entries for a specific journey (all trip legs combined)."""
    from app.mock_data import MockTimelineEntry
    
    journey = next((j for j in mock_db.journeys if j.id == journey_id), None)
    if not journey:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Journey {journey_id} not found")
    
    timeline = []
    for trip in journey.trips:
        timeline.append({
            "timestamp": trip.departure_date.strftime("%Y-%m-%dT%H:%M:%S"),
            "location": trip.origin,
            "source": "Odoo",
            "discrepancy_flag": False,
            "note": f"Departed from {trip.origin}",
        })
        if trip.status in ["completed", "in_progress"]:
            timeline.append({
                "timestamp": str(trip.arrival_date) + "T00:00:00" if trip.arrival_date else trip.departure_date.strftime("%Y-%m-%dT%H:%M:%S"),
                "location": trip.destination,
                "source": "GPS",
                "discrepancy_flag": False,
                "note": f"Arrived at {trip.destination}",
            })
    return {
        "journey_id": journey_id,
        "timeline": timeline,
    }