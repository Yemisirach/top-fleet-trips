"""Dashboard router with real Odoo snapshot data."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import get_session

router = APIRouter()


@router.get("/snapshot")
async def get_snapshot(db: AsyncSession = Depends(get_session)) -> dict:
    """Build a comprehensive dashboard snapshot from Odoo data."""
    
    # Vehicle counts by brand
    brand_result = await db.execute(text("""
        SELECT b.name as brand, COUNT(*) as count
        FROM fleet_vehicle v
        JOIN fleet_vehicle_model m ON v.model_id = m.id
        JOIN fleet_vehicle_model_brand b ON m.brand_id = b.id
        WHERE v.active = true
        GROUP BY b.name
        ORDER BY count DESC
        LIMIT 10
    """))
    brands = [{"brand": row.brand, "count": row.count} for row in brand_result.fetchall()]
    
    # Trip counts by state
    trip_state_result = await db.execute(text("""
        SELECT state, COUNT(*) as count
        FROM trip_trip
        GROUP BY state
        ORDER BY count DESC
    """))
    trip_states = [{"state": row.state, "count": row.count} for row in trip_state_result.fetchall()]
    
    # Recent trips
    recent_trips_result = await db.execute(text("""
        SELECT t.id, t.name, t.state, t.departure_date,
               v.license_plate, m.name as model
        FROM trip_trip t
        LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
        LEFT JOIN fleet_vehicle_model m ON v.model_id = m.id
        ORDER BY t.create_date DESC
        LIMIT 10
    """))
    recent_trips = [
        {
            "id": row.id,
            "name": row.name,
            "state": row.state,
            "departure_date": str(row.departure_date) if row.departure_date else None,
            "license_plate": row.license_plate,
            "model": row.model,
        }
        for row in recent_trips_result.fetchall()
    ]
    
    # Total counts
    total_vehicles = await db.execute(text("SELECT COUNT(*) as count FROM fleet_vehicle WHERE active = true"))
    total_trips = await db.execute(text("SELECT COUNT(*) as count FROM trip_trip"))
    total_drivers = await db.execute(text("SELECT COUNT(DISTINCT driver_id) as count FROM fleet_vehicle WHERE driver_id IS NOT NULL"))
    
    return {
        "summary": {
            "total_vehicles": total_vehicles.fetchone().count,
            "total_trips": total_trips.fetchone().count,
            "total_drivers": total_drivers.fetchone().count,
        },
        "vehicles_by_brand": brands,
        "trips_by_state": trip_states,
        "recent_trips": recent_trips,
    }