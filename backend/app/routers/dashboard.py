"""Dashboard router backed by live Odoo data."""

import asyncio
import json
import re
import urllib.parse
import urllib.request
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import get_session
from app.core.server_cache import CACHE_TTL_SECONDS, cache_get, cache_get_stale, cache_set
from app.core.settings import get_settings
from app.services.journey_assembly import (
    build_journeys,
    ensure_all_vehicle_current_locations,
    fetch_trip_rows,
    fetch_vehicle_location_rows,
)

try:
    import redis as redis_client
except ImportError:  # pragma: no cover - optional runtime dependency
    redis_client = None

router = APIRouter()
settings = get_settings()
_reverse_geocode_cache: dict[str, str] = {}


def _as_float(value) -> float:
    return float(value or 0)


def _gps_coord(gps: dict, *keys: str):
    for key in keys:
        value = gps.get(key)
        if value is not None:
            return value
    return None


def _normalize_trip_state(value) -> str:
    raw = re.sub(r"\s+", " ", str(value or "")).strip().lower()
    return {
        "planned": "available",
        "in_progress": "dispatched",
        "in progress": "dispatched",
        "completed": "done",
        "cancel": "cancelled",
        "canceled": "cancelled",
    }.get(raw, raw or "draft")


def _active_vehicle_conflicts(journeys: list[dict]) -> list[dict]:
    """Detect vehicles assigned to multiple drivers (one vehicle = one driver rule)."""
    active_states = {"available", "assigned", "dispatched", "started", "draft"}
    by_vehicle: dict[str, dict] = {}

    for journey in journeys:
        vehicle = str(journey.get("vehicle_plate") or journey.get("vehicle_id") or "").strip()
        driver = str(journey.get("driver_name") or "").strip()

        if not vehicle or not driver:
            continue
        if driver.lower() in {"unassigned", "n/a"}:
            continue
        if _normalize_trip_state(journey.get("status") or journey.get("state")) not in active_states:
            continue

        row = by_vehicle.setdefault(vehicle, {
            "vehicle_plate": vehicle,
            "drivers": set(),
            "journeys": []
        })
        row["drivers"].add(driver)
        row["journeys"].append({
            "id": journey.get("id"),
            "driver_name": driver,
            "status": journey.get("status") or journey.get("state"),
            "destination": journey.get("destination"),
            "departure_date": journey.get("departure_date"),
        })

    conflicts = []
    for row in by_vehicle.values():
        if len(row["drivers"]) <= 1:
            continue
        conflicts.append({
            "vehicle_plate": row["vehicle_plate"],
            "driver_count": len(row["drivers"]),
            "drivers": sorted(row["drivers"]),
            "journey_count": len(row["journeys"]),
            "journeys": row["journeys"],
        })
    return sorted(conflicts, key=lambda item: (-item["driver_count"], item["vehicle_plate"]))


def _active_driver_conflicts(journeys: list[dict]) -> list[dict]:
    active_states = {"available", "assigned", "dispatched", "started", "draft"}
    by_driver: dict[str, dict] = {}
    for journey in journeys:
        driver = str(journey.get("driver_name") or "").strip()
        if not driver or driver.lower() in {"unassigned", "n/a"}:
            continue
        if _normalize_trip_state(journey.get("status") or journey.get("state")) not in active_states:
            continue
        row = by_driver.setdefault(driver, {"driver_name": driver, "vehicles": set(), "journeys": []})
        row["vehicles"].add(str(journey.get("vehicle_plate") or journey.get("vehicle_id") or "N/A"))
        row["journeys"].append({
            "id": journey.get("id"),
            "vehicle_plate": journey.get("vehicle_plate"),
            "status": journey.get("status") or journey.get("state"),
            "destination": journey.get("destination"),
            "departure_date": journey.get("departure_date"),
        })
    conflicts = []
    for row in by_driver.values():
        if len(row["vehicles"]) <= 1:
            continue
        conflicts.append({
            "driver_name": row["driver_name"],
            "vehicle_count": len(row["vehicles"]),
            "vehicles": sorted(row["vehicles"]),
            "journey_count": len(row["journeys"]),
            "journeys": row["journeys"],
        })
    return sorted(conflicts, key=lambda item: (-item["vehicle_count"], item["driver_name"]))


async def _fetch_active_driver_conflicts(db: AsyncSession) -> list[dict]:
    result = await db.execute(text("""
        SELECT
            driver.name AS driver_name,
            COUNT(DISTINCT t.vehicle_id) AS vehicle_count,
            COUNT(*) AS journey_count,
            array_agg(DISTINCT COALESCE(v.license_plate, t.vehicle_id::text) ORDER BY COALESCE(v.license_plate, t.vehicle_id::text)) AS vehicles,
            jsonb_agg(
                jsonb_build_object(
                    'id', t.id,
                    'vehicle_plate', COALESCE(v.license_plate, t.vehicle_id::text),
                    'status', COALESCE(t.state, 'draft'),
                    'destination', destination.name,
                    'departure_date', t.departure_date
                )
                ORDER BY COALESCE(t.departure_date, t.create_date) DESC NULLS LAST, t.id DESC
            ) AS journeys
        FROM trip_trip t
        JOIN hr_employee driver ON driver.id = t.driver_id
        LEFT JOIN fleet_vehicle v ON v.id = t.vehicle_id
        LEFT JOIN trip_location destination ON destination.id = t.destination_id
        WHERE LOWER(COALESCE(t.state, '')) IN (
            'available', 'assigned', 'dispatched', 'planned', 'in_progress', 'in progress', 'draft'
        )
        GROUP BY driver.name
        HAVING COUNT(DISTINCT t.vehicle_id) > 1
        ORDER BY vehicle_count DESC, journey_count DESC, driver.name
        LIMIT 20
    """))
    return [dict(row._mapping) for row in result.fetchall()]


def _reverse_geocode_sync(latitude, longitude) -> Optional[str]:
    try:
        lat = float(latitude)
        lon = float(longitude)
    except (TypeError, ValueError):
        return None

    key = f"{lat:.5f},{lon:.5f}"
    if key in _reverse_geocode_cache:
        return _reverse_geocode_cache[key]

    query = urllib.parse.urlencode({
        "format": "jsonv2",
        "lat": f"{lat:.6f}",
        "lon": f"{lon:.6f}",
        "zoom": "16",
        "addressdetails": "1",
    })
    request = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/reverse?{query}",
        headers={"User-Agent": "FleetTrips/1.0 (gps-location-display)"},
    )
    try:
        with urllib.request.urlopen(request, timeout=4) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        return None

    address = payload.get("display_name")
    if isinstance(address, str) and address.strip():
        _reverse_geocode_cache[key] = address.strip()
        return _reverse_geocode_cache[key]
    return None


def _is_coordinate_text(value: Optional[str]) -> bool:
    if not value:
        return False
    return bool(re.fullmatch(r"\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*", str(value)))


def _is_mayet_device_status(value: Optional[str]) -> bool:
    raw = str(value or "").strip().lower()
    return raw in {"offline", "online", "ack", "idle", "moving", "stopped", "status pending"}


def _gps_location_display(gps: Optional[dict]) -> Optional[str]:
    if not gps:
        return None
    address = str(gps.get("address") or "").strip()
    if address and not _is_coordinate_text(address) and not _is_mayet_device_status(address):
        return address
    location = str(gps.get("location") or "").strip()
    if location and not _is_coordinate_text(location) and not _is_mayet_device_status(location):
        return location
    latitude = _gps_coord(gps, "latitude", "lat")
    longitude = _gps_coord(gps, "longitude", "lng", "lon")
    if latitude is not None and longitude is not None:
        return f"{latitude}, {longitude}"
    return None


async def _enrich_gps_address(gps: Optional[dict]) -> Optional[dict]:
    if not gps:
        return gps
    enriched = dict(gps)
    if enriched.get("address") and not _is_coordinate_text(enriched.get("address")):
        return enriched
    latitude = _gps_coord(enriched, "latitude", "lat")
    longitude = _gps_coord(enriched, "longitude", "lng", "lon")
    address = await asyncio.to_thread(_reverse_geocode_sync, latitude, longitude)
    if address:
        enriched["address"] = address
    return enriched


def _plate_match_key(value: Optional[str]) -> tuple[str, str]:
    raw = (value or "").upper().replace(" ", "-")
    numbers = re.findall(r"\d+", raw)
    primary_numbers = [part for part in numbers if len(part) >= 4]
    digits = (primary_numbers[0] if primary_numbers else (numbers[0] if numbers else "")).lstrip("0")
    return "", digits


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

        target_number = _plate_match_key(ref)[1]
        if target_number:
            for key in redis.scan_iter("fleet:gps:*", count=200):
                if key == "fleet:gps:last_check":
                    continue
                cached_number = _plate_match_key(str(key).split("fleet:gps:", 1)[-1])[1]
                if cached_number != target_number:
                    continue
                raw = redis.get(key)
                if not raw:
                    continue
                data = json.loads(raw)
                if isinstance(data, dict):
                    return data | {"_source": key}
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


async def _resolve_vehicle_ref(db: AsyncSession, vehicle_ref: str) -> Optional[str]:
    ref = str(vehicle_ref or "").strip()
    if not ref:
        return None
    vehicle_part = ref.split(":", 1)[0]
    plate_number = _plate_match_key(ref)[1]
    result = await db.execute(text("""
        SELECT license_plate
        FROM (
            SELECT v.license_plate, 0 AS priority
            FROM fleet_vehicle v
            WHERE CAST(v.id AS text) IN (:vehicle_ref, :vehicle_part)
               OR COALESCE(v.license_plate, '') ILIKE :plate_like
               OR regexp_replace(COALESCE(v.license_plate, ''), '[^0-9]', '', 'g') LIKE :number_like

            UNION ALL

            SELECT v.license_plate, 1 AS priority
            FROM trip_trip t
            JOIN fleet_vehicle v ON t.vehicle_id = v.id
            WHERE CAST(t.id AS text) = :vehicle_ref
        ) matches
        WHERE COALESCE(license_plate, '') <> ''
        ORDER BY priority
        LIMIT 1
    """), {
        "vehicle_ref": ref,
        "vehicle_part": vehicle_part,
        "plate_like": f"%{ref}%",
        "number_like": f"%{plate_number}%" if plate_number else "%",
    })
    row = result.fetchone()
    return row.license_plate if row else None


@router.get("/gps/{vehicle_ref}")
async def get_vehicle_gps(
    vehicle_ref: str,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Return the latest GPS position cached by the Mayet worker."""
    direct_gps = _read_gps_from_redis(vehicle_ref)
    if direct_gps:
        return {
            "configured": True,
            "vehicle_ref": vehicle_ref,
            "resolved_ref": vehicle_ref,
            "mayet_url": settings.mayet_url,
            "gps": await _enrich_gps_address(direct_gps),
        }

    resolved_ref = None
    try:
        resolved_ref = await asyncio.wait_for(_resolve_vehicle_ref(db, vehicle_ref), timeout=3)
    except Exception:
        resolved_ref = None

    candidates = []
    for candidate in (resolved_ref, vehicle_ref):
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    for candidate in candidates:
        gps = _read_gps_from_redis(candidate)
        if gps:
            return {
                "configured": True,
                "vehicle_ref": vehicle_ref,
                "resolved_ref": candidate,
                "mayet_url": settings.mayet_url,
                "gps": await _enrich_gps_address(gps),
            }
    return {
        "configured": bool(settings.mayet_username and settings.mayet_password),
        "vehicle_ref": vehicle_ref,
        "resolved_ref": resolved_ref,
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
    mode: str = Query("live", description="Only 'live' is supported; data comes from Odoo."),
    refresh: bool = Query(False),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Return full dashboard data from Odoo in a single call."""

    if mode != "live":
        raise HTTPException(status_code=400, detail="Only live Odoo mode is supported.")

    cache_key = "fleet:dashboard:full"
    if not refresh:
        cached = cache_get(cache_key)
        if cached:
            return cached

    try:
        dashboard = await asyncio.wait_for(
            _get_live_dashboard(db),
            timeout=settings.db_query_timeout_seconds,
        )

        cache_set(cache_key, dashboard, CACHE_TTL_SECONDS)

        return dashboard
    except asyncio.TimeoutError:
        stale = cache_get_stale(cache_key)
        if stale:
            stale["_cache_warning"] = f"Live Odoo DB timed out after {settings.db_query_timeout_seconds:g}s. Showing last server cache."
            return stale
        reason = f"Live Odoo DB timed out after {settings.db_query_timeout_seconds:g}s."
        raise HTTPException(status_code=503, detail=reason)
    except Exception as e:
        stale = cache_get_stale(cache_key)
        if stale:
            stale["_cache_warning"] = f"Live Odoo DB unavailable. Showing last server cache."
            return stale
        reason = f"Live Odoo DB unavailable: {str(e)[:160]}"
        raise HTTPException(status_code=503, detail=reason)


async def _get_live_dashboard(db: AsyncSession) -> dict:
    """Get dashboard data from real Odoo DB."""

    # Vehicle counts by brand
    brand_result = await db.execute(text("""
        SELECT b.name as brand, COUNT(*) as count
        FROM fleet_vehicle v
        LEFT JOIN fleet_vehicle_model m ON v.model_id = m.id
        LEFT JOIN fleet_vehicle_model_brand b ON m.brand_id = b.id
        WHERE v.active = true
        GROUP BY b.name
        ORDER BY count DESC
        LIMIT 10
    """))
    brands = [{"brand": row.brand, "count": row.count} for row in brand_result.fetchall()]

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

    status_result = await db.execute(text("""
        SELECT
            CASE
                WHEN LOWER(COALESCE(state, '')) = 'planned' THEN 'available'
                WHEN LOWER(COALESCE(state, '')) IN ('in_progress', 'in progress') THEN 'dispatched'
                WHEN LOWER(COALESCE(state, '')) = 'completed' THEN 'done'
                WHEN LOWER(COALESCE(state, '')) IN ('cancel', 'canceled') THEN 'cancelled'
                ELSE COALESCE(NULLIF(LOWER(state), ''), 'draft')
            END AS state,
            COUNT(*) AS count
        FROM trip_trip
        GROUP BY 1
    """))
    journeys_by_status = [{"state": row.state, "count": row.count} for row in status_result.fetchall()]
    total_journey_count = sum(row["count"] for row in journeys_by_status)
    active_journey_count = sum(
        row["count"]
        for row in journeys_by_status
        if row["state"] not in {"done", "cancelled", "cancel"}
    )

    trip_rows = await fetch_trip_rows(db, limit=500)
    vehicle_location_rows = await fetch_vehicle_location_rows(db, limit=1000)
    recent_journeys = ensure_all_vehicle_current_locations(
        build_journeys(trip_rows),
        vehicle_location_rows,
    )
    supervised_vehicle_keys = {
        str(row.get("vehicle_id") or row.get("vehicle_plate") or "").strip()
        for row in vehicle_location_rows
        if row.get("supervisor_name") and (row.get("vehicle_id") or row.get("vehicle_plate"))
    }
    if supervised_vehicle_keys:
        recent_journeys = [
            journey for journey in recent_journeys
            if str(journey.get("vehicle_id") or journey.get("vehicle_plate") or "").strip() in supervised_vehicle_keys
        ]
    driver_conflicts = await _fetch_active_driver_conflicts(db)
    vehicle_conflicts = _active_vehicle_conflicts(recent_journeys)

    total_revenue = payment_summary["receivable_total"]
    total_expense = payment_summary["expense_total"] or payment_summary["payment_request_total"]

    # Totals
    total_vehicles = await db.execute(text("SELECT COUNT(*) as count FROM fleet_vehicle WHERE active = true"))
    total_drivers = await db.execute(text("SELECT COUNT(*) as count FROM hr_employee WHERE active = true"))

    profit = total_revenue - total_expense
    collection_rate = (payment_summary["customer_paid_total"] / total_revenue * 100) if total_revenue else 0
    vendor_clearance_rate = (
        payment_summary["vendor_paid_total"] / payment_summary["payment_request_total"] * 100
    ) if payment_summary["payment_request_total"] else 0
    active_trip_ratio = (active_journey_count / total_journey_count * 100) if total_journey_count else 0
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
            "total_journeys": total_journey_count,
            "total_drivers": total_drivers.fetchone().count,
            "total_revenue": total_revenue,
            "total_expense": total_expense,
        },
        "vehicles_by_brand": brands,
        "journeys_by_status": journeys_by_status,
        "recent_journeys": recent_journeys,
        "vehicle_locations": [
            {
                "vehicle_id": row.get("vehicle_id"),
                "vehicle_plate": row.get("vehicle_plate"),
                "vehicle_brand": row.get("brand") or row.get("model"),
                "supervisor_name": row.get("supervisor_name"),
                "driver_name": row.get("driver_name"),
                "trip_id": row.get("trip_id"),
                "reference": row.get("reference"),
                "state": row.get("state"),
                "departure_name": row.get("departure_name"),
                "destination_name": row.get("destination_name"),
                "current_location_name": row.get("current_location_name") or row.get("location_name"),
                "current_location_note": row.get("current_location_note"),
                "current_location_days": row.get("current_location_days") or 0,
                "departure_date": row.get("departure_date"),
                "arrival_date": row.get("arrival_date"),
                "create_date": row.get("create_date"),
                "write_date": row.get("write_date"),
            }
            for row in vehicle_location_rows
        ],
        "all_trip_rows": [
            {
                "id": row.get("id"),
                "name": row.get("name"),
                "vehicle_id": row.get("vehicle_id"),
                "vehicle_plate": row.get("license_plate"),
                "driver_name": row.get("driver_name"),
                "origin": row.get("departure_name"),
                "destination": row.get("destination_name"),
                "current_location": row.get("current_location_name"),
                "current_location_note": row.get("current_location_note"),
                "status": row.get("state"),
                "state": row.get("state"),
                "departure_date": row.get("departure_date"),
                "arrival_date": row.get("arrival_date"),
                "create_date": row.get("create_date"),
                "write_date": row.get("write_date"),
                "total_revenue": _as_float(row.get("total_revenue")),
                "total_expense": _as_float(row.get("total_expense")),
                "paid_amount": _as_float(row.get("paid_amount")),
                "pending_payment": _as_float(row.get("pending_amount")),
                "payment_request_total": _as_float(row.get("payment_request_total")),
                "payment_request_count": int(row.get("payment_request_count") or 0),
                "payment_request_lines": row.get("payment_request_lines") or [],
                "order_receivable_count": int(row.get("order_receivable_count") or 0),
            }
            for row in trip_rows
        ],
        "active_journey_count": active_journey_count,
        "driver_conflict_count": len(driver_conflicts),
        "driver_conflicts": driver_conflicts,
        "vehicle_conflict_count": len(vehicle_conflicts),
        "vehicle_conflicts": vehicle_conflicts,
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

@router.get("/vehicles")
async def get_dashboard_vehicles(
    db: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Return active fleet vehicles from Odoo."""
    result = await db.execute(text("""
        SELECT
            v.id,
            v.license_plate,
            v.name,
            m.name AS model,
            b.name AS brand,
            v.driver_id,
            v.active
        FROM fleet_vehicle v
        LEFT JOIN fleet_vehicle_model m ON v.model_id = m.id
        LEFT JOIN fleet_vehicle_model_brand b ON m.brand_id = b.id
        WHERE v.active = true
        ORDER BY COALESCE(v.license_plate, v.name, CAST(v.id AS text))
        LIMIT 1000
    """))
    return [
        {
            "id": row.id,
            "license_plate": row.license_plate,
            "name": row.name,
            "model": row.model,
            "brand": row.brand,
            "driver_id": row.driver_id,
            "active": row.active,
        }
        for row in result.fetchall()
    ]
