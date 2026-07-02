"""Dashboard router with real Odoo snapshot data and fast mock-data mode."""

import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
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


def _as_float(value) -> float:
    return float(value or 0)


def _gps_coord(gps: dict, *keys: str):
    for key in keys:
        value = gps.get(key)
        if value is not None:
            return value
    return None


def _plate_match_key(value: Optional[str]) -> tuple[str, str]:
    raw = (value or "").upper().replace(" ", "-")
    numbers = re.findall(r"\d+", raw)
    primary_numbers = [part for part in numbers if len(part) >= 4]
    digits = (primary_numbers[0] if primary_numbers else (numbers[0] if numbers else "")).lstrip("0")
    return "", digits


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
        "_mode": "live",
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


def _read_gps_from_redis(vehicle_ref: str) -> Optional[dict]:
    if redis_client is None:
        return None
    if not vehicle_ref:
        return None
    ref = str(vehicle_ref).strip()
    keys = [
        f"fleet:gps:{ref}",
        f"fleet:gps:{ref.upper()}",
        f"fleet:gps:{ref.replace(' ', '').upper()}",
        f"fleet:gps:{ref.replace('-', '').upper()}",
    ]
    try:
        redis = redis_client.Redis.from_url(settings.redis_url, decode_responses=True)
        for key in keys:
            raw = redis.get(key)
            if not raw:
                continue
            data = json.loads(raw)
            if isinstance(data, dict):
                return data | {"_source": key}
        # Fallback to Mayet vehicle catalog
        catalog = _read_mayet_vehicle_catalog()
        if catalog:
            target_key = _plate_match_key(ref)
            matches = [
                item for item in catalog.get("vehicles", [])
                if _plate_match_key(str(item.get("plate") or "")) == target_key
            ]
            if len(matches) == 1:
                return matches[0] | {"_source": "fleet:mayet:vehicles"}
    except Exception:
        return None
    return None


def _read_mayet_vehicle_catalog() -> Optional[dict]:
    if redis_client is None:
        return None
    try:
        redis = redis_client.Redis.from_url(settings.redis_url, decode_responses=True)
        raw = redis.get("fleet:mayet:vehicles")
        if not raw:
            return None
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


@router.get("/gps/{vehicle_ref}")
async def get_vehicle_gps(vehicle_ref: str) -> dict:
    """Return the latest GPS position cached by the Mayet worker."""
    gps = _read_gps_from_redis(vehicle_ref)
    if gps:
        return {
            "configured": True,
            "vehicle_ref": vehicle_ref,
            "mayet_url": settings.mayet_url,
            "gps": gps,
        }
    return {
        "configured": bool(settings.mayet_username and settings.mayet_password),
        "vehicle_ref": vehicle_ref,
        "mayet_url": settings.mayet_url,
        "gps": None,
        "message": "No cached Mayet GPS position found for this vehicle.",
    }


@router.get("/mayet/vehicles")
async def get_mayet_vehicle_catalog() -> dict:
    """Return the latest Mayet vehicle catalog cached by the GPS worker."""
    catalog = _read_mayet_vehicle_catalog()
    if catalog:
        return {"configured": True, **catalog}
    return {
        "configured": bool(settings.mayet_username and settings.mayet_password),
        "count": 0,
        "vehicles": [],
        "message": "No Mayet vehicle catalog cache found. Run the Mayet worker with MAYET_PLATES empty to scrape all vehicles.",
    }


@router.get("/vehicle-history/{vehicle_ref}")
async def get_vehicle_history(
    vehicle_ref: str,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Return recent trip history for a selected vehicle plate/id."""
    plate_number = _plate_match_key(vehicle_ref)[1]
    result = await db.execute(text("""
        SELECT id, name, license_plate
        FROM fleet_vehicle
        WHERE CAST(id AS text) = :vehicle_ref
           OR COALESCE(license_plate, '') ILIKE :plate_like
           OR regexp_replace(COALESCE(license_plate, ''), '[^0-9]', '', 'g') LIKE :number_like
        ORDER BY
            CASE WHEN COALESCE(license_plate, '') = :vehicle_ref THEN 0 ELSE 1 END,
            id
        LIMIT 1
    """), {
        "vehicle_ref": vehicle_ref,
        "plate_like": f"%{vehicle_ref}%",
        "number_like": f"{plate_number}%" if plate_number else "%",
    })
    vehicle = result.fetchone()
    if not vehicle:
        return {"vehicle_ref": vehicle_ref, "vehicle": None, "history": []}

    history_result = await db.execute(text("""
        SELECT
            t.id,
            t.name,
            t.state,
            t.departure_date,
            t.arrival_date,
            departure.name AS departure_name,
            destination.name AS destination_name,
            driver.name AS driver_name
        FROM trip_trip t
        LEFT JOIN trip_location departure ON t.departure_id = departure.id
        LEFT JOIN trip_location destination ON t.destination_id = destination.id
        LEFT JOIN hr_employee driver ON t.driver_id = driver.id
        WHERE t.vehicle_id = :vehicle_id
        ORDER BY COALESCE(t.departure_date, t.create_date) DESC
        LIMIT 20
    """), {"vehicle_id": vehicle.id})
    gps = _read_gps_from_redis(vehicle.license_plate or vehicle_ref)
    return {
        "vehicle_ref": vehicle_ref,
        "vehicle": {
            "id": vehicle.id,
            "name": vehicle.name,
            "license_plate": vehicle.license_plate,
            "mayet_status": gps.get("location") if gps else None,
            "mayet_captured_at": gps.get("captured_at") if gps else None,
        },
        "history": [
            {
                "id": row.id,
                "name": row.name,
                "state": row.state,
                "departure_date": str(row.departure_date) if row.departure_date else None,
                "arrival_date": str(row.arrival_date) if row.arrival_date else None,
                "departure_name": row.departure_name,
                "destination_name": row.destination_name,
                "driver_name": row.driver_name,
            }
            for row in history_result.fetchall()
        ],
    }


@router.get("/snapshot")
async def get_snapshot(db: AsyncSession = Depends(get_session)) -> dict:
    """Build a comprehensive dashboard snapshot from Odoo data."""
    return await _get_live_dashboard(db)


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
            snapshot = _load_live_snapshot()
            if snapshot is not None:
                return {
                    **snapshot,
                    "_warning": f"Live DB timed out after {settings.db_query_timeout_seconds:g}s. Showing cached live snapshot.",
                }
            raise HTTPException(
                status_code=503,
                detail=f"Live DB timed out after {settings.db_query_timeout_seconds:g}s and no live snapshot is available.",
            )
        except Exception as e:
            snapshot = _load_live_snapshot()
            if snapshot is not None:
                return {
                    **snapshot,
                    "_warning": f"Live DB unavailable ({str(e)[:80]}). Showing cached live snapshot.",
                }
            raise HTTPException(
                status_code=503,
                detail=f"Live DB unavailable ({str(e)[:120]}) and no live snapshot is available.",
            )

    if mode == "demo":
        return _get_mock_dashboard()

    raise HTTPException(status_code=400, detail="mode must be 'live' or 'demo'")


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

    payment_summary_result = await db.execute(text("""
        WITH receivables AS (
            SELECT
                trip_id,
                amount_due,
                state,
                payment_reference
            FROM trip_receivable
            WHERE trip_id IS NOT NULL
        ),
        payment_request_lines AS (
            SELECT
                pr.trip_id,
                pr.state,
                COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), pr.amount_birr, pr.amount, 0) AS amount
            FROM payment_request pr
            LEFT JOIN payment_request_line prl ON prl.payment_request_id = pr.id
            WHERE pr.trip_id IS NOT NULL
              AND COALESCE(pr.is_trip_payment, false) = true
        ),
        trip_expenses AS (
            SELECT
                trip_id,
                COALESCE(SUM(COALESCE(total_expense, amount * COALESCE(quantity, 1), 0)), 0) AS amount
            FROM trip_expense_line
            GROUP BY trip_id
        )
        SELECT
            COALESCE(SUM(r.amount_due), 0) AS receivable_total,
            COALESCE(SUM(
                CASE
                    WHEN LOWER(COALESCE(r.state, '')) IN ('paid', 'done', 'posted', 'reconciled')
                         OR COALESCE(r.payment_reference, '') <> ''
                    THEN r.amount_due
                    ELSE 0
                END
            ), 0) AS customer_paid_total,
            COALESCE(SUM(
                CASE
                    WHEN LOWER(COALESCE(r.state, '')) IN ('paid', 'done', 'posted', 'reconciled')
                         OR COALESCE(r.payment_reference, '') <> ''
                    THEN 0
                    ELSE r.amount_due
                END
            ), 0) AS customer_pending_total,
            COUNT(DISTINCT r.trip_id) AS receivable_trip_count,
            (SELECT COALESCE(SUM(amount), 0) FROM trip_expenses) AS expense_total,
            (SELECT COALESCE(SUM(amount), 0) FROM payment_request_lines) AS payment_request_total,
            (SELECT COALESCE(SUM(CASE WHEN LOWER(COALESCE(state, '')) IN ('paid', 'done', 'posted') THEN amount ELSE 0 END), 0) FROM payment_request_lines) AS vendor_paid_total,
            (SELECT COALESCE(SUM(CASE WHEN LOWER(COALESCE(state, '')) IN ('paid', 'done', 'posted') THEN 0 ELSE amount END), 0) FROM payment_request_lines) AS vendor_pending_total,
            (SELECT COUNT(DISTINCT trip_id) FROM payment_request_lines) AS payment_request_trip_count
        FROM receivables r
    """))
    payment_summary_row = payment_summary_result.fetchone()
    payment_summary = {
        "receivable_total": _as_float(payment_summary_row.receivable_total),
        "customer_paid_total": _as_float(payment_summary_row.customer_paid_total),
        "customer_pending_total": _as_float(payment_summary_row.customer_pending_total),
        "receivable_trip_count": payment_summary_row.receivable_trip_count or 0,
        "expense_total": _as_float(payment_summary_row.expense_total),
        "payment_request_total": _as_float(payment_summary_row.payment_request_total),
        "vendor_paid_total": _as_float(payment_summary_row.vendor_paid_total),
        "vendor_pending_total": _as_float(payment_summary_row.vendor_pending_total),
        "payment_request_trip_count": payment_summary_row.payment_request_trip_count or 0,
    }

    # Recent trips
    recent_trips_result = await db.execute(text("""
        WITH receivables AS (
            SELECT
                trip_id,
                COALESCE(SUM(amount_due), 0) AS total_receivable,
                COALESCE(SUM(
                    CASE
                        WHEN LOWER(COALESCE(state, '')) IN ('paid', 'done', 'posted', 'reconciled')
                             OR COALESCE(payment_reference, '') <> ''
                        THEN amount_due
                        ELSE 0
                    END
                ), 0) AS paid_amount,
                COALESCE(SUM(
                    CASE
                        WHEN LOWER(COALESCE(state, '')) IN ('paid', 'done', 'posted', 'reconciled')
                             OR COALESCE(payment_reference, '') <> ''
                        THEN 0
                        ELSE amount_due
                    END
                ), 0) AS pending_amount,
                COUNT(*) AS receivable_count,
                MAX(customer_name) AS customer_name
            FROM trip_receivable
            GROUP BY trip_id
        ),
        payment_requests AS (
            SELECT
                pr.trip_id,
                COALESCE(SUM(COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), pr.amount_birr, pr.amount, 0)), 0) AS requested_amount,
                COALESCE(SUM(
                    CASE
                        WHEN LOWER(COALESCE(pr.state, '')) IN ('paid', 'done', 'posted')
                        THEN COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), pr.amount_birr, pr.amount, 0)
                        ELSE 0
                    END
                ), 0) AS paid_expense_amount,
                COALESCE(SUM(
                    CASE
                        WHEN LOWER(COALESCE(pr.state, '')) IN ('paid', 'done', 'posted')
                        THEN 0
                        ELSE COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), pr.amount_birr, pr.amount, 0)
                    END
                ), 0) AS pending_expense_amount,
                COUNT(DISTINCT pr.id) AS payment_request_count
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
        SELECT t.id, t.name, t.state, t.departure_date,
               v.license_plate, m.name as model, b.name as brand,
               driver.name as driver_name,
               departure.name as departure_name,
               destination.name as destination_name,
               COALESCE(r.customer_name, 'Customer') as customer_name,
               COALESCE(r.total_receivable, 0) as total_receivable,
               COALESCE(r.paid_amount, 0) as paid_amount,
               COALESCE(r.pending_amount, 0) as pending_amount,
               COALESCE(te.total_expense, pr.requested_amount, 0) as total_expense,
               COALESCE(pr.requested_amount, 0) as payment_request_total,
               COALESCE(pr.paid_expense_amount, 0) as paid_expense_amount,
               COALESCE(pr.pending_expense_amount, 0) as pending_expense_amount,
               COALESCE(r.receivable_count, 0) as order_receivable_count,
               COALESCE(pr.payment_request_count, 0) as payment_request_count
        FROM trip_trip t
        LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
        LEFT JOIN fleet_vehicle_model m ON v.model_id = m.id
        LEFT JOIN fleet_vehicle_model_brand b ON m.brand_id = b.id
        LEFT JOIN hr_employee driver ON t.driver_id = driver.id
        LEFT JOIN trip_location departure ON t.departure_id = departure.id
        LEFT JOIN trip_location destination ON t.destination_id = destination.id
        LEFT JOIN receivables r ON r.trip_id = t.id
        LEFT JOIN payment_requests pr ON pr.trip_id = t.id
        LEFT JOIN trip_expenses te ON te.trip_id = t.id
        ORDER BY t.create_date DESC
        LIMIT 50
    """))
    recent_journeys = []
    for row in recent_trips_result.fetchall():
        origin = row.departure_name or "TOP Factory"
        destination = row.destination_name or row.name or "Destination pending"
        revenue = _as_float(row.total_receivable)
        expense = _as_float(row.total_expense)
        departure_date = str(row.departure_date) if row.departure_date else None
        recent_journeys.append({
            "id": row.id,
            "vehicle_plate": row.license_plate,
            "vehicle_brand": row.brand or row.model,
            "driver_name": row.driver_name or "Unassigned",
            "customer_name": row.customer_name,
            "origin": origin,
            "journey_start": "TOP Factory",
            "journey_end": "TOP Factory",
            "destinations": [destination] if destination else [],
            "status": row.state,
            "departure_date": departure_date,
            "total_revenue": revenue,
            "total_expense": expense,
            "paid_amount": _as_float(row.paid_amount),
            "pending_payment": _as_float(row.pending_amount),
            "payment_request_total": _as_float(row.payment_request_total),
            "paid_expense_amount": _as_float(row.paid_expense_amount),
            "pending_expense_payment": _as_float(row.pending_expense_amount),
            "order_receivable_count": row.order_receivable_count or 0,
            "payment_request_count": row.payment_request_count or 0,
            "order_count": max(row.order_receivable_count or 0, row.payment_request_count or 0, 1),
            "trip_count": 1,
            "trips": [
                {
                    "id": row.id,
                    "name": row.name,
                    "origin": origin,
                    "destination": destination,
                    "departure_date": departure_date,
                    "arrival_date": None,
                    "status": row.state,
                    "revenue": revenue,
                    "expense": expense,
                    "paid_amount": _as_float(row.paid_amount),
                    "pending_payment": _as_float(row.pending_amount),
                    "payment_request_total": _as_float(row.payment_request_total),
                }
            ],
        })
    for journey in recent_journeys:
        gps = _read_gps_from_redis(str(journey.get("vehicle_plate") or ""))
        if gps:
            journey["mayet_status"] = gps.get("location") or gps.get("status")
            journey["mayet_captured_at"] = gps.get("captured_at")
            journey["mayet_latitude"] = _gps_coord(gps, "latitude", "lat")
            journey["mayet_longitude"] = _gps_coord(gps, "longitude", "lng", "lon")

    total_revenue = payment_summary["receivable_total"]
    total_expense = payment_summary["expense_total"] or payment_summary["payment_request_total"]

    # Totals
    total_vehicles = await db.execute(text("SELECT COUNT(*) as count FROM fleet_vehicle WHERE active = true"))
    total_trips = await db.execute(text("SELECT COUNT(*) as count FROM trip_trip"))
    active_trips = await db.execute(text("SELECT COUNT(*) as count FROM trip_trip WHERE COALESCE(state, '') NOT IN ('done', 'cancel', 'cancelled')"))
    total_drivers = await db.execute(text("SELECT COUNT(*) as count FROM hr_employee WHERE active = true"))

    active_trip_count = active_trips.fetchone().count
    total_trip_count = total_trips.fetchone().count
    profit = total_revenue - total_expense
    collection_rate = (payment_summary["customer_paid_total"] / total_revenue * 100) if total_revenue else 0
    vendor_clearance_rate = (
        payment_summary["vendor_paid_total"] / payment_summary["payment_request_total"] * 100
    ) if payment_summary["payment_request_total"] else 0
    active_trip_ratio = (active_trip_count / total_trip_count * 100) if total_trip_count else 0
    profit_margin = (profit / total_revenue * 100) if total_revenue else 0
    custom_kpis = [
        {"label": "Customer Payment Collected", "value": payment_summary["customer_paid_total"], "format": "money", "tone": "green"},
        {"label": "Pending Customer Payment", "value": payment_summary["customer_pending_total"], "format": "money", "tone": "red"},
        {"label": "Vendor Payments Cleared", "value": payment_summary["vendor_paid_total"], "format": "money", "tone": "green"},
        {"label": "Pending Vendor Payment", "value": payment_summary["vendor_pending_total"], "format": "money", "tone": "amber"},
        {"label": "Collection Rate", "value": round(collection_rate, 1), "format": "percent", "tone": "blue"},
        {"label": "Active Trip Ratio", "value": round(active_trip_ratio, 1), "format": "percent", "tone": "blue"},
    ]

    return {
        "_mode": "live",
        "summary": {
            "total_vehicles": total_vehicles.fetchone().count,
            "total_journeys": total_trip_count,
            "total_drivers": total_drivers.fetchone().count,
            "total_revenue": total_revenue,
            "total_expense": total_expense,
        },
        "vehicles_by_brand": brands,
        "journeys_by_status": trip_states,
        "recent_journeys": recent_journeys,
        "active_journey_count": active_trip_count,
        "total_revenue": total_revenue,
        "total_expense": total_expense,
        "total_profit": profit,
        "payment_summary": payment_summary,
        "custom_kpis": custom_kpis,
        "kpi_summary": {
            "collection_rate": round(collection_rate, 1),
            "vendor_clearance_rate": round(vendor_clearance_rate, 1),
            "active_trip_ratio": round(active_trip_ratio, 1),
            "profit_margin": round(profit_margin, 1),
        },
    }


@router.post("/seed")
async def seed_mock_data() -> dict:
    """Regenerate mock demo data."""
    global mock_db
    mock_db = MockDatabase()
    return {"status": "ok", "message": f"Seeded {len(mock_db.journeys)} journeys, {len(mock_db.vehicles)} vehicles, {len(mock_db.drivers)} drivers"}


@router.post("/seed-mayet-demo")
async def seed_mayet_demo() -> dict:
    """Apply cached Mayet vehicle names/statuses to demo trips."""
    catalog = _read_mayet_vehicle_catalog() or {}
    vehicles = catalog.get("vehicles", [])
    updated = mock_db.seed_mayet_vehicle_statuses(vehicles if isinstance(vehicles, list) else [])
    return {
        "status": "ok",
        "updated_demo_vehicles": updated,
        "mayet_catalog_count": len(vehicles) if isinstance(vehicles, list) else 0,
        "message": f"Seeded {updated} demo vehicles with Mayet names/statuses.",
    }


@router.get("/vehicles")
async def get_mock_vehicles(
    mode: str = Query("demo", description="'demo' for mock data, 'live' for real Odoo DB"),
) -> list[dict]:
    """Return all vehicles. Fast in demo mode."""
    if mode == "demo":
        return mock_db.get_all_vehicles()
    raise NotImplementedError("Live vehicle list not yet implemented")
