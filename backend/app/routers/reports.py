from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
import asyncio
import re
from typing import Optional, Union
from pydantic import BaseModel

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
import csv
from io import StringIO
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_manager, require_user
from app.core.scope import scope_location_rows, scope_location_summary
from app.core.server_cache import cache_del, cache_get, cache_get_stale, cache_set
from app.core.database import AsyncSessionLocal, get_session
from app.services.journey_assembly import fetch_vehicle_location_rows
from app.services.daily_custom_store import (
    get_custom_entries,
    save_custom_entry,
    save_custom_entries_bulk,
)

router = APIRouter()


def _as_float(value) -> float:
    return float(value or 0)


def _date_text(value) -> Optional[str]:
    if not value:
        return None
    return str(value)[:10]


_ETHIOPIC_TO_JDN_OFFSET = 1724220


def _gregorian_to_jdn(year: int, month: int, day: int) -> int:
    a = (14 - month) // 12
    y = year + 4800 - a
    m = month + 12 * a - 3
    return day + (153 * m + 2) // 5 + 365 * y + y // 4 - y // 100 + y // 400 - 32045


def _jdn_to_gregorian(jdn: int) -> date:
    a = jdn + 32044
    b = (4 * a + 3) // 146097
    c = a - (146097 * b) // 4
    d = (4 * c + 3) // 1461
    e = c - (1461 * d) // 4
    m = (5 * e + 2) // 153
    day = e - (153 * m + 2) // 5 + 1
    month = m + 3 - 12 * (m // 10)
    year = 100 * b + d - 4800 + (m // 10)
    return date(year, month, day)


def _ethiopian_to_jdn(year: int, month: int, day: int) -> int:
    return day + (month - 1) * 30 + (year - 1) * 365 + (year // 4) + _ETHIOPIC_TO_JDN_OFFSET


def _ethiopian_year_bounds(year: int) -> tuple[date, date]:
    start = _jdn_to_gregorian(_ethiopian_to_jdn(year, 1, 1))
    next_start = _jdn_to_gregorian(_ethiopian_to_jdn(year + 1, 1, 1))
    return start, next_start - timedelta(days=1)


def _location_sort_key(name: str, count: int = 0):
    normalized = (name or "Unknown").strip().lower()
    return (normalized == "unknown", -count, normalized)


def _extract_amount(text_value: str) -> float:
    matches = re.findall(r"(?<![\w.])\d[\d,]*(?:\.\d+)?", text_value or "")
    if not matches:
        return 0.0
    try:
        return float(matches[-1].replace(",", ""))
    except ValueError:
        return 0.0


def _payment_text_lines(text_value: str) -> list[dict]:
    lines = []
    for index, raw_line in enumerate((text_value or "").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        lines.append({
            "item": f"Line {index}",
            "description": line,
            "amount": _extract_amount(line),
        })
    return lines


def _payment_summary(payment: dict) -> dict:
    return {
        "id": payment["id"],
        "name": payment.get("name") or payment["id"],
        "reference": payment.get("reference") or payment["id"],
        "trip_id": payment.get("trip_id"),
        "trip_reference": payment.get("trip_reference"),
        "vehicle_plate": payment.get("vehicle_plate"),
        "state": payment.get("state", "confirmed"),
        "date": payment.get("date"),
        "approved_on": payment.get("approved_on"),
        "requester_name": payment.get("requester_name"),
        "customer_id": payment.get("customer_id"),
        "customer_name": payment.get("customer_name") or payment.get("requester_name") or payment.get("supervisor_name"),
        "supervisor_name": payment.get("supervisor_name"),
        "driver_name": payment.get("driver_name"),
        "total_amount": _as_float(payment.get("total_amount")),
        "customer_receivable_total": _as_float(payment.get("customer_receivable_total")),
        "customer_paid_amount": _as_float(payment.get("customer_paid_amount")),
        "customer_pending_amount": _as_float(payment.get("customer_pending_amount")),
        "source": payment.get("source", "app"),
        "request_text": payment.get("request_text", ""),
        "line_items": payment.get("line_items") or _payment_text_lines(payment.get("request_text", "")),
    }


def _payment_summary_from_row(row) -> dict:
    line_items = row.line_items or []
    request_text = "\n".join(
        str(line.get("description") or line.get("item") or "")
        for line in line_items
        if isinstance(line, dict) and (line.get("description") or line.get("item"))
    )
    approved_on = getattr(row, "approved_on", None) or getattr(row, "approve_date", None)
    return {
        "id": row.id,
        "name": row.name,
        "reference": row.reference,
        "trip_id": row.trip_id,
        "trip_reference": row.trip_reference,
        "origin": row.origin,
        "destination": row.destination,
        "route_name": f"{row.origin} to {row.destination}" if row.origin and row.destination else row.trip_reference,
        "vehicle_plate": row.vehicle_plate,
        "state": row.state,
        "date": str(row.date) if row.date else None,
        "approved_on": str(approved_on) if approved_on else None,
        "requester_name": row.requester_name,
        "customer_id": row.customer_id,
        "customer_name": row.customer_name,
        "supervisor_name": row.supervisor_name,
        "driver_name": getattr(row, "driver_name", None) or row.supervisor_name,
        "total_amount": _as_float(row.total_amount),
        "customer_receivable_total": _as_float(row.customer_receivable_total),
        "customer_paid_amount": _as_float(row.customer_paid_amount),
        "customer_pending_amount": _as_float(row.customer_pending_amount),
        "source": "odoo",
        "request_text": request_text,
        "line_items": line_items,
    }


def _normalize_payment_lines(lines: list[dict]) -> list[dict]:
    normalized_lines = []
    for index, line in enumerate(lines, start=1):
        if not isinstance(line, dict):
            continue
        item = str(line.get("item") or f"Item {index}").strip()
        description = str(line.get("description") or "").strip()
        amount = _as_float(line.get("amount"))
        quantity = _as_float(line.get("quantity")) or 1
        total = _as_float(line.get("total")) or amount * quantity
        if not item and not description and total <= 0:
            continue
        normalized_lines.append(
            {
                "item": item or f"Item {index}",
                "description": description,
                "amount": amount,
                "quantity": quantity,
                "total": total,
            }
        )
    return normalized_lines


async def _resolve_trip_for_payment_request(
    db: AsyncSession,
    trip_reference: Optional[str],
    vehicle_plate: Optional[str],
) -> Optional[dict]:
    conditions = []
    params: dict[str, str] = {}
    if trip_reference:
        trip_reference = trip_reference.strip()
        params["trip_reference"] = trip_reference
        params["trip_reference_like"] = f"%{trip_reference}%"
        conditions.append(
            "(t.name = :trip_reference OR t.name ILIKE :trip_reference_like OR CAST(t.id AS TEXT) = :trip_reference)"
        )
    if vehicle_plate:
        vehicle_plate = vehicle_plate.strip()
        params["vehicle_plate"] = vehicle_plate
        conditions.append("COALESCE(v.license_plate, '') = :vehicle_plate")
    if not conditions:
        return None

    row = (
        await db.execute(text(f"""
            SELECT
                t.id AS trip_id,
                t.name AS trip_reference,
                COALESCE(departure.name, '') AS origin,
                COALESCE(destination.name, '') AS destination,
                COALESCE(v.license_plate, '') AS vehicle_plate,
                driver.name AS driver_name
            FROM trip_trip t
            LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
            LEFT JOIN trip_location departure ON t.departure_id = departure.id
            LEFT JOIN trip_location destination ON t.destination_id = destination.id
            LEFT JOIN hr_employee driver ON t.driver_id = driver.id
            WHERE {' OR '.join(conditions)}
            ORDER BY t.write_date DESC NULLS LAST, t.create_date DESC NULLS LAST, t.id DESC
            LIMIT 1
        """), params)
    ).fetchone()
    if not row:
        return None
    return {
        "trip_id": row.trip_id,
        "trip_reference": row.trip_reference,
        "origin": row.origin,
        "destination": row.destination,
        "vehicle_plate": row.vehicle_plate,
        "driver_name": row.driver_name,
        "route_name": f"{row.origin} to {row.destination}" if row.origin and row.destination else row.trip_reference,
    }


def _period_key(value: Optional[str], period: str) -> str:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        parsed = datetime.utcnow()
    if period == "weekly":
        parsed = parsed - timedelta(days=parsed.weekday())
    if period == "monthly":
        parsed = parsed.replace(day=1)
    return parsed.date().isoformat()


def _daily_profit_totals(rows: list[dict]) -> dict:
    posted = [row for row in rows if row.get("receivable_posted")]
    pending = [row for row in rows if not row.get("receivable_posted")]
    posted_profit = sum(row["actual_net_profit"] for row in posted)
    actual_nums = []
    for r in rows:
        val = r.get("actual")
        if val is not None and str(val).strip():
            try:
                actual_nums.append(float(str(val).replace(",", "").strip()))
            except (ValueError, TypeError):
                pass
    return {
        "vehicle_count": len(rows),
        "rent_total": sum(row["actual_daily_total_revenue"] for row in rows),
        "cost_total": sum(row["daily_total_cost"] for row in rows),
        "revenue_total": sum(row["actual_daily_total_revenue"] for row in rows),
        "actual_total": sum(actual_nums) if actual_nums else 0,
        "unconfirmed_total": sum(row.get("unconfirmed_amount") or 0 for row in rows),
        "net_profit_total": sum(row["actual_net_profit"] for row in rows),
        "daily_net_profit_total": sum(row["actual_net_profit"] for row in rows),
        "pending_trip_count": len(pending),
        "pending_cost_total": sum(row["daily_total_cost"] for row in pending),
    }


async def _table_columns(db: AsyncSession, table_name: str) -> set[str]:
    result = await db.execute(text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = :table_name
    """), {"table_name": table_name})
    return {row.column_name for row in result.fetchall()}


@router.get("/current-location")
async def current_location_report(
    refresh: bool = Query(False),
    db: AsyncSession = Depends(get_session),
    user: dict = Depends(require_user),
) -> list[dict]:
    cache_key = "fleet:reports:current-location:v3"
    if not refresh:
        cached = cache_get(cache_key) or cache_get_stale(cache_key)
        if cached is not None:
            return scope_location_rows(cached, user)

    try:
        rows = await fetch_vehicle_location_rows(db, limit=1000)
        response = [
            {
                "vehicle_id": row.get("vehicle_id"),
                "trip_id": row.get("trip_id"),
                "reference": row.get("reference"),
                "vehicle_plate": row.get("vehicle_plate"),
                "supervisor_name": row.get("supervisor_name"),
                "driver_name": row.get("driver_name"),
                "driver_phone": row.get("driver_phone"),
                "departure_name": row.get("departure_name"),
                "destination_name": row.get("destination_name"),
                "current_location_name": row.get("current_location_name") or row.get("location_name"),
                "current_location_note": row.get("current_location_note"),
                "departure_date": _date_text(row.get("departure_date")),
                "arrival_date": _date_text(row.get("arrival_date")),
                "write_date": _date_text(row.get("write_date")),
                "create_date": _date_text(row.get("create_date")),
                "days_as_of": _date_text(row.get("days_as_of")),
                "days_basis": row.get("days_basis") or "none",
                "state": row.get("state") or "available",
                "current_location_days": row.get("current_location_days") or 0,
            }
            for row in rows
        ]
        cache_set(cache_key, response, ttl_seconds=60)
        return scope_location_rows(response, user)
    except Exception:
        saved = cache_get_stale(cache_key)
        if saved is not None:
            return scope_location_rows(saved, user)
        raise HTTPException(status_code=503, detail="Live Odoo DB timed out.")


@router.get("/current-location-summary")
async def current_location_summary_report(
    refresh: bool = Query(False),
    db: AsyncSession = Depends(get_session),
    user: dict = Depends(require_user),
) -> dict:
    cache_key = "fleet:reports:current-location-summary:v4"
    if not refresh:
        cached = cache_get(cache_key) or cache_get_stale(cache_key)
        if cached is not None:
            return scope_location_summary(cached, user)

    try:
        rows = await fetch_vehicle_location_rows(db, limit=1000)
        by_location: dict[str, list[dict]] = {}
        for row in rows:
            location_name = row.get("location_name") or "Unknown"
            by_location.setdefault(location_name, []).append({
                "vehicle_id": row.get("vehicle_id"),
                "trip_id": row.get("trip_id"),
                "reference": row.get("reference"),
                "vehicle_plate": row.get("vehicle_plate"),
                "supervisor_name": row.get("supervisor_name"),
                "driver_name": row.get("driver_name"),
                "driver_phone": row.get("driver_phone"),
                "state": row.get("state") or "available",
                "departure_name": row.get("departure_name"),
                "destination_name": row.get("destination_name"),
                "current_location_note": row.get("current_location_note"),
                "departure_date": _date_text(row.get("departure_date")),
                "arrival_date": _date_text(row.get("arrival_date")),
                "write_date": _date_text(row.get("write_date")),
                "create_date": _date_text(row.get("create_date")),
                "days_as_of": _date_text(row.get("days_as_of")),
                "days_basis": row.get("days_basis") or "none",
                "days": row.get("current_location_days") or 0,
            })
        locations = [
            {
                "location_name": location_name,
                "vehicle_count": len(vehicles),
                "vehicles": vehicles,
            }
            for location_name, vehicles in by_location.items()
        ]
        locations.sort(key=lambda item: _location_sort_key(item["location_name"], item["vehicle_count"]))
        response = {
            "locations": locations,
            "total_locations": len(locations),
            "total_vehicles": sum(item["vehicle_count"] for item in locations),
        }
        cache_set(cache_key, response, ttl_seconds=60)
        return scope_location_summary(response, user)
    except Exception:
        saved = cache_get_stale(cache_key)
        if saved is not None:
            return scope_location_summary(saved, user)
        raise HTTPException(status_code=503, detail="Live Odoo DB timed out.")


@router.get("/payment-requests")
async def payment_request_report():
    cache_key = "fleet:reports:payment-requests:v2-trip"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    saved = cache_get_stale(cache_key)
    if saved is not None:
        return JSONResponse(content=saved, headers={"X-Fleet-Saved": "1"})

    async with AsyncSessionLocal() as db:
        return await _load_payment_requests(db, cache_key)


async def _load_payment_requests(db: AsyncSession, cache_key: str) -> list[dict]:
    try:
        rows = await db.execute(text("""
        WITH request_lines AS (
            SELECT
                prl.payment_request_id,
                json_agg(
                    json_build_object(
                        'item', COALESCE(prl.item, 'General'),
                        'description', COALESCE(prl.description, ''),
                        'amount', COALESCE(prl.amount, 0),
                        'quantity', COALESCE(prl.quantity, 1),
                        'total', COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), 0)
                    )
                    ORDER BY prl.id
                ) AS line_items,
                COALESCE(SUM(COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), 0)), 0) AS line_total
            FROM payment_request_line prl
            GROUP BY prl.payment_request_id
        ),
        receivables AS (
            SELECT
                trip_id,
                MAX(partner_id) AS customer_id,
                MAX(customer_name) AS customer_name,
                COALESCE(SUM(amount_due), 0) AS receivable_total,
                COALESCE(SUM(
                    CASE
                        WHEN COALESCE(payment_reference, '') ~* 'FT[[:space:]]*[0-9]'
                        THEN amount_due
                        ELSE 0
                    END
                ), 0) AS paid_amount,
                COALESCE(SUM(
                    CASE
                        WHEN COALESCE(payment_reference, '') ~* 'FT[[:space:]]*[0-9]'
                        THEN 0
                        ELSE amount_due
                    END
                ), 0) AS pending_amount
            FROM trip_receivable
            GROUP BY trip_id
        )
        SELECT
            pr.id,
            pr.name,
            pr.ref AS reference,
            pr.trip_id,
            t.name AS trip_reference,
            COALESCE(departure.name, '') AS origin,
            COALESCE(destination.name, '') AS destination,
            v.license_plate AS vehicle_plate,
            COALESCE(NULLIF(pr.state, ''), 'draft') AS state,
            COALESCE(pr.date, pr.create_date::date) AS date,
            pr.approve_date,
            requester.name AS requester_name,
            driver.name AS supervisor_name,
            driver.name AS driver_name,
            COALESCE(receivables.customer_id, NULL) AS customer_id,
            COALESCE(receivables.customer_name, requester.name, driver.name) AS customer_name,
            COALESCE(receivables.receivable_total, 0) AS customer_receivable_total,
            COALESCE(receivables.paid_amount, 0) AS customer_paid_amount,
            COALESCE(receivables.pending_amount, 0) AS customer_pending_amount,
            COALESCE(lines.line_total, pr.amount_birr, pr.amount, 0) AS total_amount,
            COALESCE(lines.line_items, '[]'::json) AS line_items
        FROM payment_request pr
        LEFT JOIN request_lines lines ON lines.payment_request_id = pr.id
        LEFT JOIN trip_trip t ON pr.trip_id = t.id
        LEFT JOIN receivables ON receivables.trip_id = t.id
        LEFT JOIN trip_location departure ON t.departure_id = departure.id
        LEFT JOIN trip_location destination ON t.destination_id = destination.id
        LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
        LEFT JOIN hr_employee driver ON t.driver_id = driver.id
        LEFT JOIN res_users req_user ON pr.create_uid = req_user.id
        LEFT JOIN res_partner requester ON req_user.partner_id = requester.id
        WHERE pr.trip_id IS NOT NULL
          AND COALESCE(pr.is_trip_payment, false) = true
        ORDER BY COALESCE(pr.date, pr.create_date::date) DESC NULLS LAST, pr.create_date DESC NULLS LAST
        LIMIT 500
    """))
        live_requests = [
            _payment_summary_from_row(row)
            for row in rows.fetchall()
        ]
    except Exception:
        saved = cache_get_stale(cache_key)
        if saved is not None:
            return JSONResponse(content=saved, headers={"X-Fleet-Saved": "1"})
        raise HTTPException(status_code=503, detail="Live Odoo DB timed out.")
    cache_set(cache_key, live_requests)
    return live_requests


@router.post("/payment-request")
async def create_payment_request(
    payload: dict,
    db: AsyncSession = Depends(get_session),
    user: dict = Depends(require_user),
) -> dict:
    """Create a payment request in the live Odoo-backed database."""
    line_items = payload.get("line_items") if isinstance(payload.get("line_items"), list) else []
    normalized_lines = _normalize_payment_lines(line_items)
    request_text = str(payload.get("request_text") or "").strip()
    if not request_text and normalized_lines:
        request_text = "\n".join(
            f"{line['item']}: {line['description']} - {line['total']:.2f}"
            for line in normalized_lines
        )
    if not request_text:
        raise HTTPException(status_code=400, detail="Payment request items are required")
    total_amount = _as_float(payload.get("total_amount")) or sum(line["total"] for line in normalized_lines) or _extract_amount(request_text)
    trip = await _resolve_trip_for_payment_request(
        db=db,
        trip_reference=str(payload.get("trip_reference") or "").strip() or None,
        vehicle_plate=str(payload.get("vehicle_plate") or "").strip() or None,
    )
    if not trip:
        raise HTTPException(status_code=400, detail="Trip not found in Odoo DB. Use a real trip reference or vehicle plate.")

    now = datetime.utcnow()
    state = str(payload.get("state") or "confirmed").strip() or "confirmed"
    approved_on = now if state in {"approved", "paid", "done", "posted"} else None
    db_user_id = user.get("odoo_user_id") or 1
    payment_name = str(payload.get("name") or f"{trip['trip_reference']}-PAY-{now.strftime('%Y%m%d-%H%M%S')}").strip()
    payment_ref = str(payload.get("reference") or payment_name).strip()
    payment_date = payload.get("date") or date.today()
    if isinstance(payment_date, str):
        payment_date = date.fromisoformat(payment_date[:10])

    result = await db.execute(text("""
        INSERT INTO payment_request (
            source, amount, state, create_uid, create_date, write_uid, write_date,
            ref, description, date, approve_uid, approve_date, amount_birr,
            "current_user", requester_id, prepared_by, name, source_doc, is_trip_payment, trip_id
        ) VALUES (
            :source, :amount, :state, :create_uid, now(), :write_uid, now(),
            :ref, :description, :date, :approve_uid, :approve_date, :amount_birr,
            :current_user, :requester_id, :prepared_by, :name, :source_doc, :is_trip_payment, :trip_id
        )
        RETURNING id
    """), {
        "source": str(payload.get("source") or "odoo"),
        "amount": total_amount,
        "state": state,
        "create_uid": db_user_id,
        "write_uid": db_user_id,
        "ref": payment_ref,
        "description": request_text,
        "date": payment_date,
        "approve_uid": db_user_id if approved_on else None,
        "approve_date": approved_on,
        "amount_birr": total_amount,
        "current_user": db_user_id,
        "requester_id": db_user_id,
        "prepared_by": db_user_id,
        "name": payment_name,
        "source_doc": trip["trip_reference"],
        "is_trip_payment": True,
        "trip_id": trip["trip_id"],
    })
    payment_id = result.scalar_one()
    for line in normalized_lines:
        await db.execute(text("""
            INSERT INTO payment_request_line (
                payment_request_id, item, description, amount, quantity, total,
                create_uid, create_date, write_uid, write_date
            ) VALUES (
                :payment_request_id, :item, :description, :amount, :quantity, :total,
                :create_uid, now(), :write_uid, now()
            )
        """), {
            "payment_request_id": payment_id,
            "item": line["item"],
            "description": line["description"],
            "amount": line["amount"],
            "quantity": line["quantity"],
            "total": line["total"],
            "create_uid": db_user_id,
            "write_uid": db_user_id,
        })
    await db.commit()

    detail = await db.execute(text("""
        WITH request_lines AS (
            SELECT
                prl.payment_request_id,
                json_agg(
                    json_build_object(
                        'item', COALESCE(prl.item, 'General'),
                        'description', COALESCE(prl.description, ''),
                        'amount', COALESCE(prl.amount, 0),
                        'quantity', COALESCE(prl.quantity, 1),
                        'total', COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), 0)
                    )
                    ORDER BY prl.id
                ) AS line_items,
                COALESCE(SUM(COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), 0)), 0) AS line_total
            FROM payment_request_line prl
            GROUP BY prl.payment_request_id
        ),
        receivables AS (
            SELECT
                trip_id,
                MAX(partner_id) AS customer_id,
                MAX(customer_name) AS customer_name,
                COALESCE(SUM(amount_due), 0) AS receivable_total,
                COALESCE(SUM(
                    CASE
                        WHEN COALESCE(payment_reference, '') ~* 'FT[[:space:]]*[0-9]'
                        THEN amount_due
                        ELSE 0
                    END
                ), 0) AS paid_amount,
                COALESCE(SUM(
                    CASE
                        WHEN COALESCE(payment_reference, '') ~* 'FT[[:space:]]*[0-9]'
                        THEN 0
                        ELSE amount_due
                    END
                ), 0) AS pending_amount
            FROM trip_receivable
            GROUP BY trip_id
        )
        SELECT
            pr.id,
            pr.name,
            pr.ref AS reference,
            pr.trip_id,
            t.name AS trip_reference,
            COALESCE(departure.name, '') AS origin,
            COALESCE(destination.name, '') AS destination,
            v.license_plate AS vehicle_plate,
            COALESCE(NULLIF(pr.state, ''), 'draft') AS state,
            COALESCE(pr.date, pr.create_date::date) AS date,
            pr.approve_date,
            requester.name AS requester_name,
            driver.name AS supervisor_name,
            COALESCE(receivables.customer_id, NULL) AS customer_id,
            COALESCE(receivables.customer_name, requester.name, driver.name) AS customer_name,
            COALESCE(receivables.receivable_total, 0) AS customer_receivable_total,
            COALESCE(receivables.paid_amount, 0) AS customer_paid_amount,
            COALESCE(receivables.pending_amount, 0) AS customer_pending_amount,
            COALESCE(lines.line_total, pr.amount_birr, pr.amount, 0) AS total_amount,
            COALESCE(lines.line_items, '[]'::json) AS line_items
        FROM payment_request pr
        LEFT JOIN request_lines lines ON lines.payment_request_id = pr.id
        LEFT JOIN trip_trip t ON pr.trip_id = t.id
        LEFT JOIN receivables ON receivables.trip_id = t.id
        LEFT JOIN trip_location departure ON t.departure_id = departure.id
        LEFT JOIN trip_location destination ON t.destination_id = destination.id
        LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
        LEFT JOIN hr_employee driver ON t.driver_id = driver.id
        LEFT JOIN res_users req_user ON pr.create_uid = req_user.id
        LEFT JOIN res_partner requester ON req_user.partner_id = requester.id
        WHERE pr.id = :payment_id
    """), {"payment_id": payment_id})
    row = detail.fetchone()
    if not row:
        raise HTTPException(status_code=500, detail="Payment request created but could not be reloaded")
    return {"detail": "Created", "payment": _payment_summary_from_row(row)}


@router.get("/payment-request-detail/{pr_id}")
async def payment_request_detail(pr_id: str, db: AsyncSession = Depends(get_session)) -> dict:
    """Return a single payment request with full details for editing/approval."""
    try:
        live_pr_id = int(pr_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Payment request not found")
    row = (
        await db.execute(text("""
            WITH request_lines AS (
                SELECT
                    prl.payment_request_id,
                    json_agg(
                        json_build_object(
                            'item', COALESCE(prl.item, 'General'),
                            'description', COALESCE(prl.description, ''),
                            'amount', COALESCE(prl.amount, 0),
                            'quantity', COALESCE(prl.quantity, 1),
                            'total', COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), 0)
                        )
                        ORDER BY prl.id
                    ) AS line_items,
                    COALESCE(SUM(COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), 0)), 0) AS line_total
                FROM payment_request_line prl
                GROUP BY prl.payment_request_id
            ),
            receivables AS (
                SELECT
                    trip_id,
                    MAX(partner_id) AS customer_id,
                MAX(customer_name) AS customer_name,
                    COALESCE(SUM(amount_due), 0) AS receivable_total,
                    COALESCE(SUM(
                        CASE
                            WHEN COALESCE(payment_reference, '') ~* 'FT[[:space:]]*[0-9]'
                            THEN amount_due
                            ELSE 0
                        END
                    ), 0) AS paid_amount,
                    COALESCE(SUM(
                        CASE
                            WHEN COALESCE(payment_reference, '') ~* 'FT[[:space:]]*[0-9]'
                            THEN 0
                            ELSE amount_due
                        END
                    ), 0) AS pending_amount
                FROM trip_receivable
                GROUP BY trip_id
            )
            SELECT
                pr.id,
                pr.name,
                pr.ref AS reference,
                pr.trip_id,
                t.name AS trip_reference,
                COALESCE(departure.name, '') AS origin,
                COALESCE(destination.name, '') AS destination,
                v.license_plate AS vehicle_plate,
                COALESCE(NULLIF(pr.state, ''), 'draft') AS state,
                COALESCE(pr.date, pr.create_date::date) AS date,
                pr.approve_date AS approved_on,
                requester.name AS requester_name,
                driver.name AS supervisor_name,
                COALESCE(driver.name, requester.name, 'Unknown') AS driver_name,
                COALESCE(receivables.customer_id, NULL) AS customer_id,
                COALESCE(receivables.customer_name, requester.name, driver.name) AS customer_name,
                COALESCE(receivables.receivable_total, 0) AS customer_receivable_total,
                COALESCE(receivables.paid_amount, 0) AS customer_paid_amount,
                COALESCE(receivables.pending_amount, 0) AS customer_pending_amount,
                COALESCE(lines.line_total, pr.amount_birr, pr.amount, 0) AS total_amount,
                COALESCE(lines.line_items, '[]'::json) AS line_items
            FROM payment_request pr
            LEFT JOIN request_lines lines ON lines.payment_request_id = pr.id
            LEFT JOIN trip_trip t ON pr.trip_id = t.id
            LEFT JOIN receivables ON receivables.trip_id = t.id
            LEFT JOIN trip_location departure ON t.departure_id = departure.id
            LEFT JOIN trip_location destination ON t.destination_id = destination.id
            LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
            LEFT JOIN hr_employee driver ON t.driver_id = driver.id
            LEFT JOIN res_users req_user ON pr.create_uid = req_user.id
            LEFT JOIN res_partner requester ON req_user.partner_id = requester.id
            WHERE pr.id = :pr_id
            GROUP BY pr.id, pr.name, pr.ref, pr.trip_id, t.name, departure.name, destination.name, v.license_plate, pr.state, pr.date, pr.create_date, pr.approve_date, requester.name, driver.name, receivables.customer_name, receivables.receivable_total, receivables.paid_amount, receivables.pending_amount, lines.line_total, lines.line_items
        """), {"pr_id": live_pr_id})
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Payment request not found")
    return _payment_summary_from_row(row)


@router.patch("/payment-request/{pr_id}")
async def update_payment_request(
    pr_id: str,
    payload: dict,
    db: AsyncSession = Depends(get_session),
    user: dict = Depends(require_manager),
) -> dict:
    """Update payment request state/notes (manager approval workflow)."""
    allowed_states = {"draft", "confirmed", "approved", "paid", "done", "posted", "cancelled"}
    new_state = payload.get("state")
    notes = payload.get("notes", "")
    if new_state and new_state not in allowed_states:
        raise HTTPException(status_code=400, detail=f"Invalid state. Allowed: {', '.join(allowed_states)}")

    try:
        live_pr_id = int(pr_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Payment request not found")

    updates = []
    params: dict = {"pr_id": live_pr_id, "write_uid": user.get("odoo_user_id") or 1}
    payment_columns = await _table_columns(db, "payment_request")
    payment_row = (
        await db.execute(text("""
            SELECT id, trip_id, amount, amount_birr, description, state
            FROM payment_request
            WHERE id = :pr_id
        """), {"pr_id": live_pr_id})
    ).fetchone()
    if not payment_row:
        raise HTTPException(status_code=404, detail="Payment request not found")

    if new_state:
        updates.append("state = :new_state")
        params["new_state"] = new_state
        if new_state in {"approved", "paid", "done", "posted"}:
            updates.append("approve_date = COALESCE(approve_date, now())")
    note_column = "description" if "description" in payment_columns else "note" if "note" in payment_columns else "notes" if "notes" in payment_columns else None
    if notes and note_column:
        updates.append(f"{note_column} = :notes")
        params["notes"] = notes

    line_items = payload.get("line_items") if isinstance(payload.get("line_items"), list) else None
    normalized_lines = _normalize_payment_lines(line_items) if line_items is not None else []
    request_text = str(payload.get("request_text") or "").strip()
    if line_items is not None:
        await db.execute(text("DELETE FROM payment_request_line WHERE payment_request_id = :pr_id"), {"pr_id": live_pr_id})
        for line in normalized_lines:
            await db.execute(text("""
                INSERT INTO payment_request_line (
                    payment_request_id, item, description, amount, quantity, total,
                    create_uid, create_date, write_uid, write_date
                ) VALUES (
                    :payment_request_id, :item, :description, :amount, :quantity, :total,
                    :create_uid, now(), :write_uid, now()
                )
            """), {
                "payment_request_id": live_pr_id,
                "item": line["item"],
                "description": line["description"],
                "amount": line["amount"],
                "quantity": line["quantity"],
                "total": line["total"],
                "create_uid": user.get("odoo_user_id") or 1,
                "write_uid": user.get("odoo_user_id") or 1,
            })
        total_amount = _as_float(payload.get("total_amount")) or sum(line["total"] for line in normalized_lines)
        if total_amount <= 0 and request_text:
            total_amount = _extract_amount(request_text)
        updates.append("amount = :total_amount")
        updates.append("amount_birr = :total_amount")
        params["total_amount"] = total_amount
        if request_text or normalized_lines:
            updates.append("description = :request_text")
            params["request_text"] = request_text or "\n".join(
                f"{line['item']}: {line['description']} - {line['total']:.2f}"
                for line in normalized_lines
            )
    elif "total_amount" in payload:
        total_amount = _as_float(payload.get("total_amount")) or _extract_amount(request_text or payment_row.description or "")
        updates.append("amount = :total_amount")
        updates.append("amount_birr = :total_amount")
        params["total_amount"] = total_amount
    elif request_text:
        updates.append("description = :request_text")
        params["request_text"] = request_text

    if not updates:
        return {"detail": "No changes provided."}

    updates.append("write_uid = :write_uid")
    updates.append("write_date = now()")

    result = await db.execute(text(f"""
        UPDATE payment_request
        SET {', '.join(updates)}
        WHERE id = :pr_id
    """), params)
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Payment request not found")
    return {"detail": "Updated", "id": pr_id, "state": new_state, "updated_by": user["username"]}


@router.delete("/payment-request/{pr_id}")
async def delete_payment_request(
    pr_id: str,
    db: AsyncSession = Depends(get_session),
    user: dict = Depends(require_manager),
) -> dict:
    """Delete a payment request and its line items (manager only)."""
    try:
        live_pr_id = int(pr_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Payment request not found")

    # Delete line items first
    await db.execute(text("DELETE FROM payment_request_line WHERE payment_request_id = :pr_id"), {"pr_id": live_pr_id})
    # Delete the payment request
    result = await db.execute(text("DELETE FROM payment_request WHERE id = :pr_id"), {"pr_id": live_pr_id})
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Payment request not found")
    return {"detail": "Deleted", "id": pr_id, "deleted_by": user["username"]}


@router.get("/finance-summary")
async def finance_summary_report(
    period: str = Query("daily", pattern="^(daily|weekly|monthly|yearly)$"),
    group_by: str = Query("all", pattern="^(all|supervisor|vehicle)$"),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    refresh: bool = Query(False),
    db: AsyncSession = Depends(get_session),
) -> dict:
    cache_key = f"fleet:reports:finance-summary:v6:{period}:{group_by}:{from_date or ''}:{to_date or ''}"
    if not refresh:
        cached = cache_get(cache_key) or cache_get_stale(cache_key)
        if cached is not None:
            return cached

    date_trunc_unit = {"daily": "day", "weekly": "week", "monthly": "month", "yearly": "year"}[period]
    group_sql = {
        "all": "CAST('All' AS text)",
        "supervisor": "COALESCE(supervisor_partner.name, 'Unassigned supervisor')",
        "vehicle": "COALESCE(v.license_plate, 'Unassigned vehicle')",
    }[group_by]
    params = {"from_date": from_date, "to_date": to_date}
    try:
        rows = await db.execute(text(f"""
        WITH vehicle_latest_trip AS (
            SELECT DISTINCT ON (vehicle_id)
                vehicle_id,
                id AS trip_id
            FROM trip_trip
            WHERE vehicle_id IS NOT NULL
            ORDER BY vehicle_id, COALESCE(departure_date, create_date::date) DESC NULLS LAST, id DESC
        ),
        vehicle_latest_recv AS (
            SELECT DISTINCT ON (tt.vehicle_id)
                tt.vehicle_id,
                rr.id AS receivable_id,
                rr.trip_id AS source_trip_id,
                rr.amount_due
            FROM trip_receivable rr
            JOIN trip_trip tt ON tt.id = rr.trip_id
            WHERE COALESCE(rr.amount_due, 0) <> 0
            ORDER BY tt.vehicle_id, rr.date_created DESC NULLS LAST, rr.write_date DESC NULLS LAST, rr.id DESC
        ),
        moved_recv AS (
            SELECT lr.receivable_id, lt.trip_id AS trip_id, lr.amount_due
            FROM vehicle_latest_recv lr
            JOIN vehicle_latest_trip lt ON lt.vehicle_id = lr.vehicle_id
            WHERE false
              AND lt.trip_id <> lr.source_trip_id
              AND NOT EXISTS (
                  SELECT 1 FROM trip_receivable own
                  WHERE own.trip_id = lt.trip_id AND COALESCE(own.amount_due, 0) <> 0
              )
        ),
        attributed_receivable AS (
            SELECT rr.trip_id, rr.amount_due
            FROM trip_receivable rr
            WHERE NOT EXISTS (SELECT 1 FROM moved_recv m WHERE m.receivable_id = rr.id)
            UNION ALL
            SELECT m.trip_id, m.amount_due FROM moved_recv m
        ),
        revenue AS (
            SELECT trip_id, COALESCE(SUM(amount_due), 0) AS amount
            FROM attributed_receivable
            GROUP BY trip_id
        ),
        expense_requests AS (
            SELECT
                pr.trip_id,
                COALESCE(SUM(COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), pr.amount_birr, pr.amount, 0)), 0) AS amount
            FROM payment_request pr
            LEFT JOIN payment_request_line prl ON prl.payment_request_id = pr.id
            WHERE COALESCE(pr.is_trip_payment, false) = true
            GROUP BY pr.trip_id
        ),
        expenses AS (
            SELECT
                trip_id,
                COALESCE(SUM(COALESCE(total_expense, amount * COALESCE(quantity, 1), 0)), 0) AS amount
            FROM trip_expense_line
            GROUP BY trip_id
        )
        SELECT
            date_trunc('{date_trunc_unit}', COALESCE(t.departure_date, t.create_date))::date AS period_start,
            {group_sql} AS group_label,
            COUNT(DISTINCT t.id) AS trip_count,
            COALESCE(SUM(CASE WHEN COALESCE(r.amount, 0) > 0 THEN r.amount ELSE 0 END), 0) AS revenue_total,
            COALESCE(SUM(COALESCE(NULLIF(e.amount, 0), er.amount, 0)), 0) AS expense_total,
            COALESCE(SUM(CASE WHEN COALESCE(r.amount, 0) > 0 THEN COALESCE(r.amount, 0) - COALESCE(NULLIF(e.amount, 0), er.amount, 0) ELSE 0 END), 0) AS posted_profit,
            COALESCE(SUM(CASE WHEN COALESCE(r.amount, 0) = 0 THEN COALESCE(NULLIF(e.amount, 0), er.amount, 0) ELSE 0 END), 0) AS pending_cost
        FROM trip_trip t
        LEFT JOIN revenue r ON r.trip_id = t.id
        LEFT JOIN expenses e ON e.trip_id = t.id
        LEFT JOIN expense_requests er ON er.trip_id = t.id
        LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
        LEFT JOIN LATERAL (
            SELECT fvs.user_id
            FROM fleet_vehicle_supervisor fvs
            WHERE fvs.vehicle_id = t.vehicle_id
            ORDER BY fvs.write_date DESC NULLS LAST, fvs.create_date DESC NULLS LAST, fvs.id DESC
            LIMIT 1
        ) vehicle_supervisor ON true
        LEFT JOIN res_users supervisor_user ON supervisor_user.id = vehicle_supervisor.user_id
        LEFT JOIN res_partner supervisor_partner ON supervisor_partner.id = supervisor_user.partner_id
        WHERE (CAST(:from_date AS date) IS NULL OR COALESCE(t.departure_date, t.create_date)::date >= CAST(:from_date AS date))
          AND (CAST(:to_date AS date) IS NULL OR COALESCE(t.departure_date, t.create_date)::date <= CAST(:to_date AS date))
          AND COALESCE(t.departure_date, t.create_date) IS NOT NULL
          AND (COALESCE(r.amount, 0) <> 0 OR COALESCE(NULLIF(e.amount, 0), er.amount, 0) <> 0)
        GROUP BY 1, 2
        ORDER BY period_start DESC, group_label
        LIMIT 120
    """), params)
    except (asyncio.TimeoutError, Exception):
        saved = cache_get_stale(cache_key)
        if isinstance(saved, dict):
            saved = dict(saved)
            saved["_warning"] = "Showing the saved copy. The live database did not answer."
            return saved
        raise
    periods = []
    for row in rows.fetchall():
        revenue = _as_float(row.revenue_total)
        expense = _as_float(row.expense_total)
        periods.append({
            "period_start": str(row.period_start),
            "group_by": group_by,
            "group_label": row.group_label,
            "trip_count": row.trip_count or 0,
            "revenue_total": revenue,
            "expense_total": expense,
            "profit": _as_float(row.posted_profit),
            "pending_cost": _as_float(row.pending_cost),
        })
    response = {
        "period": period,
        "group_by": group_by,
        "periods": periods,
        "totals": {
            "trip_count": sum(row["trip_count"] for row in periods),
            "revenue_total": sum(row["revenue_total"] for row in periods),
            "expense_total": sum(row["expense_total"] for row in periods),
            "profit": sum(row["profit"] for row in periods),
            "pending_cost": sum(row["pending_cost"] for row in periods),
        },
    }
    cache_set(cache_key, response)
    return response


_FINANCE_TRIP_CTE = """
WITH vehicle_latest_trip AS (
    SELECT DISTINCT ON (vehicle_id)
        vehicle_id,
        id AS trip_id
    FROM trip_trip
    WHERE vehicle_id IS NOT NULL
    ORDER BY vehicle_id, COALESCE(departure_date, create_date::date) DESC NULLS LAST, id DESC
),
vehicle_latest_recv AS (
    SELECT DISTINCT ON (tt.vehicle_id)
        tt.vehicle_id,
        rr.id AS receivable_id,
        rr.trip_id AS source_trip_id,
        rr.amount_due,
        rr.customer_name
    FROM trip_receivable rr
    JOIN trip_trip tt ON tt.id = rr.trip_id
    WHERE COALESCE(rr.amount_due, 0) <> 0
    ORDER BY tt.vehicle_id, rr.date_created DESC NULLS LAST, rr.write_date DESC NULLS LAST, rr.id DESC
),
moved_recv AS (
    SELECT lr.receivable_id, lt.trip_id AS trip_id, lr.amount_due, lr.customer_name
    FROM vehicle_latest_recv lr
    JOIN vehicle_latest_trip lt ON lt.vehicle_id = lr.vehicle_id
    WHERE false
      AND lt.trip_id <> lr.source_trip_id
      AND NOT EXISTS (
          SELECT 1 FROM trip_receivable own
          WHERE own.trip_id = lt.trip_id AND COALESCE(own.amount_due, 0) <> 0
      )
),
attributed_receivable AS (
    SELECT rr.trip_id, rr.amount_due, rr.customer_name
    FROM trip_receivable rr
    WHERE NOT EXISTS (SELECT 1 FROM moved_recv m WHERE m.receivable_id = rr.id)
    UNION ALL
    SELECT m.trip_id, m.amount_due, m.customer_name FROM moved_recv m
),
revenue AS (
    SELECT
        trip_id,
        COALESCE(SUM(amount_due), 0) AS amount,
        MAX(customer_name) AS customer_name
    FROM attributed_receivable
    GROUP BY trip_id
),
expense_requests AS (
    SELECT
        pr.trip_id,
        COALESCE(SUM(COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), pr.amount_birr, pr.amount, 0)), 0) AS amount
    FROM payment_request pr
    LEFT JOIN payment_request_line prl ON prl.payment_request_id = pr.id
    WHERE COALESCE(pr.is_trip_payment, false) = true
    GROUP BY pr.trip_id
),
expenses AS (
    SELECT
        trip_id,
        COALESCE(SUM(COALESCE(total_expense, amount * COALESCE(quantity, 1), 0)), 0) AS amount
    FROM trip_expense_line
    GROUP BY trip_id
),
bounds AS (
    SELECT
        anchor AS today,
        date_trunc('week', anchor)::date AS week_start,
        (date_trunc('week', anchor)::date + 6) AS week_end,
        date_trunc('month', anchor)::date AS month_start,
        (date_trunc('month', anchor) + interval '1 month' - interval '1 day')::date AS month_end,
        date_trunc('year', anchor)::date AS year_start,
        (date_trunc('year', anchor) + interval '1 year' - interval '1 day')::date AS year_end
    FROM (
        SELECT COALESCE(CAST(:as_of AS date), (now() AT TIME ZONE 'Africa/Addis_Ababa')::date) AS anchor
    ) chosen
),
trip_finance AS (
    SELECT
        t.id AS trip_id,
        COALESCE(NULLIF(t.name, ''), 'Trip #' || t.id::text) AS trip_name,
        COALESCE(t.departure_date, t.create_date) AS trip_ts,
        COALESCE(t.departure_date, t.create_date)::date AS trip_day,
        COALESCE(driver.name, 'Unassigned') AS driver_name,
        COALESCE(v.license_plate, 'Unassigned vehicle') AS plate_number,
        departure.name AS departure_name,
        destination.name AS destination_name,
        COALESCE(supervisor_partner.name, 'Unassigned supervisor') AS supervisor_name,
        COALESCE(r.amount, 0) AS revenue_total,
        COALESCE(e.amount, 0) AS expense_line_total,
        COALESCE(er.amount, 0) AS request_total,
        COALESCE(NULLIF(e.amount, 0), er.amount, 0) AS cost_total,
        CASE WHEN COALESCE(e.amount, 0) <> 0 THEN 'expense_lines' ELSE 'payment_request' END AS cost_source,
        r.customer_name AS customer_name
    FROM trip_trip t
    LEFT JOIN revenue r ON r.trip_id = t.id
    LEFT JOIN expenses e ON e.trip_id = t.id
    LEFT JOIN expense_requests er ON er.trip_id = t.id
    LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
    LEFT JOIN hr_employee driver ON t.driver_id = driver.id
    LEFT JOIN trip_location departure ON t.departure_id = departure.id
    LEFT JOIN trip_location destination ON t.destination_id = destination.id
    LEFT JOIN LATERAL (
        SELECT fvs.user_id
        FROM fleet_vehicle_supervisor fvs
        WHERE fvs.vehicle_id = t.vehicle_id
        ORDER BY fvs.write_date DESC NULLS LAST, fvs.create_date DESC NULLS LAST, fvs.id DESC
        LIMIT 1
    ) vehicle_supervisor ON true
    LEFT JOIN res_users supervisor_user ON supervisor_user.id = vehicle_supervisor.user_id
    LEFT JOIN res_partner supervisor_partner ON supervisor_partner.id = supervisor_user.partner_id
    WHERE COALESCE(t.departure_date, t.create_date) IS NOT NULL
      AND (COALESCE(r.amount, 0) <> 0 OR COALESCE(NULLIF(e.amount, 0), er.amount, 0) <> 0)
)
"""


def _finance_trip_payload(row) -> dict:
    revenue = _as_float(row.revenue_total)
    cost = _as_float(row.cost_total)
    posted = revenue > 0
    route_parts = [part for part in (row.departure_name, row.destination_name) if part]
    return {
        "trip_id": row.trip_id,
        "trip_name": row.trip_name,
        "trip_day": str(row.trip_day) if row.trip_day else None,
        "driver_name": row.driver_name,
        "plate_number": row.plate_number,
        "route": "-".join(route_parts),
        "supervisor_name": row.supervisor_name,
        "customer_name": row.customer_name or "",
        "revenue_total": revenue if posted else 0,
        "cost_total": cost,
        "profit": (revenue - cost) if posted else 0,
        "pending_cost": 0 if posted else cost,
        "receivable_posted": posted,
        "cost_source": row.cost_source,
        "expense_line_total": _as_float(row.expense_line_total),
        "request_total": _as_float(row.request_total),
    }


def _finance_card(key: str, label: str, start, end, trips: int, revenue, cost, profit, pending) -> dict:
    return {
        "key": key,
        "label": label,
        "period_start": str(start),
        "period_end": str(end),
        "trip_count": trips or 0,
        "revenue_total": _as_float(revenue),
        "expense_total": _as_float(cost),
        "profit": _as_float(profit),
        "pending_cost": _as_float(pending),
    }


@router.get("/finance-cards")
async def finance_cards_report(
    as_of: Optional[date] = Query(None),
    refresh: bool = Query(False),
    db: AsyncSession = Depends(get_session),
) -> dict:
    cache_key = f"fleet:reports:finance-cards:v4:{as_of or 'today'}"
    if not refresh:
        cached = cache_get(cache_key) or cache_get_stale(cache_key)
        if cached is not None:
            return cached

    try:
        row = (await db.execute(text(_FINANCE_TRIP_CTE + """
        SELECT
            b.today,
            b.week_start,
            b.week_end,
            b.month_start,
            b.month_end,
            b.year_start,
            b.year_end,
            COUNT(f.trip_id) FILTER (WHERE f.trip_day = b.today) AS daily_trips,
            COALESCE(SUM(f.revenue_total) FILTER (WHERE f.trip_day = b.today AND f.revenue_total > 0), 0) AS daily_revenue,
            COALESCE(SUM(f.cost_total) FILTER (WHERE f.trip_day = b.today), 0) AS daily_cost,
            COALESCE(SUM(CASE WHEN f.trip_day = b.today AND f.revenue_total > 0 THEN f.revenue_total - f.cost_total ELSE 0 END), 0) AS daily_profit,
            COALESCE(SUM(CASE WHEN f.trip_day = b.today AND f.revenue_total = 0 THEN f.cost_total ELSE 0 END), 0) AS daily_pending,
            COUNT(f.trip_id) FILTER (WHERE f.trip_day BETWEEN b.week_start AND b.week_end) AS weekly_trips,
            COALESCE(SUM(f.revenue_total) FILTER (WHERE f.trip_day BETWEEN b.week_start AND b.week_end AND f.revenue_total > 0), 0) AS weekly_revenue,
            COALESCE(SUM(f.cost_total) FILTER (WHERE f.trip_day BETWEEN b.week_start AND b.week_end), 0) AS weekly_cost,
            COALESCE(SUM(CASE WHEN f.trip_day BETWEEN b.week_start AND b.week_end AND f.revenue_total > 0 THEN f.revenue_total - f.cost_total ELSE 0 END), 0) AS weekly_profit,
            COALESCE(SUM(CASE WHEN f.trip_day BETWEEN b.week_start AND b.week_end AND f.revenue_total = 0 THEN f.cost_total ELSE 0 END), 0) AS weekly_pending,
            COUNT(f.trip_id) FILTER (WHERE f.trip_day BETWEEN b.month_start AND b.month_end) AS monthly_trips,
            COALESCE(SUM(f.revenue_total) FILTER (WHERE f.trip_day BETWEEN b.month_start AND b.month_end AND f.revenue_total > 0), 0) AS monthly_revenue,
            COALESCE(SUM(f.cost_total) FILTER (WHERE f.trip_day BETWEEN b.month_start AND b.month_end), 0) AS monthly_cost,
            COALESCE(SUM(CASE WHEN f.trip_day BETWEEN b.month_start AND b.month_end AND f.revenue_total > 0 THEN f.revenue_total - f.cost_total ELSE 0 END), 0) AS monthly_profit,
            COALESCE(SUM(CASE WHEN f.trip_day BETWEEN b.month_start AND b.month_end AND f.revenue_total = 0 THEN f.cost_total ELSE 0 END), 0) AS monthly_pending,
            COUNT(f.trip_id) FILTER (WHERE f.trip_day BETWEEN b.year_start AND b.year_end) AS yearly_trips,
            COALESCE(SUM(f.revenue_total) FILTER (WHERE f.trip_day BETWEEN b.year_start AND b.year_end AND f.revenue_total > 0), 0) AS yearly_revenue,
            COALESCE(SUM(f.cost_total) FILTER (WHERE f.trip_day BETWEEN b.year_start AND b.year_end), 0) AS yearly_cost,
            COALESCE(SUM(CASE WHEN f.trip_day BETWEEN b.year_start AND b.year_end AND f.revenue_total > 0 THEN f.revenue_total - f.cost_total ELSE 0 END), 0) AS yearly_profit,
            COALESCE(SUM(CASE WHEN f.trip_day BETWEEN b.year_start AND b.year_end AND f.revenue_total = 0 THEN f.cost_total ELSE 0 END), 0) AS yearly_pending
        FROM bounds b
        LEFT JOIN trip_finance f ON true
        GROUP BY b.today, b.week_start, b.week_end, b.month_start, b.month_end, b.year_start, b.year_end
    """), {"as_of": as_of})).one()
    except (asyncio.TimeoutError, Exception):
        saved = cache_get_stale(cache_key)
        if isinstance(saved, dict):
            saved = dict(saved)
            saved["_warning"] = "Showing the saved copy. The live database did not answer."
            return saved
        raise
    response = {
        "as_of": str(row.today),
        "timezone": "Africa/Addis_Ababa",
        "cards": [
            _finance_card("daily", "Daily profit", row.today, row.today, row.daily_trips, row.daily_revenue, row.daily_cost, row.daily_profit, row.daily_pending),
            _finance_card("weekly", "Weekly profit", row.week_start, row.week_end, row.weekly_trips, row.weekly_revenue, row.weekly_cost, row.weekly_profit, row.weekly_pending),
            _finance_card("monthly", "Monthly profit", row.month_start, row.month_end, row.monthly_trips, row.monthly_revenue, row.monthly_cost, row.monthly_profit, row.monthly_pending),
            _finance_card("yearly", "Yearly profit", row.year_start, row.year_end, row.yearly_trips, row.yearly_revenue, row.yearly_cost, row.yearly_profit, row.yearly_pending),
        ],
    }
    cache_set(cache_key, response, ttl_seconds=60)
    return response


@router.get("/finance-trips")
async def finance_trips_report(
    window: str = Query("line", pattern="^(card|line)$"),
    period: str = Query("daily", pattern="^(daily|weekly|monthly|yearly)$"),
    period_start: Optional[date] = Query(None),
    group_by: str = Query("all", pattern="^(all|supervisor|vehicle)$"),
    group_label: str = Query(""),
    as_of: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_session),
) -> dict:
    if window == "line" and period_start is None:
        raise HTTPException(status_code=400, detail="period_start is required")

    cache_key = f"fleet:reports:finance-trips:v4:{window}:{period}:{period_start or ''}:{group_by}:{group_label}:{as_of or ''}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    rows = await db.execute(text(_FINANCE_TRIP_CTE + """
        SELECT f.*
        FROM trip_finance f
        CROSS JOIN bounds b
        WHERE (
            (:window = 'card' AND (
                (:period = 'daily' AND f.trip_day = b.today)
                OR (:period = 'weekly' AND f.trip_day BETWEEN b.week_start AND b.week_end)
                OR (:period = 'monthly' AND f.trip_day BETWEEN b.month_start AND b.month_end)
                OR (:period = 'yearly' AND f.trip_day BETWEEN b.year_start AND b.year_end)
            ))
            OR (:window = 'line' AND (
                (:period = 'daily' AND date_trunc('day', f.trip_ts)::date = :period_start)
                OR (:period = 'weekly' AND date_trunc('week', f.trip_ts)::date = :period_start)
                OR (:period = 'monthly' AND date_trunc('month', f.trip_ts)::date = :period_start)
                OR (:period = 'yearly' AND date_trunc('year', f.trip_ts)::date = :period_start)
            ) AND (
                :group_by = 'all'
                OR (:group_by = 'supervisor' AND f.supervisor_name = :group_label)
                OR (:group_by = 'vehicle' AND f.plate_number = :group_label)
            ))
        )
        ORDER BY f.trip_day DESC, f.plate_number, f.trip_id
        LIMIT 500
    """), {
        "window": window,
        "period": period,
        "period_start": period_start,
        "group_by": group_by,
        "group_label": group_label,
        "as_of": as_of,
    })
    trips = [_finance_trip_payload(row) for row in rows.fetchall()]
    response = {"window": window, "period": period, "trips": trips}
    cache_set(cache_key, response, ttl_seconds=60)
    return response


@router.get("/finance-trips/{trip_id}")
async def finance_trip_detail(trip_id: int, db: AsyncSession = Depends(get_session)) -> dict:
    cache_key = f"fleet:reports:finance-trip-detail:v2:{trip_id}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    row = (await db.execute(
        text(_FINANCE_TRIP_CTE + "SELECT * FROM trip_finance WHERE trip_id = :trip_id"),
        {"trip_id": trip_id, "as_of": None},
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Trip not found in the finance summary")

    receivables = await db.execute(text("""
        SELECT customer_name, amount_due, state, date_created
        FROM trip_receivable
        WHERE trip_id = :trip_id
        ORDER BY id
    """), {"trip_id": trip_id})
    expenses = await db.execute(text("""
        SELECT
            COALESCE(et.name, 'Expense') AS type_name,
            el.description,
            el.quantity,
            el.amount,
            COALESCE(el.total_expense, el.amount * COALESCE(el.quantity, 1), 0) AS total
        FROM trip_expense_line el
        LEFT JOIN trip_expense_type et ON et.id = el.expense_type_id
        WHERE el.trip_id = :trip_id
        ORDER BY el.id
    """), {"trip_id": trip_id})
    payments = await db.execute(text("""
        SELECT
            pr.id AS request_id,
            COALESCE(NULLIF(pr.name, ''), 'Request #' || pr.id::text) AS request_name,
            pr.state,
            COALESCE(prl.item, 'Payment request') AS item,
            prl.description,
            prl.quantity,
            COALESCE(prl.amount, pr.amount_birr, pr.amount, 0) AS amount,
            COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), pr.amount_birr, pr.amount, 0) AS total
        FROM payment_request pr
        LEFT JOIN payment_request_line prl ON prl.payment_request_id = pr.id
        WHERE pr.trip_id = :trip_id
          AND COALESCE(pr.is_trip_payment, false) = true
        ORDER BY pr.id, prl.id
    """), {"trip_id": trip_id})

    payload = _finance_trip_payload(row)
    payload["receivables"] = [
        {
            "customer_name": item.customer_name or "",
            "amount_due": _as_float(item.amount_due),
            "state": item.state or "",
            "date_created": str(item.date_created) if item.date_created else None,
        }
        for item in receivables.fetchall()
    ]
    payload["expense_lines"] = [
        {
            "type_name": item.type_name,
            "description": item.description or "",
            "quantity": _as_float(item.quantity),
            "amount": _as_float(item.amount),
            "total": _as_float(item.total),
        }
        for item in expenses.fetchall()
    ]
    payload["payment_lines"] = [
        {
            "request_id": item.request_id,
            "request_name": item.request_name,
            "state": item.state or "",
            "item": item.item or "",
            "description": item.description or "",
            "quantity": _as_float(item.quantity),
            "amount": _as_float(item.amount),
            "total": _as_float(item.total),
        }
        for item in payments.fetchall()
    ]
    cache_set(cache_key, payload, ttl_seconds=60)
    return payload


@router.get("/daily-profit")
async def daily_profit_report(
    report_date: Optional[date] = Query(None),
    refresh: bool = Query(False),
    db: AsyncSession = Depends(get_session),
) -> dict:
    requested = report_date.isoformat() if report_date else None
    cache_key = f"fleet:reports:daily-profit:v16:{requested or 'today'}"
    lookup_keys = [cache_key]
    if requested is None or requested == datetime.now(ZoneInfo("Africa/Addis_Ababa")).date().isoformat():
        lookup_keys.append("fleet:reports:daily-profit:v16:today")
    if not refresh:
        for key in lookup_keys:
            cached = cache_get(key) or cache_get_stale(key)
            if cached is not None:
                target_date = requested or cached.get("report_date") or datetime.now(ZoneInfo("Africa/Addis_Ababa")).date().isoformat()
                custom_map = get_custom_entries(target_date)
                if custom_map and isinstance(cached.get("rows"), list):
                    for r in cached["rows"]:
                        rk = r.get("row_key") or f"{r.get('plate_number')}:{r.get('trip_id') or r.get('no')}"
                        r["row_key"] = rk
                        c = custom_map.get(rk) or custom_map.get(f"plate:{r.get('plate_number')}") or custom_map.get(f"trip:{r.get('trip_id')}")
                        if c:
                            r["actual"] = c.get("actual")
                            if c.get("remark") is not None:
                                r["remark"] = c.get("remark")
                    cached["totals"] = _daily_profit_totals(cached["rows"])
                return cached

    rows_result = await db.execute(text("""
        WITH vehicle_latest_trip AS (
            SELECT DISTINCT ON (vehicle_id)
                vehicle_id,
                id AS trip_id
            FROM trip_trip
            WHERE vehicle_id IS NOT NULL
            ORDER BY vehicle_id, COALESCE(departure_date, create_date::date) DESC NULLS LAST, id DESC
        ),
        vehicle_latest_recv AS (
            SELECT DISTINCT ON (tt.vehicle_id)
                tt.vehicle_id,
                rr.id AS receivable_id,
                rr.name AS receivable_name,
                rr.trip_id AS source_trip_id,
                rr.amount_due,
                rr.state,
                rr.customer_name,
                tt.name AS source_trip_name,
                COALESCE(tt.departure_date, tt.create_date)::date AS source_day
            FROM trip_receivable rr
            JOIN trip_trip tt ON tt.id = rr.trip_id
            WHERE COALESCE(rr.amount_due, 0) <> 0
            ORDER BY tt.vehicle_id, rr.date_created DESC NULLS LAST, rr.write_date DESC NULLS LAST, rr.id DESC
        ),
        moved_recv AS (
            SELECT
                lr.receivable_id,
                lr.receivable_name,
                lr.source_trip_id,
                lt.trip_id AS target_trip_id,
                lr.amount_due,
                lr.state,
                lr.customer_name,
                lr.source_trip_name,
                lr.source_day
            FROM vehicle_latest_recv lr
            JOIN vehicle_latest_trip lt ON lt.vehicle_id = lr.vehicle_id
            WHERE false
              AND lt.trip_id <> lr.source_trip_id
              AND NOT EXISTS (
                  SELECT 1
                  FROM trip_receivable own
                  WHERE own.trip_id = lt.trip_id
                    AND COALESCE(own.amount_due, 0) <> 0
              )
        ),
        attributed_receivable AS (
            SELECT
                rr.trip_id,
                rr.amount_due,
                rr.state,
                rr.customer_name,
                false AS moved
            FROM trip_receivable rr
            WHERE NOT EXISTS (
                SELECT 1 FROM moved_recv m WHERE m.receivable_id = rr.id
            )
            UNION ALL
            SELECT
                m.target_trip_id,
                m.amount_due,
                m.state,
                m.customer_name,
                true AS moved
            FROM moved_recv m
        ),
        revenue AS (
            SELECT
                trip_id,
                COALESCE(SUM(amount_due), 0) AS amount,
                COALESCE(SUM(
                    CASE
                        WHEN LOWER(COALESCE(state, '')) NOT IN ('confirmed', 'approved', 'paid', 'done', 'posted', 'reconciled')
                        THEN amount_due
                        ELSE 0
                    END
                ), 0) AS unconfirmed_amount,
                MAX(customer_name) AS customer_name,
                BOOL_OR(moved) AS revenue_moved
            FROM attributed_receivable
            GROUP BY trip_id
        ),
        expense_requests AS (
            SELECT
                pr.trip_id,
                COALESCE(SUM(COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), pr.amount_birr, pr.amount, 0)), 0) AS amount
            FROM payment_request pr
            LEFT JOIN payment_request_line prl ON prl.payment_request_id = pr.id
            WHERE COALESCE(pr.is_trip_payment, false) = true
            GROUP BY pr.trip_id
        ),
        expenses AS (
            SELECT
                trip_id,
                COALESCE(SUM(COALESCE(total_expense, amount * COALESCE(quantity, 1), 0)), 0) AS amount
            FROM trip_expense_line
            GROUP BY trip_id
        ),
        revenue_notes AS (
            SELECT
                trip_id,
                string_agg(DISTINCT NULLIF(btrim(description), ''), ' · ') AS revenue_description
            FROM trip_revenue_line
            GROUP BY trip_id
        ),
        trip_rows AS (
            SELECT
                t.id AS trip_id,
                COALESCE(t.departure_date, t.create_date)::date AS trip_day,
                driver.name AS driver_name,
                v.license_plate AS plate_number,
                departure.name AS departure_name,
                destination.name AS destination_name,
                COALESCE(r.amount, 0) AS revenue_total,
                COALESCE(r.unconfirmed_amount, 0) AS unconfirmed_amount,
                COALESCE(e.amount, 0) AS cost_total,
                r.customer_name AS customer_name,
                NULL::numeric AS latest_receivable_amount,
                NULL::text AS latest_receivable_state,
                NULL::text AS latest_receivable_trip,
                NULL::date AS latest_receivable_day,
                NULL::text AS counted_from_receivable,
                NULL::text AS counted_from_trip,
                NULL::date AS counted_from_day,
                NULL::text AS source_note,
                notes.revenue_description
            FROM trip_trip t
            LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
            LEFT JOIN hr_employee driver ON t.driver_id = driver.id
            LEFT JOIN trip_location departure ON t.departure_id = departure.id
            LEFT JOIN trip_location destination ON t.destination_id = destination.id
            LEFT JOIN revenue r ON r.trip_id = t.id
            LEFT JOIN expenses e ON e.trip_id = t.id
            LEFT JOIN revenue_notes notes ON notes.trip_id = t.id
            WHERE COALESCE(t.departure_date, t.create_date) IS NOT NULL
              AND (COALESCE(r.amount, 0) <> 0 OR COALESCE(e.amount, 0) <> 0)
        ),
        created_requests AS (
            SELECT
                pr.id AS payment_request_id,
                pr.name AS payment_request_name,
                pr.trip_id,
                pr.requester_id,
                (pr.create_date AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Addis_Ababa')::date AS request_day,
                COALESCE(SUM(COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), pr.amount_birr, pr.amount, 0)), 0) AS amount,
                string_agg(DISTINCT NULLIF(COALESCE(prl.description, prl.item, ''), ''), ' · ') AS line_note
            FROM payment_request pr
            LEFT JOIN payment_request_line prl ON prl.payment_request_id = pr.id
            WHERE pr.trip_id IS NOT NULL
            GROUP BY pr.id, pr.name, pr.trip_id, pr.requester_id, pr.create_date
        ),
        request_groups AS (
            SELECT
                trip_id,
                request_day,
                SUM(amount) AS amount,
                string_agg(payment_request_name, ', ' ORDER BY payment_request_id) AS payment_request_name,
                string_agg(DISTINCT NULLIF(line_note, ''), ' · ') AS line_note,
                MIN(payment_request_id) AS payment_request_id
            FROM created_requests
            GROUP BY trip_id, request_day
        ),
        target AS (
            SELECT COALESCE(
                :report_date,
                (now() AT TIME ZONE 'Africa/Addis_Ababa')::date
            ) AS report_day
        ),
        request_rows AS (
            SELECT
                COALESCE(t.id, -rg.payment_request_id) AS trip_id,
                rg.request_day AS trip_day,
                driver.name AS driver_name,
                COALESCE(
                    v.license_plate,
                    NULLIF(substring(COALESCE(rg.line_note, '') from '[Pp]late[[:space:]]*[Nn]o[[:space:]]*([0-9]+)'), '')
                ) AS plate_number,
                departure.name AS departure_name,
                destination.name AS destination_name,
                COALESCE(r.amount, 0) AS revenue_total,
                COALESCE(r.unconfirmed_amount, 0) AS unconfirmed_amount,
                rg.amount AS cost_total,
                r.customer_name AS customer_name,
                NULL::numeric AS latest_receivable_amount,
                NULL::text AS latest_receivable_state,
                NULL::text AS latest_receivable_trip,
                NULL::date AS latest_receivable_day,
                NULL::text AS counted_from_receivable,
                NULL::text AS counted_from_trip,
                NULL::date AS counted_from_day,
                NULL::text AS source_note,
                notes.revenue_description
            FROM request_groups rg
            JOIN target ON rg.request_day = target.report_day
            LEFT JOIN trip_trip t ON t.id = rg.trip_id
            LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
            LEFT JOIN hr_employee driver ON t.driver_id = driver.id
            LEFT JOIN trip_location departure ON t.departure_id = departure.id
            LEFT JOIN trip_location destination ON t.destination_id = destination.id
            LEFT JOIN revenue r ON r.trip_id = rg.trip_id
            LEFT JOIN revenue_notes notes ON notes.trip_id = rg.trip_id
            WHERE COALESCE(rg.amount, 0) <> 0
              AND NOT EXISTS (
                  SELECT 1
                  FROM trip_rows existing
                  JOIN target report_target ON existing.trip_day = report_target.report_day
                  WHERE existing.trip_id = rg.trip_id
              )
        ),
        report_rows AS (
            SELECT trip_rows.*
            FROM trip_rows
            JOIN target ON trip_rows.trip_day = target.report_day
            UNION ALL
            SELECT * FROM request_rows
        )
        SELECT
            ROW_NUMBER() OVER (ORDER BY plate_number NULLS LAST, driver_name NULLS LAST, trip_id) AS no,
            report_rows.*
        FROM report_rows
        ORDER BY no
        LIMIT 500
    """), {"report_date": report_date})
    custom_map = get_custom_entries(requested or datetime.now(ZoneInfo("Africa/Addis_Ababa")).date().isoformat())
    rows = []
    for row in rows_result.fetchall():
        revenue = _as_float(row.revenue_total)
        unconfirmed = _as_float(row.unconfirmed_amount)
        cost = _as_float(row.cost_total)
        receivable_posted = revenue > 0
        profit = revenue - cost
        route_parts = [part for part in (row.departure_name, row.destination_name) if part]
        route = "-".join(route_parts) if route_parts else ""
        note = ""
        row_key = f"{row.plate_number}:{row.trip_id}" if row.trip_id else f"{row.plate_number}:{row.no}"
        custom = custom_map.get(row_key) or custom_map.get(f"plate:{row.plate_number}") or custom_map.get(f"trip:{row.trip_id}") or {}
        actual_val = custom.get("actual")
        remark_val = custom.get("remark") if custom.get("remark") is not None else (row.revenue_description or "")

        rows.append({
            "no": row.no,
            "row_key": row_key,
            "driver_name": row.driver_name or "Unassigned",
            "plate_number": row.plate_number or "N/A",
            "rent_amount": revenue,
            "daily_total_cost": cost,
            "actual_daily_total_revenue": revenue,
            "actual": actual_val,
            "unconfirmed_amount": unconfirmed,
            "latest_receivable_amount": 0,
            "latest_receivable_state": "",
            "latest_receivable_trip": "",
            "latest_receivable_day": None,
            "actual_net_profit": profit,
            "daily_net_profit": profit,
            "receivable_posted": receivable_posted,
            "profit_note": note,
            "remarks": route,
            "remark": remark_val,
            "revenue_description": row.revenue_description or "",
            "trip_id": row.trip_id,
            "report_date": str(row.trip_day) if row.trip_day else None,
        })
    effective_date = str(rows[0]["report_date"]) if rows else (str(report_date) if report_date else None)
    if effective_date and effective_date != (requested or "today"):
        eff_custom_map = get_custom_entries(effective_date)
        if eff_custom_map:
            for r in rows:
                c = eff_custom_map.get(r["row_key"]) or eff_custom_map.get(f"plate:{r['plate_number']}") or eff_custom_map.get(f"trip:{r['trip_id']}")
                if c:
                    r["actual"] = c.get("actual")
                    if c.get("remark") is not None:
                        r["remark"] = c.get("remark")
    response = {
        "report_date": effective_date,
        "rows": rows,
        "totals": _daily_profit_totals(rows),
    }
    cache_set(cache_key, response)
    return response


class DailyProfitCustomUpdate(BaseModel):
    row_key: str
    actual: Optional[str] = None
    remark: Optional[str] = None
    plate_number: Optional[str] = None
    trip_id: Optional[Union[int, str]] = None


class DailyProfitCustomPayload(BaseModel):
    report_date: str
    updates: Optional[list[DailyProfitCustomUpdate]] = None
    row_key: Optional[str] = None
    actual: Optional[str] = None
    remark: Optional[str] = None
    plate_number: Optional[str] = None
    trip_id: Optional[Union[int, str]] = None


@router.post("/daily-profit/custom")
async def save_daily_profit_custom_data(
    payload: DailyProfitCustomPayload,
    user: dict = Depends(require_manager),
) -> dict:
    """Save manager overrides for Actual and Remark on daily reports to persistent VPS storage."""
    manager_name = user.get("username") or user.get("name") or "manager"
    report_date = payload.report_date

    count = 0
    if payload.updates:
        entries = [
            {
                "row_key": item.row_key,
                "actual": item.actual,
                "remark": item.remark,
                "plate_number": item.plate_number,
                "trip_id": str(item.trip_id) if item.trip_id is not None else None,
            }
            for item in payload.updates
        ]
        count = save_custom_entries_bulk(report_date, entries, updated_by=manager_name)
    elif payload.row_key:
        save_custom_entry(
            report_date=report_date,
            row_key=payload.row_key,
            actual=payload.actual,
            remark=payload.remark,
            plate_number=payload.plate_number,
            trip_id=str(payload.trip_id) if payload.trip_id is not None else None,
            updated_by=manager_name,
        )
        count = 1

    custom_map = get_custom_entries(report_date)
    for ckey in [f"fleet:reports:daily-profit:v16:{report_date}", "fleet:reports:daily-profit:v16:today"]:
        cached = cache_get(ckey) or cache_get_stale(ckey)
        if cached and isinstance(cached.get("rows"), list):
            for r in cached["rows"]:
                rk = r.get("row_key") or f"{r.get('plate_number')}:{r.get('trip_id') or r.get('no')}"
                r["row_key"] = rk
                c = custom_map.get(rk) or custom_map.get(f"plate:{r.get('plate_number')}") or custom_map.get(f"trip:{r.get('trip_id')}")
                if c:
                    r["actual"] = c.get("actual")
                    if c.get("remark") is not None:
                        r["remark"] = c.get("remark")
            cached["totals"] = _daily_profit_totals(cached["rows"])
            cache_set(ckey, cached)
        else:
            cache_del(ckey)

    return {
        "ok": True,
        "saved_count": count,
        "report_date": report_date,
    }


@router.get("/yearly-profit")
async def yearly_profit_report(
    ethiopian_year: int = Query(...),
    refresh: bool = Query(False),
    db: AsyncSession = Depends(get_session),
    user: dict = Depends(require_user),
) -> dict:
    if user.get("role") == "supervisor":
        raise HTTPException(status_code=403, detail="Supervisors cannot open this report")
    if ethiopian_year < 1900 or ethiopian_year > 2200:
        raise HTTPException(status_code=400, detail="Ethiopian year is out of range")
    start, end = _ethiopian_year_bounds(ethiopian_year)
    cache_key = f"fleet:reports:yearly-profit:v3:{ethiopian_year}"
    if not refresh:
        cached = cache_get(cache_key) or cache_get_stale(cache_key)
        if cached is not None:
            return cached
    try:
        vehicle_result = await db.execute(text("""
            SELECT
                v.id AS vehicle_id,
                COALESCE(v.license_plate, '') AS plate_number,
                COALESCE(m.name, '') AS vehicle_type,
                COALESCE(driver.name, '') AS driver_name,
                COALESCE(supervisor_partner.name, '') AS supervisor_name
            FROM fleet_vehicle v
            LEFT JOIN fleet_vehicle_model m ON v.model_id = m.id
            LEFT JOIN hr_employee driver ON driver.id = v.driver_id
            LEFT JOIN LATERAL (
                SELECT fvs.user_id
                FROM fleet_vehicle_supervisor fvs
                WHERE fvs.vehicle_id = v.id
                ORDER BY fvs.write_date DESC NULLS LAST, fvs.create_date DESC NULLS LAST, fvs.id DESC
                LIMIT 1
            ) vehicle_supervisor ON true
            LEFT JOIN res_users supervisor_user ON supervisor_user.id = vehicle_supervisor.user_id
            LEFT JOIN res_partner supervisor_partner ON supervisor_partner.id = supervisor_user.partner_id
            WHERE COALESCE(v.active, true) = true
              AND vehicle_supervisor.user_id IS NOT NULL
            ORDER BY supervisor_partner.name NULLS LAST, driver.name NULLS LAST, v.license_plate NULLS LAST, v.id
        """))
        rows_result = await db.execute(text("""
            SELECT
                t.id AS trip_id,
                v.id AS vehicle_id,
                COALESCE(t.departure_date, t.create_date)::date AS trip_day,
                COALESCE(driver.name, '') AS driver_name,
                COALESCE(v.license_plate, '') AS plate_number,
                COALESCE(m.name, '') AS vehicle_type,
                COALESCE(supervisor_partner.name, '') AS supervisor_name,
                COALESCE(r.amount, 0) AS revenue_total,
                COALESCE(e.amount, 0) AS cost_total,
                COALESCE(notes.revenue_description, '') AS revenue_description
            FROM trip_trip t
            LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
            LEFT JOIN fleet_vehicle_model m ON v.model_id = m.id
            LEFT JOIN hr_employee driver ON t.driver_id = driver.id
            LEFT JOIN LATERAL (
                SELECT fvs.user_id
                FROM fleet_vehicle_supervisor fvs
                WHERE fvs.vehicle_id = t.vehicle_id
                ORDER BY fvs.write_date DESC NULLS LAST, fvs.create_date DESC NULLS LAST, fvs.id DESC
                LIMIT 1
            ) vehicle_supervisor ON true
            LEFT JOIN res_users supervisor_user ON supervisor_user.id = vehicle_supervisor.user_id
            LEFT JOIN res_partner supervisor_partner ON supervisor_partner.id = supervisor_user.partner_id
            LEFT JOIN (
                SELECT trip_id, COALESCE(SUM(amount_due), 0) AS amount
                FROM trip_receivable
                GROUP BY trip_id
            ) r ON r.trip_id = t.id
            LEFT JOIN (
                SELECT
                    trip_id,
                    COALESCE(SUM(COALESCE(total_expense, amount * COALESCE(quantity, 1), 0)), 0) AS amount
                FROM trip_expense_line
                GROUP BY trip_id
            ) e ON e.trip_id = t.id
            LEFT JOIN (
                SELECT
                    trip_id,
                    string_agg(DISTINCT NULLIF(btrim(description), ''), ' · ') AS revenue_description
                FROM trip_revenue_line
                GROUP BY trip_id
            ) notes ON notes.trip_id = t.id
            WHERE COALESCE(t.departure_date, t.create_date)::date BETWEEN :start AND :end
              AND (COALESCE(r.amount, 0) <> 0 OR COALESCE(e.amount, 0) <> 0)
            ORDER BY supervisor_partner.name NULLS LAST, driver.name NULLS LAST, v.license_plate NULLS LAST, trip_day, t.id
        """), {"start": start, "end": end})
    except (asyncio.TimeoutError, Exception):
        saved = cache_get_stale(cache_key)
        if isinstance(saved, dict):
            saved = dict(saved)
            saved["_warning"] = "Showing the saved copy. The live database did not answer."
            return saved
        raise
    vehicles = []
    for row in vehicle_result.fetchall():
        vehicles.append({
            "vehicle_id": row.vehicle_id,
            "plate_number": row.plate_number or "",
            "vehicle_type": row.vehicle_type or "",
            "driver_name": row.driver_name or "",
            "supervisor_name": row.supervisor_name or "",
        })
    rows = []
    for row in rows_result.fetchall():
        rows.append({
            "trip_id": row.trip_id,
            "vehicle_id": row.vehicle_id,
            "trip_day": str(row.trip_day),
            "driver_name": row.driver_name or "",
            "plate_number": row.plate_number or "",
            "vehicle_type": row.vehicle_type or "",
            "supervisor_name": row.supervisor_name or "",
            "revenue_total": _as_float(row.revenue_total),
            "cost_total": _as_float(row.cost_total),
            "revenue_description": row.revenue_description or "",
        })
    response = {
        "ethiopian_year": ethiopian_year,
        "gregorian_start": start.isoformat(),
        "gregorian_end": end.isoformat(),
        "vehicles": vehicles,
        "rows": rows,
    }
    cache_set(cache_key, response, ttl_seconds=60)
    return response


@router.get("/income-statement")
async def income_statement_report(
    refresh: bool = Query(False),
    db: AsyncSession = Depends(get_session),
) -> dict:
    cache_key = "fleet:reports:income-statement:v2"
    if not refresh:
        cached = cache_get(cache_key) or cache_get_stale(cache_key)
        if cached is not None:
            return cached

    row = (
        await db.execute(text("""
            WITH approved_receivables AS (
                SELECT
                    COALESCE(SUM(amount_due), 0) AS revenue_total,
                    COUNT(*) AS receivable_count,
                    COALESCE(SUM(
                        CASE
                            WHEN LOWER(COALESCE(state, '')) NOT IN ('confirmed', 'approved', 'paid', 'done', 'posted', 'reconciled')
                            THEN amount_due
                            ELSE 0
                        END
                    ), 0) AS unconfirmed_total
                FROM trip_receivable
            ),
            approved_payment_lines AS (
                SELECT
                    COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), pr.amount_birr, pr.amount, 0) AS amount
                FROM payment_request pr
                LEFT JOIN payment_request_line prl ON prl.payment_request_id = pr.id
                WHERE COALESCE(pr.is_trip_payment, false) = true
                  AND LOWER(COALESCE(pr.state, '')) IN ('confirmed', 'approved', 'paid', 'done', 'posted')
            ),
            trip_counts AS (
                SELECT COUNT(*) AS trip_count FROM trip_trip
            )
            SELECT
                (SELECT trip_count FROM trip_counts) AS trip_count,
                (SELECT revenue_total FROM approved_receivables) AS revenue_total,
                (SELECT receivable_count FROM approved_receivables) AS receivable_count,
                (SELECT unconfirmed_total FROM approved_receivables) AS unconfirmed_total,
                COALESCE((SELECT SUM(amount) FROM approved_payment_lines), 0) AS expense_total,
                COALESCE((SELECT COUNT(*) FROM approved_payment_lines), 0) AS payment_request_count
        """))
    ).fetchone()
    revenue_total = _as_float(row.revenue_total)
    expense_total = _as_float(row.expense_total)
    response = {
        "trip_count": row.trip_count or 0,
        "expense_total": expense_total,
        "revenue_total": revenue_total,
        "profit": revenue_total - expense_total,
        "receivable_count": row.receivable_count or 0,
        "unconfirmed_total": _as_float(row.unconfirmed_total),
        "payment_request_count": row.payment_request_count or 0,
    }
    cache_set(cache_key, response)
    return response


@router.get("/payment-tracking")
async def payment_tracking_report(
    receivable_state: str = Query("all", pattern="^(all|unconfirmed|confirmed)$"),
    has_trip: str = Query("all", pattern="^(all|yes|no)$"),
    payment_status: str = Query("all", pattern="^(all|paid|unpaid)$"),
    db: AsyncSession = Depends(get_session),
) -> dict:
    cache_key = f"fleet:reports:payment-tracking:v4-all-revenue:{receivable_state}:{has_trip}:{payment_status}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    rows_result = await db.execute(text("""
        SELECT
            r.id,
            COALESCE(NULLIF(r.name, ''), 'REC-' || r.id::text) AS receivable_name,
            COALESCE(NULLIF(r.state, ''), 'draft') AS state,
            COALESCE(r.amount_due, 0) AS amount_due,
            r.payment_reference,
            r.customer_name,
            r.date_created,
            r.trip_id,
            t.name AS trip_name,
            v.license_plate AS vehicle_plate,
            departure.name AS departure_name,
            destination.name AS destination_name,
            CASE
                WHEN LOWER(COALESCE(r.state, '')) IN ('confirmed', 'approved', 'paid', 'done', 'posted', 'reconciled')
                THEN 'confirmed'
                ELSE 'unconfirmed'
            END AS receivable_status,
            CASE
                WHEN COALESCE(r.payment_reference, '') ~* 'FT[[:space:]]*[0-9]'
                THEN 'paid'
                ELSE 'unpaid'
            END AS payment_status,
            (r.trip_id IS NOT NULL) AS has_trip
        FROM trip_receivable r
        LEFT JOIN trip_trip t ON t.id = r.trip_id
        LEFT JOIN fleet_vehicle v ON v.id = t.vehicle_id
        LEFT JOIN trip_location departure ON t.departure_id = departure.id
        LEFT JOIN trip_location destination ON t.destination_id = destination.id
        WHERE (
            :receivable_state = 'all'
            OR (
                :receivable_state = 'confirmed'
                AND LOWER(COALESCE(r.state, '')) IN ('confirmed', 'approved', 'paid', 'done', 'posted', 'reconciled')
            )
            OR (
                :receivable_state = 'unconfirmed'
                AND LOWER(COALESCE(r.state, '')) NOT IN ('confirmed', 'approved', 'paid', 'done', 'posted', 'reconciled')
            )
        )
          AND (
            :has_trip = 'all'
            OR (:has_trip = 'yes' AND r.trip_id IS NOT NULL)
            OR (:has_trip = 'no' AND r.trip_id IS NULL)
          )
          AND (
            :payment_status = 'all'
            OR (
                :payment_status = 'paid'
                AND COALESCE(r.payment_reference, '') ~* 'FT[[:space:]]*[0-9]'
            )
            OR (
                :payment_status = 'unpaid'
                AND COALESCE(r.payment_reference, '') !~* 'FT[[:space:]]*[0-9]'
            )
          )
        ORDER BY r.date_created DESC NULLS LAST, r.id DESC
        LIMIT 500
    """), {
        "receivable_state": receivable_state,
        "has_trip": has_trip,
        "payment_status": payment_status,
    })
    rows = []
    for item in rows_result.fetchall():
        route_parts = [part for part in (item.departure_name, item.destination_name) if part]
        amount = _as_float(item.amount_due)
        paid = item.payment_status == "paid"
        rows.append({
            "id": item.id,
            "receivable_name": item.receivable_name,
            "state": item.state,
            "amount_due": amount,
            "paid_amount": amount if paid else 0,
            "unpaid_amount": 0 if paid else amount,
            "payment_reference": item.payment_reference or "",
            "customer_name": item.customer_name or "",
            "date": _date_text(item.date_created),
            "trip_id": item.trip_id,
            "trip_name": item.trip_name or "",
            "vehicle_plate": item.vehicle_plate or "",
            "route": " to ".join(route_parts),
            "receivable_status": item.receivable_status,
            "payment_status": item.payment_status,
            "has_trip": bool(item.has_trip),
        })
    response = {
        "rows": rows,
        "totals": {
            "count": len(rows),
            "amount_total": sum(row["amount_due"] for row in rows),
            "paid_total": sum(row["paid_amount"] for row in rows),
            "unpaid_total": sum(row["unpaid_amount"] for row in rows),
            "unconfirmed_total": sum(row["amount_due"] for row in rows if row["receivable_status"] == "unconfirmed"),
            "with_trip": sum(1 for row in rows if row["has_trip"]),
            "without_trip": sum(1 for row in rows if not row["has_trip"]),
        },
    }
    cache_set(cache_key, response, ttl_seconds=60)
    return response


@router.get("/whatsapp-summary")
async def whatsapp_summary_report(
    format: str = Query("default", description="Format type: default, table, csv"),
    db: AsyncSession = Depends(get_session)
) -> dict:
    payment_cache_key = f"fleet:reports:whatsapp-summary:payments:v3:{format}"
    cached_payments = cache_get(payment_cache_key)
    if cached_payments:
        payment_lines_text = cached_payments.get("payment_requests_text") or ""
    else:
        payment_lines_text = await _whatsapp_payment_text(db)
        cache_set(payment_cache_key, {"payment_requests_text": payment_lines_text}, ttl_seconds=60)

    response = {
        "payment_requests_text": payment_lines_text,
        "current_location_text": await _current_location_report_text(db),
    }
    return response


async def _whatsapp_payment_text(db: AsyncSession) -> str:
    expense_rows = await db.execute(text("""
        SELECT
            t.id,
            COALESCE(departure.name, 'Addis Ababa') AS origin,
            COALESCE(destination.name, 'Djibouti') AS destination,
            COALESCE(driver.name, 'Unassigned Driver') AS driver_name,
            SUM(COALESCE(e.total_expense, e.amount * COALESCE(e.quantity, 1), 0)) AS total_expense
        FROM trip_trip t
        LEFT JOIN hr_employee driver ON t.driver_id = driver.id
        LEFT JOIN trip_location departure ON t.departure_id = departure.id
        LEFT JOIN trip_location destination ON t.destination_id = destination.id
        JOIN trip_expense_line e ON e.trip_id = t.id
        WHERE t.departure_date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY t.id, origin, destination, driver_name
        HAVING SUM(COALESCE(e.total_expense, e.amount * COALESCE(e.quantity, 1), 0)) > 0
        ORDER BY origin, destination
    """))

    payments_by_route = {}
    for row in expense_rows.fetchall():
        route = f"From {row.origin} to {row.destination}"
        if route not in payments_by_route:
            payments_by_route[route] = []
        payments_by_route[route].append(row)

    payment_lines = ["1. Payment Requests Summary\n"]
    for route, trips in payments_by_route.items():
        payment_lines.append(f"--- {route} ---")
        for i, trip in enumerate(trips, start=1):
            payment_lines.append(f"{i}, {trip.driver_name}")
            payment_lines.append(f"  Total Expenses: {_as_float(trip.total_expense):,.2f} Birr\n")
    return "\n".join(payment_lines)


async def _current_location_report_text(db: AsyncSession) -> str:
    loc_counts: dict[str, int] = {}
    rows = await fetch_vehicle_location_rows(db, limit=5000)
    for row in rows:
        location_name = row.get("location_name") or "Unknown"
        loc_counts[location_name] = loc_counts.get(location_name, 0) + 1
    loc_lines = ["Current Location Report for all vehicles\n", "*Trailer Report*"]
    for location_name, vehicle_count in sorted(loc_counts.items(), key=lambda item: _location_sort_key(item[0], item[1])):
        loc_lines.append(f"{vehicle_count}    {location_name}")
    return "\n".join(loc_lines)


@router.get("/responsible-report")
async def responsible_report(
    columns: Optional[str] = Query(None, description="Comma-separated columns. Omit = all columns"),
    format: str = Query("json", description="json or csv"),
    db: AsyncSession = Depends(get_session),
):
    """
    Responsible Report - Approved Payment Requests with detailed line items.
    Default: All columns. Use ?columns=item,total to select specific ones.
    """
    ALL_COLUMNS = [
        "no", "trip_reference", "vehicle_plate", "driver_name",
        "item", "description", "quantity", "amount", "total",
        "state", "approved_on", "supervisor_name", "requester_name"
    ]

    selected = [c.strip() for c in columns.split(",")] if columns else ALL_COLUMNS.copy()
    selected = [c for c in selected if c in ALL_COLUMNS]

    rows = await db.execute(text("""
        SELECT
            pr.id,
            t.name AS trip_reference,
            v.license_plate AS vehicle_plate,
            driver.name AS supervisor_name,
            requester.name AS requester_name,
            pr.state,
            pr.approve_date,
            prl.item,
            prl.description,
            COALESCE(prl.quantity, 1) AS quantity,
            COALESCE(prl.amount, 0) AS amount,
            COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), 0) AS total
        FROM payment_request pr
        LEFT JOIN payment_request_line prl ON prl.payment_request_id = pr.id
        LEFT JOIN trip_trip t ON pr.trip_id = t.id
        LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
        LEFT JOIN hr_employee driver ON t.driver_id = driver.id
        LEFT JOIN res_users req_user ON pr.create_uid = req_user.id
        LEFT JOIN res_partner requester ON req_user.partner_id = requester.id
        WHERE pr.trip_id IS NOT NULL
          AND COALESCE(pr.is_trip_payment, false) = true
          AND LOWER(COALESCE(pr.state, '')) IN ('confirmed', 'approved', 'paid', 'done', 'posted')
        ORDER BY pr.date DESC NULLS LAST
        LIMIT 1000
    """))

    result = []
    for index, row in enumerate(rows.fetchall(), start=1):
        line = {
            "no": index,
            "trip_reference": row.trip_reference,
            "vehicle_plate": row.vehicle_plate,
            "driver_name": row.supervisor_name,
            "item": row.item,
            "description": row.description,
            "quantity": row.quantity,
            "amount": _as_float(row.amount),
            "total": _as_float(row.total),
            "state": row.state,
            "approved_on": str(row.approve_date) if row.approve_date else None,
            "supervisor_name": row.supervisor_name,
            "requester_name": row.requester_name,
        }
        filtered = {k: line[k] for k in selected if k in line}
        result.append(filtered)

    if format.lower() == "csv":
        output = StringIO()
        if result:
            writer = csv.DictWriter(output, fieldnames=selected)
            writer.writeheader()
            writer.writerows(result)
        return Response(content=output.getvalue(), media_type="text/csv")

    return result
