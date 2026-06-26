"""Dashboard router with real Odoo snapshot data and fast mock-data mode."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import get_session
from app.mock_data import mock_db, MockDatabase

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

    # 1. Total Approved Revenue (from trip_receivable)
    total_revenue_res = await db.execute(text("""
        SELECT COALESCE(SUM(amount), 0) as total
        FROM trip_receivable
        WHERE state IN ('confirmed', 'approved')
    """))
    total_revenue = total_revenue_res.scalar()

    # 2. Total Approved Expenses (from trip_payment_request)
    total_expense_res = await db.execute(text("""
        SELECT COALESCE(SUM(amount), 0) as total
        FROM trip_payment_request
        WHERE state IN ('confirmed', 'approved')
    """))
    total_expense = total_expense_res.scalar()

    # Totals
    total_vehicles = await db.execute(text("SELECT COUNT(*) as count FROM fleet_vehicle WHERE active = true"))
    total_trips = await db.execute(text("SELECT COUNT(*) as count FROM trip_trip"))

    return {
        "summary": {
            "total_vehicles": total_vehicles.fetchone().count,
            "total_trips": total_trips.fetchone().count,
            "total_revenue": total_revenue,
            "total_expense": total_expense,
        },
        "vehicles_by_brand": brands,
        "trips_by_state": trip_states,
        "recent_trips": recent_trips,
    }


@router.get("/full")
async def get_full_dashboard(
    mode: str = Query("live", description="'live' for real Odoo DB, 'demo' for mock data"),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Return full dashboard data in a single call. Fast in demo mode."""

    if mode == "live":
        try:
            return await _get_live_dashboard(db)
        except Exception as e:
            # If live DB fails, fall back to demo data
            return {**mock_db.get_full_dashboard(), "_warning": f"Live DB unavailable ({str(e)[:80]}), showing demo data."}

    return mock_db.get_full_dashboard()


async def _get_live_dashboard(db: AsyncSession) -> dict:
    """Get dashboard data from real Odoo DB."""

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

    # 1. Total Approved Revenue (from trip_receivable)
    total_revenue_res = await db.execute(text("""
        SELECT COALESCE(SUM(amount), 0) as total
        FROM trip_receivable
        WHERE state IN ('confirmed', 'approved')
    """))
    total_revenue = total_revenue_res.scalar()

    # 2. Total Approved Expenses (from trip_payment_request)
    total_expense_res = await db.execute(text("""
        SELECT COALESCE(SUM(amount), 0) as total
        FROM trip_payment_request
        WHERE state IN ('confirmed', 'approved')
    """))
    total_expense = total_expense_res.scalar()

    # Totals
    total_vehicles = await db.execute(text("SELECT COUNT(*) as count FROM fleet_vehicle WHERE active = true"))
    total_trips = await db.execute(text("SELECT COUNT(*) as count FROM trip_trip"))

    return {
        "summary": {
            "total_vehicles": total_vehicles.fetchone().count,
            "total_trips": total_trips.fetchone().count,
            "total_revenue": total_revenue,
            "total_expense": total_expense,
        },
        "vehicles_by_brand": brands,
        "trips_by_state": trip_states,
        "recent_trips": recent_trips,
    }


@router.post("/seed")
async def seed_mock_data() -> dict:
    """Regenerate mock demo data."""
    global mock_db
    mock_db = MockDatabase()
    return {"status": "ok", "message": f"Seeded {len(mock_db.trips)} trips, {len(mock_db.vehicles)} vehicles, {len(mock_db.drivers)} drivers"}


@router.get("/vehicles")
async def get_mock_vehicles(
    mode: str = Query("demo", description="'demo' for mock data, 'live' for real Odoo DB"),
) -> list[dict]:
    """Return all vehicles. Fast in demo mode."""
    if mode == "demo":
        return mock_db.get_all_vehicles()
    raise NotImplementedError("Live vehicle list not yet implemented")
