from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


FACTORY_MARKER = "top factory"
TOP_DEPOT_PATTERN = re.compile(r"^top\s*([1-6])$")


def _as_float(value) -> float:
    return float(value or 0)


def _norm_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def _is_factory(value: Any) -> bool:
    raw = _norm_text(value)
    return FACTORY_MARKER in raw or bool(TOP_DEPOT_PATTERN.match(raw))


def _is_top_depot(value: Any) -> bool:
    return bool(TOP_DEPOT_PATTERN.match(_norm_text(value)))


def _normalize_state(status: Any) -> str:
    raw = _norm_text(status)
    mapping = {
        "planned": "available",
        "in_progress": "dispatched",
        "in progress": "dispatched",
        "completed": "done",
        "cancel": "cancelled",
        "canceled": "cancelled",
    }
    return mapping.get(raw, raw or "draft")


def _state_from_journey(states: list[str], closed: bool) -> str:
    normalized = [_normalize_state(state) for state in states if state]
    if closed:
        return "done"
    if normalized and all(state == "cancelled" for state in normalized):
        return "cancelled"
    if any(state == "dispatched" for state in normalized):
        return "dispatched"
    if any(state == "assigned" for state in normalized):
        return "assigned"
    if any(state == "available" for state in normalized):
        return "available"
    if normalized:
        return normalized[-1]
    return "draft"


TRIP_BASE_QUERY = """
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
            COUNT(DISTINCT pr.id) AS payment_request_count,
            COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'request_id', pr.id,
                        'request_name', COALESCE(pr.name, pr.ref, pr.id::text),
                        'request_state', COALESCE(pr.state, 'draft'),
                        'item', COALESCE(prl.item, 'Payment request'),
                        'description', COALESCE(prl.description, ''),
                        'quantity', COALESCE(prl.quantity, 1),
                        'amount', COALESCE(prl.amount, pr.amount_birr, pr.amount, 0),
                        'total', COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), pr.amount_birr, pr.amount, 0)
                    )
                ) FILTER (WHERE pr.id IS NOT NULL),
                '[]'::jsonb
            ) AS payment_request_lines
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
        t.arrival_date,
        t.create_date,
        t.write_date,
        t.current_location_note,
        t.vehicle_id,
        v.license_plate,
        m.name AS model,
        b.name AS brand,
        driver.name AS driver_name,
        COALESCE(supervisor_partner.name, supervisor_user.login) AS supervisor_name,
        departure.name AS departure_name,
        destination.name AS destination_name,
        current_location.name AS current_location_name,
        r.customer_name AS customer_name,
        COALESCE(r.total_receivable, 0) AS total_revenue,
        COALESCE(r.paid_amount, 0) AS paid_amount,
        COALESCE(r.pending_amount, 0) AS pending_amount,
        COALESCE(te.total_expense, pr.requested_amount, 0) AS total_expense,
        COALESCE(pr.requested_amount, 0) AS payment_request_total,
        COALESCE(pr.paid_expense_amount, 0) AS paid_expense_amount,
        COALESCE(pr.pending_expense_amount, 0) AS pending_expense_amount,
        COALESCE(pr.payment_request_lines, '[]'::jsonb) AS payment_request_lines,
        COALESCE(r.receivable_count, 0) AS order_receivable_count,
        COALESCE(pr.payment_request_count, 0) AS payment_request_count,
        COALESCE(t.departure_date, t.create_date) AS sort_date
    FROM trip_trip t
    LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
    LEFT JOIN fleet_vehicle_model m ON v.model_id = m.id
    LEFT JOIN fleet_vehicle_model_brand b ON m.brand_id = b.id
    LEFT JOIN hr_employee driver ON t.driver_id = driver.id
    LEFT JOIN LATERAL (
        SELECT fvs.user_id
        FROM fleet_vehicle_supervisor fvs
        WHERE fvs.vehicle_id = v.id
        ORDER BY fvs.write_date DESC NULLS LAST, fvs.create_date DESC NULLS LAST, fvs.id DESC
        LIMIT 1
    ) vehicle_supervisor ON true
    LEFT JOIN res_users supervisor_user ON supervisor_user.id = vehicle_supervisor.user_id
    LEFT JOIN res_partner supervisor_partner ON supervisor_partner.id = supervisor_user.partner_id
    LEFT JOIN trip_location departure ON t.departure_id = departure.id
    LEFT JOIN trip_location destination ON t.destination_id = destination.id
    LEFT JOIN trip_location current_location ON t.current_location_id = current_location.id
    LEFT JOIN receivables r ON r.trip_id = t.id
    LEFT JOIN payment_requests pr ON pr.trip_id = t.id
    LEFT JOIN trip_expenses te ON te.trip_id = t.id
"""


VEHICLE_LOCATION_QUERY = """
    SELECT
        v.id AS vehicle_id,
        v.name AS vehicle_name,
        v.license_plate AS vehicle_plate,
        m.name AS model,
        b.name AS brand,
        latest_trip.id AS trip_id,
        latest_trip.name AS reference,
        latest_trip.state,
        latest_trip.departure_date,
        latest_trip.arrival_date,
        latest_trip.create_date,
        latest_trip.write_date,
        latest_trip.current_location_note,
        COALESCE(supervisor_partner.name, supervisor_user.login) AS supervisor_name,
        driver.name AS driver_name,
        departure.name AS departure_name,
        destination.name AS destination_name,
        current_location.name AS current_location_name,
        COALESCE(
            current_location.name,
            NULLIF(latest_trip.current_location_note, ''),
            destination.name,
            departure.name,
            'Unknown'
        ) AS location_name,
        CASE
            WHEN COALESCE(
                latest_trip.arrival_date,
                latest_trip.departure_date,
                latest_trip.write_date,
                latest_trip.create_date
            ) IS NULL THEN 0
            ELSE GREATEST(
                CURRENT_DATE - COALESCE(
                    latest_trip.arrival_date,
                    latest_trip.departure_date,
                    latest_trip.write_date,
                    latest_trip.create_date
                )::date,
                0
            )
        END AS current_location_days
    FROM fleet_vehicle v
    LEFT JOIN fleet_vehicle_model m ON v.model_id = m.id
    LEFT JOIN fleet_vehicle_model_brand b ON m.brand_id = b.id
    LEFT JOIN LATERAL (
        SELECT t.*
        FROM trip_trip t
        WHERE t.vehicle_id = v.id
        ORDER BY t.write_date DESC NULLS LAST, t.create_date DESC NULLS LAST, t.id DESC
        LIMIT 1
    ) latest_trip ON true
    LEFT JOIN hr_employee driver ON latest_trip.driver_id = driver.id
    LEFT JOIN LATERAL (
        SELECT fvs.user_id
        FROM fleet_vehicle_supervisor fvs
        WHERE fvs.vehicle_id = v.id
        ORDER BY fvs.write_date DESC NULLS LAST, fvs.create_date DESC NULLS LAST, fvs.id DESC
        LIMIT 1
    ) vehicle_supervisor ON true
    LEFT JOIN res_users supervisor_user ON supervisor_user.id = vehicle_supervisor.user_id
    LEFT JOIN res_partner supervisor_partner ON supervisor_partner.id = supervisor_user.partner_id
    LEFT JOIN trip_location departure ON latest_trip.departure_id = departure.id
    LEFT JOIN trip_location destination ON latest_trip.destination_id = destination.id
    LEFT JOIN trip_location current_location ON latest_trip.current_location_id = current_location.id
    WHERE COALESCE(v.active, true) = true
      {supervisor_filter}
"""


async def fetch_trip_rows(
    db: AsyncSession,
    *,
    plate: Optional[str] = None,
    driver: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    limit: Optional[int] = None,
) -> list[dict]:
    conditions: list[str] = []
    params: dict[str, Any] = {}
    if plate:
        conditions.append("COALESCE(v.license_plate, '') ILIKE :plate")
        params["plate"] = f"%{plate}%"
    if driver:
        conditions.append("COALESCE(driver.name, '') ILIKE :driver")
        params["driver"] = f"%{driver}%"
    if from_date:
        conditions.append("COALESCE(t.departure_date, t.create_date)::date >= :from_date")
        params["from_date"] = from_date
    if to_date:
        conditions.append("COALESCE(t.departure_date, t.create_date)::date <= :to_date")
        params["to_date"] = to_date

    where_clause = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    limit_clause = " LIMIT :limit" if limit is not None else ""
    if limit is not None:
        params["limit"] = limit

    result = await db.execute(
        text(
            f"""
            {TRIP_BASE_QUERY}
            {where_clause}
            ORDER BY COALESCE(t.departure_date, t.create_date) DESC NULLS LAST, t.id DESC
            {limit_clause}
            """
        ),
        params,
    )
    return [dict(row._mapping) for row in result.fetchall()]


async def fetch_vehicle_location_rows(
    db: AsyncSession,
    *,
    limit: int = 1000,
    assigned_supervisors_only: bool = True,
) -> list[dict]:
    supervisor_filter = "AND vehicle_supervisor.user_id IS NOT NULL" if assigned_supervisors_only else ""
    result = await db.execute(
        text(
            f"""
            {VEHICLE_LOCATION_QUERY.format(supervisor_filter=supervisor_filter)}
            ORDER BY COALESCE(v.license_plate, v.name, v.id::text)
            LIMIT :limit
            """
        ),
        {"limit": limit},
    )
    return [dict(row._mapping) for row in result.fetchall()]


def _vehicle_key(row: dict) -> str:
    return str(row.get("vehicle_id") or row.get("vehicle_plate") or "").strip()


def _location_row_to_journey(row: dict) -> dict:
    location_name = row.get("location_name")
    return {
        "id": f"vehicle:{row.get('vehicle_id')}",
        "journey_group": 0,
        "vehicle_id": row.get("vehicle_id"),
        "vehicle_plate": row.get("vehicle_plate"),
        "vehicle_brand": row.get("brand") or row.get("model"),
        "name": row.get("reference") or row.get("vehicle_name") or row.get("vehicle_plate"),
        "driver_name": row.get("driver_name"),
        "supervisor_name": row.get("supervisor_name"),
        "customer_name": None,
        "origin": row.get("departure_name"),
        "journey_start": row.get("departure_name"),
        "journey_end": row.get("destination_name"),
        "destination": row.get("destination_name") or location_name,
        "destinations": [row.get("destination_name")] if row.get("destination_name") else [],
        "status": _normalize_state(row.get("state")) if row.get("trip_id") else "available",
        "state": _normalize_state(row.get("state")) if row.get("trip_id") else "available",
        "departure_date": row.get("departure_date"),
        "arrival_date": row.get("arrival_date"),
        "create_date": row.get("create_date"),
        "write_date": row.get("write_date"),
        "return_date": row.get("arrival_date"),
        "current_location": None if location_name == "Unknown" else location_name,
        "current_location_note": row.get("current_location_note") or (None if location_name == "Unknown" else location_name),
        "current_location_days": row.get("current_location_days") or 0,
        "total_revenue": 0.0,
        "total_expense": 0.0,
        "paid_amount": 0.0,
        "pending_payment": 0.0,
        "payment_request_total": 0.0,
        "paid_expense_amount": 0.0,
        "pending_expense_payment": 0.0,
        "order_receivable_count": 0,
        "payment_request_count": 0,
        "order_count": 0,
        "trip_count": 1 if row.get("trip_id") else 0,
        "trips": [],
        "is_vehicle_location_only": True,
    }


def ensure_all_vehicle_current_locations(journeys: list[dict], vehicle_locations: list[dict]) -> list[dict]:
    by_vehicle = {_vehicle_key(row): row for row in vehicle_locations if _vehicle_key(row)}
    seen: set[str] = set()

    for journey in journeys:
        key = str(journey.get("vehicle_id") or journey.get("vehicle_plate") or "").strip()
        if not key:
            continue
        seen.add(key)
        location = by_vehicle.get(key)
        if not location:
            continue
        location_name = location.get("location_name")
        if location_name and location_name != "Unknown":
            journey["current_location"] = journey.get("current_location") or location_name
            journey["current_location_note"] = journey.get("current_location_note") or location.get("current_location_note") or location_name
        journey["current_location_days"] = journey.get("current_location_days") or location.get("current_location_days") or 0
        journey["vehicle_plate"] = journey.get("vehicle_plate") or location.get("vehicle_plate")
        journey["vehicle_brand"] = journey.get("vehicle_brand") or location.get("brand") or location.get("model")
        journey["supervisor_name"] = journey.get("supervisor_name") or location.get("supervisor_name")

    for row in vehicle_locations:
        key = _vehicle_key(row)
        if not key or key in seen:
            continue
        journeys.append(_location_row_to_journey(row))

    journeys.sort(
        key=lambda journey: (
            journey.get("write_date") or journey.get("create_date") or datetime.min,
            journey.get("departure_date") or datetime.min,
            str(journey.get("id")),
        ),
        reverse=True,
    )
    return journeys


def build_journeys(rows: list[dict]) -> list[dict]:
    ordered_rows = sorted(
        rows,
        key=lambda row: (
            row.get("vehicle_id") or 0,
            row.get("sort_date") or row.get("create_date") or row.get("write_date") or datetime.min,
            row.get("id") or 0,
        ),
    )

    journeys: list[dict] = []
    current_by_vehicle: dict[Any, dict] = {}
    journey_index_by_vehicle: defaultdict[Any, int] = defaultdict(int)

    def finalize_vehicle(vehicle_key: Any) -> None:
        journey = current_by_vehicle.pop(vehicle_key, None)
        if not journey:
            return
        journey["status"] = _state_from_journey(journey["_states"], journey["_closed"])
        journey["state"] = journey["status"]
        journey["trip_count"] = len(journey["trips"])
        journey["order_count"] = max(
            journey["order_receivable_count"],
            journey["payment_request_count"],
            journey["trip_count"],
        )
        journey["destinations"] = [d for d in journey["destinations"] if d and not _is_factory(d)]
        journey["destination"] = journey["destinations"][-1] if journey["destinations"] else journey["journey_end"]
        journey["arrival_date"] = journey["arrival_date"] or journey["write_date"]
        journey["return_date"] = journey["arrival_date"] if journey["_closed"] else None
        journey["name"] = journey["name"] or journey["trips"][0]["name"]
        journey["current_location"] = journey["current_location"] or journey["trips"][-1].get("destination")
        journey["current_location_note"] = journey["current_location_note"] or journey["trips"][-1].get("destination")
        journey["vehicle_id"] = journey["vehicle_id"] or journey["trips"][0].get("vehicle_id")
        journey["journey_started_at_factory"] = bool(journey["trips"])
        journey["journey_ended_at_factory"] = bool(journey["_closed"])
        journey.pop("_states", None)
        journey.pop("_closed", None)
        journey.pop("_vehicle_key", None)
        journeys.append(journey)

    for row in ordered_rows:
        vehicle_key = row.get("vehicle_id") or row.get("license_plate") or row.get("id")
        departure = row.get("departure_name") or row.get("current_location_name")
        destination = row.get("destination_name")
        sort_date = row.get("sort_date") or row.get("create_date") or row.get("write_date")
        if vehicle_key not in current_by_vehicle and not _is_top_depot(departure):
            continue

        if _is_top_depot(departure):
            finalize_vehicle(vehicle_key)
            journey_index_by_vehicle[vehicle_key] += 1
            journey_id = f"{vehicle_key}:{journey_index_by_vehicle[vehicle_key]}"
            current_by_vehicle[vehicle_key] = {
                "id": journey_id,
                "journey_group": journey_index_by_vehicle[vehicle_key],
                "vehicle_id": vehicle_key,
                "vehicle_plate": row.get("license_plate"),
                "vehicle_brand": row.get("brand") or row.get("model"),
                "name": row.get("name"),
                "driver_name": row.get("driver_name"),
                "supervisor_name": row.get("supervisor_name"),
                "customer_name": row.get("customer_name"),
                "origin": departure,
                "journey_start": departure,
                "journey_end": departure,
                "destination": destination,
                "destinations": [],
                "status": row.get("state"),
                "state": row.get("state"),
                "departure_date": row.get("departure_date"),
                "arrival_date": None,
                "create_date": row.get("create_date"),
                "write_date": row.get("write_date"),
                "return_date": None,
                "current_location": row.get("current_location_name"),
                "current_location_note": row.get("current_location_note"),
                "total_revenue": 0.0,
                "total_expense": 0.0,
                "paid_amount": 0.0,
                "pending_payment": 0.0,
                "payment_request_total": 0.0,
                "paid_expense_amount": 0.0,
                "pending_expense_payment": 0.0,
                "order_receivable_count": 0,
                "payment_request_count": 0,
                "order_count": 0,
                "trip_count": 0,
                "trips": [],
                "_states": [],
                "_closed": False,
                "_vehicle_key": vehicle_key,
                "_sort_date": sort_date,
            }

        journey = current_by_vehicle.get(vehicle_key)
        if not journey:
            continue
        previous_destination = journey["trips"][-1].get("destination") if journey["trips"] else None
        leg_origin = previous_destination if previous_destination and not _is_top_depot(departure) else departure

        leg = {
            "id": row.get("id"),
            "name": row.get("name"),
            "vehicle_id": row.get("vehicle_id"),
            "vehicle_plate": row.get("license_plate"),
            "origin": leg_origin,
            "destination": destination,
            "departure_date": row.get("departure_date").isoformat() if row.get("departure_date") else None,
            "arrival_date": row.get("arrival_date").isoformat() if row.get("arrival_date") else None,
            "create_date": row.get("create_date").isoformat() if row.get("create_date") else None,
            "write_date": row.get("write_date").isoformat() if row.get("write_date") else None,
            "status": row.get("state"),
            "revenue": _as_float(row.get("total_revenue")),
            "expense": _as_float(row.get("total_expense")),
            "paid_amount": _as_float(row.get("paid_amount")),
            "pending_payment": _as_float(row.get("pending_amount")),
            "payment_request_total": _as_float(row.get("payment_request_total")),
            "paid_expense_amount": _as_float(row.get("paid_expense_amount")),
            "pending_expense_payment": _as_float(row.get("pending_expense_amount")),
            "payment_request_lines": row.get("payment_request_lines") or [],
            "order_receivable_count": int(row.get("order_receivable_count") or 0),
            "payment_request_count": int(row.get("payment_request_count") or 0),
        }
        journey["trips"].append(leg)
        journey["destinations"].append(destination)
        journey["total_revenue"] += _as_float(row.get("total_revenue"))
        journey["total_expense"] += _as_float(row.get("total_expense"))
        journey["paid_amount"] += _as_float(row.get("paid_amount"))
        journey["pending_payment"] += _as_float(row.get("pending_amount"))
        journey["payment_request_total"] += _as_float(row.get("payment_request_total"))
        journey["paid_expense_amount"] += _as_float(row.get("paid_expense_amount"))
        journey["pending_expense_payment"] += _as_float(row.get("pending_expense_amount"))
        journey["order_receivable_count"] += int(row.get("order_receivable_count") or 0)
        journey["payment_request_count"] += int(row.get("payment_request_count") or 0)
        journey["departure_date"] = journey["departure_date"] or row.get("departure_date")
        journey["create_date"] = journey["create_date"] or row.get("create_date")
        journey["write_date"] = row.get("write_date") or journey["write_date"]
        journey["arrival_date"] = row.get("arrival_date") or journey["arrival_date"]
        journey["current_location"] = row.get("current_location_name") or journey["current_location"]
        journey["current_location_note"] = row.get("current_location_note") or journey["current_location_note"]
        journey["supervisor_name"] = journey.get("supervisor_name") or row.get("supervisor_name")
        journey["driver_name"] = row.get("driver_name") or journey["driver_name"]
        journey["customer_name"] = row.get("customer_name") or journey["customer_name"]
        journey["vehicle_plate"] = row.get("license_plate") or journey["vehicle_plate"]
        journey["vehicle_brand"] = row.get("brand") or row.get("model") or journey["vehicle_brand"]
        journey["_states"].append(row.get("state"))
        if _is_top_depot(destination):
            journey["journey_end"] = destination or journey["journey_end"]
            journey["_closed"] = True
            finalize_vehicle(vehicle_key)

    for vehicle_key in list(current_by_vehicle.keys()):
        finalize_vehicle(vehicle_key)

    journeys.sort(
        key=lambda journey: (
            journey.get("write_date") or journey.get("create_date") or datetime.min,
            journey.get("departure_date") or datetime.min,
            str(journey.get("id")),
        ),
        reverse=True,
    )
    return journeys


def journeys_status_summary(journeys: list[dict]) -> list[dict]:
    counts = Counter(_normalize_state(journey.get("status")) for journey in journeys if journey.get("status"))
    return [{"state": state, "count": count} for state, count in counts.items()]
