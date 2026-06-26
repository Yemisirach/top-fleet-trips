"""Dashboard router with real Odoo snapshot data and fast mock-data mode."""

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import get_session
from app.core.settings import get_settings
from app.mock_data import mock_db, MockDatabase

try:
    import redis as redis_client
except ImportError:  # pragma: no cover - optional runtime dependency
    redis_client = None

router = APIRouter()
settings = get_settings()


def _get_mock_dashboard() -> dict:
    return {**mock_db.get_full_dashboard(), "_mode": "demo", "_source": "mock"}


def _load_live_snapshot() -> Optional[dict]:
    if redis_client is not None:
        try:
            redis = redis_client.Redis.from_url(settings.redis_url, decode_responses=True)
            raw_snapshot = redis.get("fleet:snapshot")
        except Exception:
            raw_snapshot = None

        if raw_snapshot:
            snapshot = _parse_live_snapshot(raw_snapshot)
            if snapshot is not None:
                return snapshot

    path = Path(settings.snapshot_path)
    if not path.exists():
        return None

    try:
        return _parse_live_snapshot(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def _parse_live_snapshot(raw_snapshot: str) -> Optional[dict]:
    try:
        snapshot = json.loads(raw_snapshot)
    except json.JSONDecodeError:
        return None

    if snapshot.get("mode") != "live":
        return None

    data = snapshot.get("data")
    if not isinstance(data, dict):
        return None

    return {
        **data,
        "_mode": "demo",
        "_source": "live_snapshot",
        "_snapshot_generated_at": snapshot.get("generated_at"),
    }


def _write_live_snapshot(data: dict) -> None:
    snapshot = {
        "mode": "live",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }
    raw_snapshot = json.dumps(snapshot, default=str)

    if redis_client is not None:
        try:
            redis = redis_client.Redis.from_url(settings.redis_url, decode_responses=True)
            redis.set("fleet:snapshot", raw_snapshot, ex=300)
        except Exception:
            pass

    path = Path(settings.snapshot_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(raw_snapshot)


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
               v.license_plate, m.name as model, b.name as brand
        FROM trip_trip t
        LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
        LEFT JOIN fleet_vehicle_model m ON v.model_id = m.id
        LEFT JOIN fleet_vehicle_model_brand b ON m.brand_id = b.id
        ORDER BY t.create_date DESC
        LIMIT 10
    """))
    recent_journeys = [
        {
            "id": row.id,
            "vehicle_plate": row.license_plate,
            "vehicle_brand": row.brand or row.model,
            "driver_name": "Odoo",
            "origin": "Odoo trip",
            "destinations": [row.name] if row.name else [],
            "status": row.state,
            "departure_date": str(row.departure_date) if row.departure_date else None,
            "total_revenue": 0,
            "total_expense": 0,
            "trips": [],
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
    active_trips = await db.execute(text("SELECT COUNT(*) as count FROM trip_trip WHERE state NOT IN ('done', 'cancel')"))

    return {
        "_mode": "live",
        "summary": {
            "total_vehicles": total_vehicles.fetchone().count,
            "total_journeys": total_trips.fetchone().count,
            "total_drivers": 0,
            "total_revenue": total_revenue,
            "total_expense": total_expense,
        },
        "vehicles_by_brand": brands,
        "journeys_by_status": trip_states,
        "recent_journeys": recent_journeys,
        "active_journey_count": active_trips.fetchone().count,
        "total_revenue": total_revenue,
        "total_expense": total_expense,
        "total_profit": total_revenue - total_expense,
    }


@router.get("/full")
async def get_full_dashboard(
    mode: str = Query("live", description="'live' for real Odoo DB, 'demo' for mock data"),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Return full dashboard data in a single call. Fast in demo mode."""

    if mode == "live":
        try:
            data = await asyncio.wait_for(
                _get_live_dashboard(db),
                timeout=settings.db_query_timeout_seconds,
            )
            try:
                _write_live_snapshot(data)
            except OSError:
                pass
            return data
        except asyncio.TimeoutError:
            return {
                **(_load_live_snapshot() or _get_mock_dashboard()),
                "_mode": "demo",
                "_warning": f"Live DB timed out after {settings.db_query_timeout_seconds:g}s, showing demo data.",
            }
        except Exception as e:
            # If live DB fails, fall back to demo data
            return {
                **(_load_live_snapshot() or _get_mock_dashboard()),
                "_mode": "demo",
                "_warning": f"Live DB unavailable ({str(e)[:80]}), showing demo data.",
            }

    return _load_live_snapshot() or _get_mock_dashboard()


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
               v.license_plate, m.name as model, b.name as brand
        FROM trip_trip t
        LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
        LEFT JOIN fleet_vehicle_model m ON v.model_id = m.id
        LEFT JOIN fleet_vehicle_model_brand b ON m.brand_id = b.id
        ORDER BY t.create_date DESC
        LIMIT 10
    """))
    recent_journeys = [
        {
            "id": row.id,
            "vehicle_plate": row.license_plate,
            "vehicle_brand": row.brand or row.model,
            "driver_name": "Odoo",
            "origin": "Odoo trip",
            "destinations": [row.name] if row.name else [],
            "status": row.state,
            "departure_date": str(row.departure_date) if row.departure_date else None,
            "total_revenue": 0,
            "total_expense": 0,
            "trips": [],
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
    active_trips = await db.execute(text("SELECT COUNT(*) as count FROM trip_trip WHERE state NOT IN ('done', 'cancel')"))

    return {
        "_mode": "live",
        "summary": {
            "total_vehicles": total_vehicles.fetchone().count,
            "total_journeys": total_trips.fetchone().count,
            "total_drivers": 0,
            "total_revenue": total_revenue,
            "total_expense": total_expense,
        },
        "vehicles_by_brand": brands,
        "journeys_by_status": trip_states,
        "recent_journeys": recent_journeys,
        "active_journey_count": active_trips.fetchone().count,
        "total_revenue": total_revenue,
        "total_expense": total_expense,
        "total_profit": total_revenue - total_expense,
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
