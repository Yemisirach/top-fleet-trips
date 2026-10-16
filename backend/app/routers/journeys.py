from __future__ import annotations

import json
from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.server_cache import cache_get, cache_set
from app.core.database import get_session
from app.services.journey_assembly import build_journeys, fetch_trip_rows, journeys_status_summary

router = APIRouter()


def _find_journey(journeys: list[dict], journey_id: str) -> dict | None:
    journey_key = str(journey_id)
    for journey in journeys:
        if str(journey.get("id")) == journey_key:
            return journey
    if journey_key.isdigit():
        numeric_id = int(journey_key)
        for journey in journeys:
            if any(str(leg.get("id")) == journey_key for leg in journey.get("trips", [])):
                return journey
            if journey.get("vehicle_id") == numeric_id:
                return journey
    return None


def _iso(value: Any) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else value


def _parse_snapshot(raw_snapshot: Any) -> dict:
    if isinstance(raw_snapshot, dict):
        return raw_snapshot
    if not raw_snapshot:
        return {}
    try:
        parsed = json.loads(raw_snapshot)
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def _format_db_timeline_entry(row: dict) -> dict:
    snapshot = _parse_snapshot(row.get("snapshot_json"))
    changed_fields = snapshot.get("changed_fields") or []
    location = (
        snapshot.get("current_location_name")
        or snapshot.get("destination_name")
        or snapshot.get("departure_name")
        or "Unknown location"
    )
    change_type = row.get("change_type") or "timeline"
    note_bits = [f"{row.get('trip_reference') or 'Trip'} {change_type}"]
    if changed_fields:
        note_bits.append(f"changed: {', '.join(map(str, changed_fields))}")
    if snapshot.get("state"):
        note_bits.append(f"state: {snapshot['state']}")

    return {
        "timestamp": _iso(row.get("change_time") or row.get("create_date") or row.get("write_date")),
        "location": location,
        "source": "Odoo timeline",
        "discrepancy_flag": False,
        "note": " | ".join(note_bits),
        "trip_id": row.get("trip_id"),
        "timeline_entry_id": row.get("entry_id"),
        "version_number": row.get("version_number"),
    }


async def _fetch_db_timeline_entries(db: AsyncSession, trip_ids: list[int]) -> list[dict]:
    if not trip_ids:
        return []

    query = text(
        """
        SELECT
            tl.trip_id,
            tl.trip_reference,
            tl.status AS timeline_status,
            te.id AS entry_id,
            te.version_number,
            te.name,
            te.change_time,
            te.changed_by,
            te.change_type,
            te.snapshot_json,
            te.create_date,
            te.write_date
        FROM trip_timeline tl
        JOIN trip_timeline_entry te ON te.timeline_id = tl.id
        WHERE tl.trip_id IN :trip_ids
        ORDER BY COALESCE(te.change_time, te.create_date, te.write_date) ASC NULLS LAST, te.id ASC
        """
    ).bindparams(bindparam("trip_ids", expanding=True))
    result = await db.execute(query, {"trip_ids": trip_ids})
    return [_format_db_timeline_entry(dict(row._mapping)) for row in result.fetchall()]


@router.get("/journeys")
async def get_journeys(
    plate: Optional[str] = Query(None, description="Filter by vehicle plate number (partial match)"),
    driver: Optional[str] = Query(None, description="Filter by driver name (partial match)"),
    from_date: Optional[date] = Query(None, description="Filter by departure date >= YYYY-MM-DD"),
    to_date: Optional[date] = Query(None, description="Filter by departure date <= YYYY-MM-DD"),
    status: Optional[str] = Query(None, description="Filter by journey status"),
    include_trips: bool = Query(True, description="Include individual trip legs in response"),
    refresh: bool = Query(False),
    db: AsyncSession = Depends(get_session),
):
    """Return grouped journeys derived from raw Odoo trips."""
    cache_key = f"fleet:journeys:list:{plate or ''}:{driver or ''}:{from_date or ''}:{to_date or ''}:{status or ''}:{include_trips}"
    if not refresh:
        cached = cache_get(cache_key)
        if cached:
            return cached

    rows = await fetch_trip_rows(
        db,
        plate=plate,
        driver=driver,
        from_date=from_date,
        to_date=to_date,
    )
    journeys = build_journeys(rows)
    if status:
        journeys = [journey for journey in journeys if str(journey.get("status", "")).lower() == status.lower()]

    if not include_trips:
        for journey in journeys:
            journey.pop("trips", None)

    response = {
        "journeys": journeys,
        "journeys_by_status": journeys_status_summary(journeys),
    }
    cache_set(cache_key, response)
    return response


@router.get("/journeys/{journey_id}")
async def get_journey_detail(
    journey_id: str,
    refresh: bool = Query(False),
    db: AsyncSession = Depends(get_session),
):
    """Get detailed information about a specific journey."""
    cache_key = f"fleet:journeys:detail:{journey_id}"
    if not refresh:
        cached = cache_get(cache_key)
        if cached:
            return cached

    journeys = build_journeys(await fetch_trip_rows(db, limit=500))
    journey = _find_journey(journeys, journey_id)
    if not journey:
        journeys = build_journeys(await fetch_trip_rows(db))
        journey = _find_journey(journeys, journey_id)
    if not journey:
        raise HTTPException(status_code=404, detail=f"Journey {journey_id} not found")
    cache_set(cache_key, journey)
    return journey


@router.get("/journeys/{journey_id}/trips")
async def get_journey_trips(
    journey_id: str,
    refresh: bool = Query(False),
    db: AsyncSession = Depends(get_session),
):
    """Get all trip legs within a specific journey."""
    cache_key = f"fleet:journeys:trips:{journey_id}"
    if not refresh:
        cached = cache_get(cache_key)
        if cached:
            return cached

    journeys = build_journeys(await fetch_trip_rows(db, limit=500))
    journey = _find_journey(journeys, journey_id)
    if not journey:
        journeys = build_journeys(await fetch_trip_rows(db))
        journey = _find_journey(journeys, journey_id)
    if not journey:
        raise HTTPException(status_code=404, detail=f"Journey {journey_id} not found")
    response = {
        "journey_id": journey_id,
        "trip_count": len(journey.get("trips", [])),
        "trips": journey.get("trips", []),
    }
    cache_set(cache_key, response)
    return response


@router.get("/journeys/{journey_id}/timeline")
async def get_journey_timeline(
    journey_id: str,
    refresh: bool = Query(False),
    db: AsyncSession = Depends(get_session),
):
    """Get timeline entries for a specific journey (all trip legs combined)."""
    cache_key = f"fleet:journeys:timeline:{journey_id}"
    if not refresh:
        cached = cache_get(cache_key)
        if cached:
            return cached

    journeys = build_journeys(await fetch_trip_rows(db, limit=500))
    journey = _find_journey(journeys, journey_id)
    if not journey:
        journeys = build_journeys(await fetch_trip_rows(db))
        journey = _find_journey(journeys, journey_id)
    if not journey:
        raise HTTPException(status_code=404, detail=f"Journey {journey_id} not found")

    trips = journey.get("trips", [])
    if not trips:
        response = {"journey_id": journey_id, "timeline": []}
        cache_set(cache_key, response)
        return response

    journey_start = journey.get("journey_start") or "Origin not set"
    journey_end = journey.get("journey_end") or "Return location not set"
    vehicle_label = journey.get("vehicle_plate") or journey.get("vehicle_id") or journey_id
    driver_label = journey.get("driver_name") or "unassigned driver"

    timeline = [
        {
            "timestamp": trips[0].get("departure_date"),
            "location": journey_start,
            "source": "Odoo",
            "discrepancy_flag": False,
            "note": f"Journey opened for {vehicle_label} with {driver_label}",
        }
    ]

    trip_ids = [int(leg["id"]) for leg in trips if str(leg.get("id") or "").isdigit()]
    timeline.extend(await _fetch_db_timeline_entries(db, trip_ids))

    for leg in trips:
        revenue = float(leg.get("revenue") or 0)
        expense = float(leg.get("expense") or 0)
        timeline.append(
            {
                "timestamp": leg.get("departure_date"),
                "location": leg.get("origin") or journey_start,
                "source": "Odoo",
                "discrepancy_flag": False,
                "note": (
                    f"Trip leg {leg.get('origin') or journey_start} -> {leg.get('destination') or 'Destination not set'}. "
                    f"Revenue ETB {revenue:,.0f}. Expense ETB {expense:,.0f}. State: {leg.get('status') or 'draft'}"
                ),
            }
        )

    if journey.get("journey_ended_at_factory"):
        timeline.append(
            {
                "timestamp": journey.get("arrival_date"),
                "location": journey_end,
                "source": "Odoo",
                "discrepancy_flag": False,
                "note": f"Journey completed and returned to {journey_end}.",
            }
        )
    else:
        timeline.append(
            {
                "timestamp": None,
                "location": journey_end,
                "source": "Odoo",
                "discrepancy_flag": False,
                "note": f"Journey ends when the vehicle returns to {journey_end}.",
            }
        )

    def sort_key(entry: dict) -> tuple[bool, str]:
        timestamp = entry.get("timestamp")
        return (timestamp is None, str(timestamp or ""))

    response = {"journey_id": journey_id, "timeline": sorted(timeline, key=sort_key)}
    cache_set(cache_key, response)
    return response
