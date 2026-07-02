from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import date
from typing import Optional
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_session
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
        raise HTTPException(status_code=404, detail=f"Journey {journey_id} not found")
    return mock_db._journey_to_dict(journey)


@router.get("/journeys/{journey_id}/trips")
async def get_journey_trips(journey_id: int):
    """Get all trip legs within a specific journey."""
    journey = next((j for j in mock_db.journeys if j.id == journey_id), None)
    if not journey:
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
async def get_journey_timeline(
    journey_id: int,
    db: AsyncSession = Depends(get_session),
):
    """Get timeline entries for a specific journey (all trip legs combined)."""
    journey = next((j for j in mock_db.journeys if j.id == journey_id), None)
    if journey:
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

    result = await db.execute(text("""
        WITH receivables AS (
            SELECT trip_id, COALESCE(SUM(amount_due), 0) AS total_revenue
            FROM trip_receivable
            GROUP BY trip_id
        ),
        payment_requests AS (
            SELECT
                pr.trip_id,
                COALESCE(SUM(COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), pr.amount_birr, pr.amount, 0)), 0) AS requested_amount
            FROM payment_request pr
            LEFT JOIN payment_request_line prl ON prl.payment_request_id = pr.id
            WHERE COALESCE(pr.is_trip_payment, false) = true
            GROUP BY pr.trip_id
        ),
        trip_expenses AS (
            SELECT
                trip_id,
                COALESCE(SUM(COALESCE(total_expense, amount * COALESCE(quantity, 1), 0)), 0) AS total_expense
            FROM trip_expense_line
            GROUP BY trip_id
        )
        SELECT
            t.id,
            t.name,
            t.state,
            t.departure_date,
            departure.name AS departure_name,
            destination.name AS destination_name,
            v.license_plate,
            driver.name AS driver_name,
            COALESCE(r.total_revenue, 0) AS total_revenue,
            COALESCE(te.total_expense, pr.requested_amount, 0) AS total_expense
        FROM trip_trip t
        LEFT JOIN trip_location departure ON t.departure_id = departure.id
        LEFT JOIN trip_location destination ON t.destination_id = destination.id
        LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
        LEFT JOIN hr_employee driver ON t.driver_id = driver.id
        LEFT JOIN receivables r ON r.trip_id = t.id
        LEFT JOIN payment_requests pr ON pr.trip_id = t.id
        LEFT JOIN trip_expenses te ON te.trip_id = t.id
        WHERE t.id = :journey_id
    """), {"journey_id": journey_id})
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Journey {journey_id} not found")

    departure = row.departure_name or "Departure pending"
    destination = row.destination_name or row.name or "Destination pending"
    timestamp = row.departure_date.isoformat() if row.departure_date else None
    revenue = float(row.total_revenue or 0)
    expense = float(row.total_expense or 0)
    timeline = [
        {
            "timestamp": timestamp,
            "location": "TOP Factory",
            "source": "Odoo",
            "discrepancy_flag": False,
            "note": f"Journey opened for {row.license_plate or 'vehicle'} with {row.driver_name or 'unassigned driver'}",
        },
        {
            "timestamp": timestamp,
            "location": destination,
            "source": "Odoo",
            "discrepancy_flag": False,
            "note": f"Trip leg {departure} -> {destination}. Revenue ETB {revenue:,.0f}. Expense ETB {expense:,.0f}. State: {row.state or 'draft'}",
        },
        {
            "timestamp": None,
            "location": "TOP Factory",
            "source": "Odoo",
            "discrepancy_flag": False,
            "note": "Journey ends when the vehicle returns to TOP Factory.",
        },
    ]
    return {"journey_id": journey_id, "timeline": timeline}
