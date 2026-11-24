"""Daily costs and revenue, scoped before anything is returned or cached."""
from datetime import date, datetime, timezone
import hashlib
import json
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text, bindparam
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.core.database import get_session
from app.core.scope import names_match
from app.core.server_cache import cache_get, cache_get_stale, cache_set
from app.services.journey_assembly import fetch_trip_rows

router = APIRouter()


def assemble_report(rows, expenses, report_date, user):
    vehicles = {}
    for row in rows:
        if user.get("role") == "supervisor" and not names_match(row.get("supervisor_name"), user.get("name") or user.get("username")):
            continue
        vehicle = vehicles.setdefault(row["vehicle_id"], {
            "vehicle_id": row["vehicle_id"], "plate": row.get("license_plate"),
            "cost": 0, "revenue": 0, "trips": [],
        })
        lines = expenses.get(row["id"])
        source = "trip_expense_line"
        if lines is None:
            source = "payment_request"
            lines = row.get("payment_request_lines") or []
            if isinstance(lines, str):
                lines = json.loads(lines)
        cost = sum(float(line.get("total") or 0) for line in lines)
        revenue = float(row.get("total_revenue") or 0)
        vehicle["cost"] += cost
        vehicle["revenue"] += revenue
        vehicle["trips"].append({
            "id": row["id"], "reference": row.get("name"), "cost_source": source,
            "cost_items": lines, "cost": cost, "revenue": revenue,
            "unconfirmed_revenue": float(row.get("unconfirmed_revenue") or 0),
        })
    return {
        "report_date": report_date.isoformat(), "source": "odoo", "saved": False,
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "date_basis": "Trip departure date, falling back to creation date",
        "vehicles": list(vehicles.values()),
        "cost": sum(v["cost"] for v in vehicles.values()),
        "revenue": sum(v["revenue"] for v in vehicles.values()),
    }


@router.get("/daily-report")
async def daily_report(
    report_date: date | None = Query(None), refresh: bool = Query(False),
    db: AsyncSession = Depends(get_session), user: dict = Depends(require_user),
):
    day = report_date or datetime.now(ZoneInfo("Africa/Addis_Ababa")).date()
    identity = hashlib.sha256(json.dumps([user.get("username"), user.get("role"), user.get("name")]).encode()).hexdigest()
    key = f"fleet:supervisor:daily:v1:{identity}:{day}"
    if not refresh:
        cached = cache_get(key)
        if cached is not None:
            return {**cached, "saved": True}
    try:
        rows = await fetch_trip_rows(db, from_date=day, to_date=day)
        if user.get("role") == "supervisor":
            rows = [r for r in rows if names_match(r.get("supervisor_name"), user.get("name") or user.get("username"))]
        expenses = {}
        if rows:
            result = await db.execute(text("""
                SELECT el.trip_id, et.name AS item, el.description, el.quantity, el.amount,
                       COALESCE(el.total_expense, el.amount * COALESCE(el.quantity, 1), 0) AS total
                FROM trip_expense_line el
                LEFT JOIN trip_expense_type et ON et.id = el.expense_type_id
                WHERE el.trip_id IN :ids ORDER BY el.id
            """).bindparams(bindparam("ids", expanding=True)), {"ids": [r["id"] for r in rows]})
            for record in result.mappings():
                line = dict(record)
                expenses.setdefault(line.pop("trip_id"), []).append(line)
        payload = assemble_report(rows, expenses, day, user)
        cache_set(key, payload)
        return payload
    except Exception:
        cached = cache_get_stale(key)
        if cached is not None:
            return {**cached, "saved": True, "warning": "Odoo is unavailable. Showing the last successful sync for this date."}
        raise HTTPException(status_code=503, detail="No synced report is available for this date. Odoo did not answer.")
