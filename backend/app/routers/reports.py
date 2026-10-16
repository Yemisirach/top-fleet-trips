from datetime import date, datetime, timedelta
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
import csv
from io import StringIO
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_manager, require_user
from app.core.server_cache import cache_get, cache_set
from app.core.database import get_session
from app.services.journey_assembly import fetch_vehicle_location_rows

router = APIRouter()


def _as_float(value) -> float:
    return float(value or 0)


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
    return {
        "vehicle_count": len(rows),
        "rent_total": sum(row["actual_daily_total_revenue"] for row in posted),
        "cost_total": sum(row["daily_total_cost"] for row in rows),
        "revenue_total": sum(row["actual_daily_total_revenue"] for row in posted),
        "net_profit_total": posted_profit,
        "daily_net_profit_total": posted_profit,
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
async def current_location_report(db: AsyncSession = Depends(get_session)) -> list[dict]:
    cache_key = "fleet:reports:current-location"
    cached = cache_get(cache_key)
    if cached:
        return cached

    rows = await fetch_vehicle_location_rows(db, limit=1000)
    response = [
        {
            "vehicle_id": row.get("vehicle_id"),
            "trip_id": row.get("trip_id"),
            "reference": row.get("reference"),
            "vehicle_plate": row.get("vehicle_plate"),
            "supervisor_name": row.get("supervisor_name"),
            "driver_name": row.get("driver_name"),
            "departure_name": row.get("departure_name"),
            "destination_name": row.get("destination_name"),
            "current_location_name": row.get("current_location_name") or row.get("location_name"),
            "current_location_note": row.get("current_location_note"),
            "departure_date": str(row.get("departure_date")) if row.get("departure_date") else None,
            "arrival_date": str(row.get("arrival_date")) if row.get("arrival_date") else None,
            "state": row.get("state") or "available",
            "current_location_days": row.get("current_location_days") or 0,
        }
        for row in rows
    ]
    cache_set(cache_key, response)
    return response


@router.get("/current-location-summary")
async def current_location_summary_report(db: AsyncSession = Depends(get_session)) -> dict:
    cache_key = "fleet:reports:current-location-summary"
    cached = cache_get(cache_key)
    if cached:
        return cached

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
            "state": row.get("state") or "available",
            "destination_name": row.get("destination_name"),
            "current_location_note": row.get("current_location_note"),
            "departure_date": str(row.get("departure_date")) if row.get("departure_date") else None,
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
    cache_set(cache_key, response)
    return response


@router.get("/payment-requests")
async def payment_request_report(db: AsyncSession = Depends(get_session)) -> list[dict]:
    cache_key = "fleet:reports:payment-requests"
    cached = cache_get(cache_key)
    if cached:
        return cached

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
        WHERE COALESCE(pr.is_trip_payment, false) = true
        ORDER BY COALESCE(pr.date, pr.create_date::date) DESC NULLS LAST, pr.create_date DESC NULLS LAST
        LIMIT 500
    """))
    live_requests = [
        _payment_summary_from_row(row)
        for row in rows.fetchall()
    ]
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


@router.get("/finance-summary")
async def finance_summary_report(
    period: str = Query("daily", pattern="^(daily|weekly|monthly)$"),
    group_by: str = Query("all", pattern="^(all|supervisor|vehicle)$"),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_session),
) -> dict:
    cache_key = f"fleet:reports:finance-summary:v4:{period}:{group_by}:{from_date or ''}:{to_date or ''}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    date_trunc_unit = {"daily": "day", "weekly": "week", "monthly": "month"}[period]
    group_sql = {
        "all": "CAST('All' AS text)",
        "supervisor": "COALESCE(supervisor_partner.name, 'Unassigned supervisor')",
        "vehicle": "COALESCE(v.license_plate, 'Unassigned vehicle')",
    }[group_by]
    params = {"from_date": from_date, "to_date": to_date}
    rows = await db.execute(text(f"""
        WITH revenue AS (
            SELECT
                trip_id,
                COALESCE(SUM(amount_due), 0) AS amount
            FROM trip_receivable
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


@router.get("/daily-profit")
async def daily_profit_report(
    report_date: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_session),
) -> dict:
    cache_key = f"fleet:reports:daily-profit:v4:{report_date or 'latest'}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    rows_result = await db.execute(text("""
        WITH revenue AS (
            SELECT
                trip_id,
                COALESCE(SUM(amount_due), 0) AS amount,
                MAX(customer_name) AS customer_name
            FROM trip_receivable
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
        trip_rows AS (
            SELECT
                t.id AS trip_id,
                COALESCE(t.departure_date, t.create_date)::date AS trip_day,
                driver.name AS driver_name,
                v.license_plate AS plate_number,
                departure.name AS departure_name,
                destination.name AS destination_name,
                COALESCE(r.amount, 0) AS revenue_total,
                COALESCE(NULLIF(e.amount, 0), er.amount, 0) AS cost_total,
                r.customer_name AS customer_name
            FROM trip_trip t
            LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
            LEFT JOIN hr_employee driver ON t.driver_id = driver.id
            LEFT JOIN trip_location departure ON t.departure_id = departure.id
            LEFT JOIN trip_location destination ON t.destination_id = destination.id
            LEFT JOIN revenue r ON r.trip_id = t.id
            LEFT JOIN expenses e ON e.trip_id = t.id
            LEFT JOIN expense_requests er ON er.trip_id = t.id
            WHERE COALESCE(t.departure_date, t.create_date) IS NOT NULL
              AND (COALESCE(r.amount, 0) <> 0 OR COALESCE(NULLIF(e.amount, 0), er.amount, 0) <> 0)
        ),
        target AS (
            SELECT COALESCE(
                :report_date,
                MAX(trip_day) FILTER (WHERE trip_day <= CURRENT_DATE),
                MAX(trip_day)
            ) AS report_day
            FROM trip_rows
        )
        SELECT
            ROW_NUMBER() OVER (ORDER BY plate_number NULLS LAST, driver_name NULLS LAST, trip_id) AS no,
            trip_rows.*
        FROM trip_rows, target
        WHERE trip_rows.trip_day = target.report_day
        ORDER BY no
        LIMIT 500
    """), {"report_date": report_date})
    rows = []
    for row in rows_result.fetchall():
        revenue = _as_float(row.revenue_total)
        cost = _as_float(row.cost_total)
        receivable_posted = revenue > 0
        profit = revenue - cost if receivable_posted else 0
        route_parts = [part for part in (row.departure_name, row.destination_name) if part]
        route = "-".join(route_parts) if route_parts else ""
        rows.append({
            "no": row.no,
            "driver_name": row.driver_name or "Unassigned",
            "plate_number": row.plate_number or "N/A",
            "rent_amount": revenue if receivable_posted else 0,
            "daily_total_cost": cost,
            "actual_daily_total_revenue": revenue if receivable_posted else 0,
            "actual_net_profit": profit,
            "daily_net_profit": profit,
            "receivable_posted": receivable_posted,
            "profit_note": "" if receivable_posted else "Receivable not posted",
            "remarks": route,
            "trip_id": row.trip_id,
            "report_date": str(row.trip_day) if row.trip_day else None,
        })
    effective_date = str(rows[0]["report_date"]) if rows else (str(report_date) if report_date else None)
    response = {
        "report_date": effective_date,
        "rows": rows,
        "totals": _daily_profit_totals(rows),
    }
    cache_set(cache_key, response)
    return response


@router.get("/income-statement")
async def income_statement_report(db: AsyncSession = Depends(get_session)) -> dict:
    cache_key = "fleet:reports:income-statement"
    cached = cache_get(cache_key)
    if cached:
        return cached

    row = (
        await db.execute(text("""
            WITH approved_receivables AS (
                SELECT COALESCE(SUM(amount_due), 0) AS revenue_total, COUNT(*) AS receivable_count
                FROM trip_receivable
                WHERE LOWER(COALESCE(state, '')) IN ('confirmed', 'approved')
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
        "payment_request_count": row.payment_request_count or 0,
    }
    cache_set(cache_key, response)
    return response


@router.get("/whatsapp-summary")
async def whatsapp_summary_report(
    format: str = Query("default", description="Format type: default, table, csv"),
    db: AsyncSession = Depends(get_session)
) -> dict:
    cache_key = f"fleet:reports:whatsapp-summary:{format}"
    cached = cache_get(cache_key)
    if cached:
        return cached

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

    loc_counts: dict[str, int] = {}
    for row in await fetch_vehicle_location_rows(db, limit=1000):
        location_name = row.get("location_name") or "Unknown"
        loc_counts[location_name] = loc_counts.get(location_name, 0) + 1
    loc_lines = ["2. Current Location Report for all vehicles\n", "*Trailer Report*"]
    for location_name, vehicle_count in sorted(loc_counts.items(), key=lambda item: _location_sort_key(item[0], item[1])):
        loc_lines.append(f"{vehicle_count}    {location_name}")

    response = {
        "payment_requests_text": "\n".join(payment_lines),
        "current_location_text": "\n".join(loc_lines)
    }
    cache_set(cache_key, response)
    return response


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
        WHERE COALESCE(pr.is_trip_payment, false) = true
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
