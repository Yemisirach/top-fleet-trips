"""Limit a supervisor session to vehicles assigned to that person."""

from __future__ import annotations

import re
from typing import Any, Optional

from fastapi import HTTPException

from app.core.server_cache import cache_get, cache_get_stale


def supervisor_name(user: Optional[dict]) -> Optional[str]:
    if not user or user.get("role") != "supervisor":
        return None
    name = str(user.get("name") or user.get("username") or "").strip()
    return name or None


def names_match(left: Any, right: Any) -> bool:
    return str(left or "").strip().lower() == str(right or "").strip().lower()


def plate_key(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    return digits.lstrip("0") or digits


def tracker_key(value: Any) -> str:
    numbers = re.findall(r"\d+", str(value or ""))
    long_numbers = [part for part in numbers if len(part) >= 4]
    chosen = long_numbers[0] if long_numbers else (numbers[0] if numbers else "")
    return chosen.lstrip("0") or chosen


def _dashboard_cache() -> dict:
    for key in ("fleet:dashboard:full:v7",):
        cached = cache_get(key) or cache_get_stale(key)
        if isinstance(cached, dict):
            return cached
    return {}


def assigned_plate_keys(user: Optional[dict]) -> Optional[set[str]]:
    name = supervisor_name(user)
    if not name:
        return None
    keys: set[str] = set()
    payload = _dashboard_cache()
    for row in list(payload.get("vehicle_locations") or []) + list(payload.get("recent_journeys") or []) + list(payload.get("all_trip_rows") or []):
        if not isinstance(row, dict) or not names_match(row.get("supervisor_name"), name):
            continue
        plate = row.get("vehicle_plate") or row.get("license_plate")
        key = plate_key(plate)
        if key:
            keys.add(key)
        tracker = tracker_key(plate)
        if tracker:
            keys.add(tracker)
        vehicle_id = str(row.get("vehicle_id") or "").strip()
        if vehicle_id:
            keys.add(f"id:{vehicle_id}")
    return keys


def row_assigned(row: dict, user: Optional[dict]) -> bool:
    name = supervisor_name(user)
    if not name:
        return True
    if names_match(row.get("supervisor_name"), name):
        return True
    keys = assigned_plate_keys(user) or set()
    vehicle_id = str(row.get("vehicle_id") or "").strip()
    if vehicle_id and f"id:{vehicle_id}" in keys:
        return True
    key = plate_key(row.get("vehicle_plate") or row.get("license_plate") or row.get("plate"))
    return bool(key and key in keys)


def require_assigned_vehicle(user: Optional[dict], vehicle_ref: str) -> None:
    keys = assigned_plate_keys(user)
    if keys is None:
        return
    ref = str(vehicle_ref or "").strip()
    if ref and (plate_key(ref) in keys or f"id:{ref}" in keys or ref in keys):
        return
    raise HTTPException(status_code=404, detail="Vehicle is not assigned to this supervisor")


def scope_dashboard(payload: dict, user: Optional[dict]) -> dict:
    name = supervisor_name(user)
    if not name or not isinstance(payload, dict):
        return payload
    scoped = dict(payload)
    locations = [row for row in scoped.get("vehicle_locations") or [] if isinstance(row, dict) and row_assigned(row, user)]
    journeys = [row for row in scoped.get("recent_journeys") or [] if isinstance(row, dict) and row_assigned(row, user)]
    trips = [row for row in scoped.get("all_trip_rows") or [] if isinstance(row, dict) and row_assigned(row, user)]
    conflicts = [row for row in scoped.get("vehicle_conflicts") or [] if isinstance(row, dict) and row_assigned(row, user)]
    driver_conflicts = [row for row in scoped.get("driver_conflicts") or [] if isinstance(row, dict) and row_assigned(row, user)]
    status_counts: dict[str, int] = {}
    for row in journeys:
        state = str(row.get("state") or row.get("status") or "draft").strip().lower() or "draft"
        status_counts[state] = status_counts.get(state, 0) + 1
    revenue = sum(float(row.get("total_revenue") or 0) for row in journeys)
    expense = sum(float(row.get("total_expense") or 0) for row in journeys)
    summary = dict(scoped.get("summary") or {})
    summary.update({
        "total_vehicles": len({str(row.get("vehicle_id") or row.get("vehicle_plate")) for row in locations}) or len(locations),
        "total_journeys": len(journeys),
        "total_revenue": revenue,
        "total_expense": expense,
    })
    payment = scoped.get("payment_summary") if isinstance(scoped.get("payment_summary"), dict) else {}
    scoped.update({
        "vehicle_locations": locations,
        "recent_journeys": journeys,
        "all_trip_rows": trips,
        "vehicle_conflicts": conflicts,
        "driver_conflicts": driver_conflicts,
        "vehicle_conflict_count": len(conflicts),
        "driver_conflict_count": len(driver_conflicts),
        "journeys_by_status": [{"state": key, "count": count} for key, count in status_counts.items()],
        "active_journey_count": sum(count for state, count in status_counts.items() if state not in {"done", "cancelled", "cancel"}),
        "summary": summary,
        "total_revenue": revenue,
        "total_expense": expense,
        "total_profit": revenue - expense,
        "payment_summary": {key: 0 if isinstance(value, (int, float)) else value for key, value in payment.items()},
        "custom_kpis": [],
        "scope": "assigned",
        "supervisor_name": name,
    })
    return scoped


def scope_location_rows(rows: list[dict], user: Optional[dict]) -> list[dict]:
    if supervisor_name(user) is None:
        return rows
    return [row for row in rows if isinstance(row, dict) and row_assigned(row, user)]


def scope_location_summary(payload: dict, user: Optional[dict]) -> dict:
    if supervisor_name(user) is None or not isinstance(payload, dict):
        return payload
    locations = []
    for group in payload.get("locations") or []:
        if not isinstance(group, dict):
            continue
        vehicles = [row for row in group.get("vehicles") or [] if isinstance(row, dict) and row_assigned(row, user)]
        if not vehicles:
            continue
        item = dict(group)
        item["vehicles"] = vehicles
        item["vehicle_count"] = len(vehicles)
        locations.append(item)
    return {
        **payload,
        "locations": locations,
        "total_locations": len(locations),
        "total_vehicles": sum(item["vehicle_count"] for item in locations),
        "scope": "assigned",
        "supervisor_name": supervisor_name(user),
    }


def scope_mayet_catalog(payload: dict, user: Optional[dict]) -> dict:
    keys = assigned_plate_keys(user)
    if keys is None or not isinstance(payload, dict):
        return payload
    vehicles = [
        row for row in payload.get("vehicles") or []
        if isinstance(row, dict) and (plate_key(row.get("plate")) in keys or tracker_key(row.get("plate")) in keys)
    ]
    scoped = dict(payload)
    scoped["vehicles"] = vehicles
    scoped["count"] = len(vehicles)
    scoped["scope"] = "assigned"
    return scoped


def scope_gps_places(payload: dict, user: Optional[dict]) -> dict:
    keys = assigned_plate_keys(user)
    if keys is None or not isinstance(payload, dict):
        return payload
    places = [
        row for row in payload.get("places") or []
        if isinstance(row, dict) and (plate_key(row.get("plate")) in keys or tracker_key(row.get("plate")) in keys)
    ]
    return {**payload, "places": places, "count": len(places), "scope": "assigned"}
