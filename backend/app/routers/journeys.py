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
):
    """Return all journeys with optional filtering."""
    results = mock_db.filter_journeys(
        plate=plate,
        driver=driver,
        from_date=from_date,
        to_date=to_date,
        status=status,
    )
    return {"journeys": results}
