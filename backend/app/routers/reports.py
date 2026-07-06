from datetime import date, datetime, timedelta
import json
from pathlib import Path
import re
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_manager, require_user
from app.core.database import get_session
from app.mock_data import mock_db

router = APIRouter()
APP_PAYMENT_REQUESTS_PATH = Path(__file__).resolve().parents[2] / "data" / "app_payment_requests.json"


def _as_float(value) -> float:
    return float(value or 0)


def _load_app_payment_requests() -> list[dict]:
    if not APP_PAYMENT_REQUESTS_PATH.exists():
        return []
    try:
        data = json.loads(APP_PAYMENT_REQUESTS_PATH.read_text())
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _save_app_payment_requests(requests: list[dict]) -> None:
    APP_PAYMENT_REQUESTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    APP_PAYMENT_REQUESTS_PATH.write_text(json.dumps(requests, ensure_ascii=False, indent=2))


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
        "supervisor_name": payment.get("supervisor_name"),
        "total_amount": _as_float(payment.get("total_amount")),
        "source": payment.get("source", "app"),
        "request_text": payment.get("request_text", ""),
    }


def _fallback_dashboard_data() -> dict:
    try:
        from app.routers.dashboard import _load_live_snapshot

        snapshot = _load_live_snapshot()
        if snapshot:
            return snapshot
    except Exception:
        pass
    return mock_db.get_full_dashboard()


def _fallback_journeys() -> list[dict]:
    data = _fallback_dashboard_data()
    return list(data.get("recent_journeys") or data.get("journeys") or [])


def _fallback_payment_requests() -> list[dict]:
    payments = []
    for trip in _fallback_journeys():
        amount = _as_float(trip.get("payment_request_total") or trip.get("total_expense"))
        payments.append({
            "id": trip.get("id"),
            "name": f"PAY-{trip.get('id')}",
            "reference": trip.get("id"),
            "trip_id": trip.get("id"),
            "trip_reference": trip.get("name") or trip.get("id"),
            "vehicle_plate": trip.get("vehicle_plate"),
            "state": "pending" if _as_float(trip.get("pending_expense_payment")) else "paid",
            "date": trip.get("departure_date"),
            "approved_on": None,
            "requester_name": trip.get("customer_name") or "Finance",
            "supervisor_name": trip.get("driver_name") or "Unassigned",
            "total_amount": amount,
        })
    return [_payment_summary(payment) for payment in _load_app_payment_requests()] + payments


def _fallback_location_summary() -> dict:
    grouped: dict[str, dict] = {}
    for trip in _fallback_journeys():
        destinations = trip.get("destinations") if isinstance(trip.get("destinations"), list) else []
        location = trip.get("current_location") or trip.get("current_location_note") or (destinations[0] if destinations else None) or "Unknown"
        if location not in grouped:
            grouped[location] = {"location_name": location, "vehicle_count": 0, "vehicles": []}
        grouped[location]["vehicle_count"] += 1
        grouped[location]["vehicles"].append({
            "trip_id": trip.get("id"),
            "reference": trip.get("id"),
            "vehicle_plate": trip.get("vehicle_plate"),
            "driver_name": trip.get("driver_name"),
            "state": trip.get("status"),
            "destination_name": location,
            "current_location_note": trip.get("mayet_status") or trip.get("status"),
            "departure_date": trip.get("departure_date"),
            "days": 0,
        })
    locations = sorted(grouped.values(), key=lambda item: item["vehicle_count"], reverse=True)
    return {
        "locations": locations,
        "total_locations": len(locations),
        "total_vehicles": sum(item["vehicle_count"] for item in locations),
        "_warning": "Showing cached/demo location summary because live Odoo DB timed out.",
    }


def _fallback_current_location() -> list[dict]:
    rows = []
    for trip in _fallback_journeys():
        destinations = trip.get("destinations") if isinstance(trip.get("destinations"), list) else []
        location = trip.get("current_location") or trip.get("current_location_note") or (destinations[0] if destinations else None)
        rows.append({
            "trip_id": trip.get("id"),
            "reference": trip.get("id"),
            "vehicle_plate": trip.get("vehicle_plate"),
            "driver_name": trip.get("driver_name"),
            "departure_name": trip.get("origin") or trip.get("journey_start") or "TOP Factory",
            "destination_name": ", ".join(destinations) if destinations else trip.get("destination"),
            "current_location_name": location,
            "current_location_note": trip.get("mayet_status") or trip.get("status"),
            "departure_date": trip.get("departure_date"),
            "arrival_date": trip.get("arrival_date") or trip.get("return_date"),
            "state": trip.get("status"),
            "current_location_days": 0,
        })
    return rows


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


def _fallback_finance_summary(period: str = "daily") -> dict:
    grouped: dict[str, dict] = {}
    for trip in _fallback_journeys():
        key = _period_key(trip.get("departure_date"), period)
        if key not in grouped:
            grouped[key] = {"period_start": key, "trip_count": 0, "revenue_total": 0.0, "expense_total": 0.0, "profit": 0.0}
        grouped[key]["trip_count"] += 1
        grouped[key]["revenue_total"] += _as_float(trip.get("total_revenue"))
        grouped[key]["expense_total"] += _as_float(trip.get("total_expense") or trip.get("payment_request_total"))
        grouped[key]["profit"] = grouped[key]["revenue_total"] - grouped[key]["expense_total"]
    periods = sorted(grouped.values(), key=lambda item: item["period_start"], reverse=True)
    return {
        "period": period,
        "periods": periods,
        "totals": {
            "trip_count": sum(row["trip_count"] for row in periods),
            "revenue_total": sum(row["revenue_total"] for row in periods),
            "expense_total": sum(row["expense_total"] for row in periods),
            "profit": sum(row["profit"] for row in periods),
        },
        "_warning": "Showing cached/demo finance summary because live Odoo DB timed out.",
    }


def _daily_profit_totals(rows: list[dict]) -> dict:
    return {
        "vehicle_count": len(rows),
        "rent_total": sum(row["rent_amount"] for row in rows),
        "cost_total": sum(row["daily_total_cost"] for row in rows),
        "revenue_total": sum(row["actual_daily_total_revenue"] for row in rows),
        "net_profit_total": sum(row["actual_net_profit"] for row in rows),
        "daily_net_profit_total": sum(row["daily_net_profit"] for row in rows),
    }


def _fallback_daily_profit(report_date: Optional[str] = None) -> dict:
    journeys = _fallback_journeys()
    if report_date:
        journeys = [trip for trip in journeys if str(trip.get("departure_date") or "")[:10] == report_date]
    elif journeys:
        latest_date = max(str(trip.get("departure_date") or "")[:10] for trip in journeys)
        journeys = [trip for trip in journeys if str(trip.get("departure_date") or "")[:10] == latest_date]
        report_date = latest_date

    rows = []
    for index, trip in enumerate(journeys, start=1):
        destinations = trip.get("destinations") if isinstance(trip.get("destinations"), list) else []
        route = f"{trip.get('origin') or trip.get('journey_start') or 'TOP Factory'}-{', '.join(destinations) if destinations else trip.get('destination') or 'Destination'}"
        revenue = _as_float(trip.get("total_revenue"))
        cost = _as_float(trip.get("total_expense") or trip.get("payment_request_total"))
        profit = max(0, revenue - cost)
        rows.append({
            "no": index,
            "driver_name": trip.get("driver_name") or "Unassigned",
            "plate_number": trip.get("vehicle_plate") or "N/A",
            "rent_amount": revenue,
            "daily_total_cost": cost,
            "actual_daily_total_revenue": revenue,
            "actual_net_profit": profit,
            "daily_net_profit": profit,
            "remarks": f"Vehicle rental revenue from {route}",
            "trip_id": trip.get("id"),
            "report_date": str(trip.get("departure_date") or report_date or "")[:10],
        })
    return {
        "report_date": report_date,
        "rows": rows,
        "totals": _daily_profit_totals(rows),
        "_warning": "Showing cached/demo daily profit report because live Odoo DB timed out.",
    }


def _fallback_income_statement() -> dict:
    summary = _fallback_finance_summary("daily")["totals"]
    return {
        "trip_count": summary["trip_count"],
        "expense_total": summary["expense_total"],
        "revenue_total": summary["revenue_total"],
        "profit": summary["profit"],
        "receivable_count": summary["trip_count"],
        "payment_request_count": summary["trip_count"],
        "_warning": "Showing cached/demo income statement because live Odoo DB timed out.",
    }


def _fallback_whatsapp_summary(format_type: str = "default") -> dict:
    from app.mock_data import mock_db
    
    mock_data = mock_db.get_full_dashboard()
    mock_prs = mock_data.get("payment_requests", [])
    
    prs_by_supervisor = {}
    for pr in mock_prs:
        if pr.get("total_amount", 0) <= 0:
            continue
        sup = pr.get("supervisor_name") or "Unassigned Supervisor"
        if sup not in prs_by_supervisor:
            prs_by_supervisor[sup] = []
        prs_by_supervisor[sup].append(pr)

    payment_lines = ["1. Payment Requests Summary\n"]
    
    if format_type == "csv":
        payment_lines = ["Supervisor,Route,Vehicle,Driver,ExpenseItem,Amount"]
        for sup, prs in prs_by_supervisor.items():
            for pr in prs:
                route = pr.get("trip_reference") or "Unknown Route"
                plate = pr.get("vehicle_plate") or "Unknown Plate"
                driver = pr.get("requester_name") or "Unknown Driver"
                lines = pr.get("line_items", [])
                if lines:
                    for line in lines:
                        desc = line.get('item', 'Expense')
                        payment_lines.append(f'"{sup}","{route}","{plate}","{driver}","{desc}",{line.get("amount")}')
                else:
                    payment_lines.append(f'"{sup}","{route}","{plate}","{driver}","General Expense",{pr.get("total_amount")}')
    elif format_type == "table":
        payment_lines.append(f"{'Supervisor':<20} | {'Vehicle':<12} | {'Amount':>10}")
        payment_lines.append("-" * 48)
        for sup, prs in prs_by_supervisor.items():
            sup_total = sum(_as_float(pr.get("total_amount")) for pr in prs)
            payment_lines.append(f"{sup:<20} | {'':<12} | {sup_total:>10,.2f}")
            for pr in prs:
                plate = pr.get("vehicle_plate") or "Unknown"
                amount = _as_float(pr.get("total_amount"))
                payment_lines.append(f"{'':<20} | {plate:<12} | {amount:>10,.2f}")
            payment_lines.append("-" * 48)
    else:
        # Default layout
        for sup, prs in prs_by_supervisor.items():
            payment_lines.append(f"Supervisor: *{sup}*")
            sup_total = 0
            
            # Group by route
            prs_by_route = {}
            for pr in prs:
                route = pr.get("trip_reference") or "Unknown Route"
                if route not in prs_by_route:
                    prs_by_route[route] = []
                prs_by_route[route].append(pr)
                
            for route, route_prs in prs_by_route.items():
                payment_lines.append(f"\n_{route}_")
                for i, pr in enumerate(route_prs, start=1):
                    amount = _as_float(pr.get("total_amount"))
                    sup_total += amount
                    plate = pr.get("vehicle_plate") or "Unknown Plate"
                    driver = pr.get("requester_name") or "Unknown Driver"
                    
                    payment_lines.append(f"  {i}, {plate} ({driver})")
                    
                    lines = pr.get("line_items", [])
                    if lines:
                        for line in lines:
                            desc = line.get('description', line.get('item', 'Expense'))
                            payment_lines.append(f"    {desc} = {_as_float(line.get('amount')):,.2f}")
                    else:
                        payment_lines.append(f"    General Expense = {amount:,.2f}")
                        
                    payment_lines.append(f"  Total: {amount:,.2f}\n")
                
            payment_lines.append(f"*Supervisor Total Request: {sup_total:,.2f} Birr*\n")
            payment_lines.append("=" * 30 + "\n")

    # 2. Location Text
    loc_summary = _fallback_location_summary()
    loc_lines = ["2. Current Location Report for all vehicles\n", "*Trailer Report*"]
    
    if format_type == "csv":
        loc_lines = ["Location,VehicleCount"]
        for loc in loc_summary.get("locations", []):
            loc_lines.append(f'"{loc.get("location_name")}",{loc.get("vehicle_count")}')
    elif format_type == "table":
        loc_lines.append(f"{'Location':<30} | {'Vehicles':>8}")
        loc_lines.append("-" * 41)
        for loc in loc_summary.get("locations", []):
            loc_lines.append(f"{str(loc.get('location_name'))[:30]:<30} | {loc.get('vehicle_count', 0):>8}")
    else:
        for loc in loc_summary.get("locations", []):
            loc_lines.append(f"{loc.get('vehicle_count')}    {loc.get('location_name')}")

    return {
        "payment_requests_text": "\n".join(payment_lines),
        "current_location_text": "\n".join(loc_lines),
        "_warning": "Showing cached/demo WhatsApp summary because live Odoo DB timed out.",
    }


def fallback_response_for_path(path: str, query_params=None):
    period = "daily"
    report_date = None
    if query_params is not None:
        period = query_params.get("period", "daily")
        report_date = query_params.get("report_date")
    if path.endswith("/current-location"):
        return _fallback_current_location()
    if path.endswith("/payment-requests"):
        return _fallback_payment_requests()
    if path.endswith("/current-location-summary"):
        return _fallback_location_summary()
    if path.endswith("/finance-summary"):
        return _fallback_finance_summary(period if period in {"daily", "weekly", "monthly"} else "daily")
    if path.endswith("/daily-profit"):
        return _fallback_daily_profit(report_date)
    if path.endswith("/income-statement"):
        return _fallback_income_statement()
    if path.endswith("/whatsapp-summary"):
        return _fallback_whatsapp_summary()
    if "/payment-request-detail/" in path:
        request_id = path.rstrip("/").split("/")[-1]
        for payment in _fallback_payment_requests():
            if str(payment.get("id")) == request_id:
                return {**payment, "line_items": [{"item": "Trip expense", "description": payment.get("trip_reference"), "amount": payment.get("total_amount")}]}
        return {"id": request_id, "line_items": [], "message": "Live detail unavailable and no cached payment matched this id."}
    return None


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
    rows = await db.execute(text("""
        SELECT
            t.id AS trip_id,
            t.name AS reference,
            v.license_plate AS vehicle_plate,
            driver.name AS driver_name,
            departure.name AS departure_name,
            destination.name AS destination_name,
            current_location.name AS current_location_name,
            t.current_location_note,
            t.departure_date,
            t.arrival_date,
            t.state,
            CASE
                WHEN COALESCE(t.arrival_date, t.departure_date) IS NULL THEN 0
                ELSE GREATEST(CURRENT_DATE - COALESCE(t.arrival_date, t.departure_date), 0)
            END AS current_location_days
        FROM trip_trip t
        LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
        LEFT JOIN hr_employee driver ON t.driver_id = driver.id
        LEFT JOIN trip_location departure ON t.departure_id = departure.id
        LEFT JOIN trip_location destination ON t.destination_id = destination.id
        LEFT JOIN trip_location current_location ON t.current_location_id = current_location.id
        ORDER BY t.write_date DESC NULLS LAST, t.create_date DESC NULLS LAST
        LIMIT 500
    """))
    return [
        {
            "trip_id": row.trip_id,
            "reference": row.reference,
            "vehicle_plate": row.vehicle_plate,
            "driver_name": row.driver_name,
            "departure_name": row.departure_name,
            "destination_name": row.destination_name,
            "current_location_name": row.current_location_name,
            "current_location_note": row.current_location_note,
            "departure_date": str(row.departure_date) if row.departure_date else None,
            "arrival_date": str(row.arrival_date) if row.arrival_date else None,
            "state": row.state,
            "current_location_days": row.current_location_days or 0,
        }
        for row in rows.fetchall()
    ]


@router.get("/current-location-summary")
async def current_location_summary_report(db: AsyncSession = Depends(get_session)) -> dict:
    try:
        rows = await db.execute(text("""
            SELECT
                COALESCE(current_location.name, t.current_location_note, destination.name, 'Unknown') AS location_name,
                COUNT(*) AS vehicle_count,
                json_agg(json_build_object(
                    'trip_id', t.id,
                    'reference', t.name,
                    'vehicle_plate', v.license_plate,
                    'driver_name', driver.name,
                    'state', t.state,
                    'destination_name', destination.name,
                    'current_location_note', t.current_location_note,
                    'departure_date', t.departure_date,
                    'days', CASE
                        WHEN COALESCE(t.arrival_date, t.departure_date) IS NULL THEN 0
                        ELSE GREATEST(CURRENT_DATE - COALESCE(t.arrival_date, t.departure_date), 0)
                    END
                ) ORDER BY t.write_date DESC NULLS LAST, t.create_date DESC NULLS LAST) AS vehicles
            FROM trip_trip t
            LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
            LEFT JOIN hr_employee driver ON t.driver_id = driver.id
            LEFT JOIN trip_location destination ON t.destination_id = destination.id
            LEFT JOIN trip_location current_location ON t.current_location_id = current_location.id
            WHERE COALESCE(t.state, '') NOT IN ('done', 'cancel', 'cancelled')
            GROUP BY COALESCE(current_location.name, t.current_location_note, destination.name, 'Unknown')
            ORDER BY vehicle_count DESC, location_name
            LIMIT 100
        """))
        locations = [
            {
                "location_name": row.location_name,
                "vehicle_count": row.vehicle_count or 0,
                "vehicles": row.vehicles or [],
            }
            for row in rows.fetchall()
        ]
        return {
            "locations": locations,
            "total_locations": len(locations),
            "total_vehicles": sum(item["vehicle_count"] for item in locations),
        }
    except Exception:
        return {"locations": [], "total_locations": 0, "total_vehicles": 0, "_warning": "Live DB unavailable"}


@router.get("/payment-requests")
async def payment_request_report(db: AsyncSession = Depends(get_session)) -> list[dict]:
    try:
        rows = await db.execute(text("""
            SELECT
                pr.id,
                pr.name,
                pr.ref,
                pr.trip_id,
                t.name AS trip_reference,
                v.license_plate AS vehicle_plate,
                pr.state,
                pr.date,
                pr.approve_date,
                requester.name AS requester_name,
                driver.name AS supervisor_name,
                COALESCE(SUM(COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), pr.amount_birr, pr.amount, 0)), 0) AS total_amount
            FROM payment_request pr
            LEFT JOIN payment_request_line prl ON prl.payment_request_id = pr.id
            LEFT JOIN trip_trip t ON pr.trip_id = t.id
            LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
            LEFT JOIN hr_employee driver ON t.driver_id = driver.id
            LEFT JOIN res_users req_user ON pr.create_uid = req_user.id
            LEFT JOIN res_partner requester ON req_user.partner_id = requester.id
            WHERE COALESCE(pr.is_trip_payment, false) = true
            GROUP BY pr.id, pr.name, pr.ref, pr.trip_id, t.name, v.license_plate, pr.state, pr.date, pr.approve_date, requester.name, driver.name
            ORDER BY pr.date DESC NULLS LAST, pr.create_date DESC NULLS LAST
            LIMIT 500
        """))
        live_requests = [
            {
                "id": row.id,
                "name": row.name,
                "reference": row.ref,
                "trip_id": row.trip_id,
                "trip_reference": row.trip_reference,
                "vehicle_plate": row.vehicle_plate,
                "state": row.state,
                "date": str(row.date) if row.date else None,
                "approved_on": str(row.approve_date) if row.approve_date else None,
                "requester_name": row.requester_name,
                "supervisor_name": row.supervisor_name,
                "total_amount": _as_float(row.total_amount),
            }
            for row in rows.fetchall()
        ]
        app_requests = [_payment_summary(payment) for payment in _load_app_payment_requests()]
        return app_requests + live_requests
    except Exception:
        # Return fallback instead of 500
        return _fallback_payment_requests()


@router.post("/payment-request")
async def create_payment_request(
    payload: dict,
    user: dict = Depends(require_user),
) -> dict:
    """Collect an app-level payment request from a supervisor or manager."""
    request_text = str(payload.get("request_text") or "").strip()
    if not request_text:
        raise HTTPException(status_code=400, detail="Payment request text is required")
    total_amount = _as_float(payload.get("total_amount")) or _extract_amount(request_text)
    created_at = datetime.utcnow().isoformat()
    payment = {
        "id": f"APP-{uuid4().hex[:10].upper()}",
        "name": payload.get("name") or f"APP-PAY-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}",
        "reference": payload.get("reference") or "",
        "trip_id": payload.get("trip_id"),
        "trip_reference": payload.get("trip_reference") or payload.get("section") or "Supervisor request",
        "vehicle_plate": payload.get("vehicle_plate") or "",
        "state": payload.get("state") or "confirmed",
        "date": payload.get("date") or date.today().isoformat(),
        "approved_on": None,
        "requester_name": user.get("name") or user.get("username"),
        "supervisor_name": payload.get("supervisor_name") or user.get("name") or user.get("username"),
        "driver_name": payload.get("driver_name") or payload.get("supervisor_name") or "",
        "total_amount": total_amount,
        "request_text": request_text,
        "notes": payload.get("notes") or "",
        "source": "app",
        "created_by": user.get("username"),
        "created_at": created_at,
        "updated_at": created_at,
    }
    requests = _load_app_payment_requests()
    requests.insert(0, payment)
    _save_app_payment_requests(requests)
    return {"detail": "Created", "payment": _payment_summary(payment)}


@router.get("/payment-request-detail/{pr_id}")
async def payment_request_detail(pr_id: str, db: AsyncSession = Depends(get_session)) -> dict:
    """Return a single payment request with full details for editing/approval."""
    for payment in _load_app_payment_requests():
        if str(payment.get("id")) == str(pr_id):
            return {
                **_payment_summary(payment),
                "driver_name": payment.get("driver_name"),
                "notes": payment.get("notes", ""),
                "line_items": _payment_text_lines(payment.get("request_text", "")),
            }
    try:
        live_pr_id = int(pr_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Payment request not found")
    row = (
        await db.execute(text("""
            SELECT
                pr.id, pr.name, pr.ref AS reference, pr.trip_id,
                t.name AS trip_reference, v.license_plate AS vehicle_plate,
                pr.state, pr.date, pr.approve_date,
                requester.name AS requester_name,
                driver.name AS supervisor_name,
                COALESCE(SUM(COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), pr.amount_birr, pr.amount, 0)), 0) AS total_amount
            FROM payment_request pr
            LEFT JOIN payment_request_line prl ON prl.payment_request_id = pr.id
            LEFT JOIN trip_trip t ON pr.trip_id = t.id
            LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
            LEFT JOIN hr_employee driver ON t.driver_id = driver.id
            LEFT JOIN res_users req_user ON pr.create_uid = req_user.id
            LEFT JOIN res_partner requester ON req_user.partner_id = requester.id
            WHERE pr.id = :pr_id
            GROUP BY pr.id, pr.name, pr.ref, pr.trip_id, t.name, v.license_plate, pr.state, pr.date, pr.approve_date, requester.name, driver.name
        """), {"pr_id": live_pr_id})
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Payment request not found")

    # Fetch line items
    lines_result = await db.execute(text("""
        SELECT
            prl.item, prl.description,
            COALESCE(prl.total, prl.amount * COALESCE(prl.quantity, 1), 0) AS line_amount
        FROM payment_request_line prl
        WHERE prl.payment_request_id = :pr_id
    """), {"pr_id": live_pr_id})

    return {
        "id": row.id,
        "name": row.name,
        "reference": row.reference,
        "trip_id": row.trip_id,
        "trip_reference": row.trip_reference,
        "vehicle_plate": row.vehicle_plate,
        "state": row.state,
        "date": str(row.date) if row.date else None,
        "approved_on": str(row.approve_date) if row.approve_date else None,
        "requester_name": row.requester_name or "Unknown",
        "supervisor_name": row.supervisor_name or "Unknown",
        "total_amount": _as_float(row.total_amount),
        "line_items": [
            {"item": line.item, "description": line.description, "amount": _as_float(line.line_amount)}
            for line in lines_result.fetchall()
        ],
    }


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

    requests = _load_app_payment_requests()
    for index, payment in enumerate(requests):
        if str(payment.get("id")) == str(pr_id):
            if new_state:
                payment["state"] = new_state
                if new_state in {"approved", "paid", "done", "posted"}:
                    payment["approved_on"] = date.today().isoformat()
            if notes:
                payment["notes"] = notes
            if "request_text" in payload:
                payment["request_text"] = str(payload.get("request_text") or "")
            if "total_amount" in payload:
                payment["total_amount"] = _as_float(payload.get("total_amount")) or _extract_amount(payment.get("request_text", ""))
            payment["updated_by"] = user["username"]
            payment["updated_at"] = datetime.utcnow().isoformat()
            requests[index] = payment
            _save_app_payment_requests(requests)
            return {"detail": "Updated", "id": pr_id, "state": payment.get("state"), "updated_by": user["username"]}

    try:
        live_pr_id = int(pr_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Payment request not found")

    updates = []
    params: dict = {"pr_id": live_pr_id}
    if new_state:
        updates.append("state = :new_state")
        params["new_state"] = new_state
    payment_columns = await _table_columns(db, "payment_request")
    note_column = "note" if "note" in payment_columns else "notes" if "notes" in payment_columns else None
    if notes and note_column:
        if note_column not in {"note", "notes"}:
            raise HTTPException(status_code=400, detail="Unsupported note column")
        updates.append(f"{note_column} = :notes")
        params["notes"] = notes
    if not updates:
        return {"detail": "No changes provided."}

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
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_session),
) -> dict:
    date_trunc_unit = {"daily": "day", "weekly": "week", "monthly": "month"}[period]
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
            COUNT(DISTINCT t.id) AS trip_count,
            COALESCE(SUM(r.amount), 0) AS revenue_total,
            COALESCE(SUM(COALESCE(e.amount, 0) + COALESCE(er.amount, 0)), 0) AS expense_total
        FROM trip_trip t
        LEFT JOIN revenue r ON r.trip_id = t.id
        LEFT JOIN expenses e ON e.trip_id = t.id
        LEFT JOIN expense_requests er ON er.trip_id = t.id
        WHERE (:from_date IS NULL OR COALESCE(t.departure_date, t.create_date)::date >= :from_date)
          AND (:to_date IS NULL OR COALESCE(t.departure_date, t.create_date)::date <= :to_date)
        GROUP BY date_trunc('{date_trunc_unit}', COALESCE(t.departure_date, t.create_date))::date
        ORDER BY period_start DESC
        LIMIT 120
    """), params)
    periods = []
    for row in rows.fetchall():
        revenue = _as_float(row.revenue_total)
        expense = _as_float(row.expense_total)
        periods.append({
            "period_start": str(row.period_start),
            "trip_count": row.trip_count or 0,
            "revenue_total": revenue,
            "expense_total": expense,
            "profit": revenue - expense,
        })
    return {
        "period": period,
        "periods": periods,
        "totals": {
            "trip_count": sum(row["trip_count"] for row in periods),
            "revenue_total": sum(row["revenue_total"] for row in periods),
            "expense_total": sum(row["expense_total"] for row in periods),
            "profit": sum(row["profit"] for row in periods),
        },
    }


@router.get("/daily-profit")
async def daily_profit_report(
    report_date: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_session),
) -> dict:
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
                (COALESCE(e.amount, 0) + COALESCE(er.amount, 0)) AS cost_total,
                COALESCE(r.customer_name, 'Customer') AS customer_name
            FROM trip_trip t
            LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
            LEFT JOIN hr_employee driver ON t.driver_id = driver.id
            LEFT JOIN trip_location departure ON t.departure_id = departure.id
            LEFT JOIN trip_location destination ON t.destination_id = destination.id
            LEFT JOIN revenue r ON r.trip_id = t.id
            LEFT JOIN expenses e ON e.trip_id = t.id
            LEFT JOIN expense_requests er ON er.trip_id = t.id
            WHERE COALESCE(t.departure_date, t.create_date) IS NOT NULL
        ),
        target AS (
            SELECT COALESCE(:report_date, MAX(trip_day)) AS report_day
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
        profit = max(0, revenue - cost)
        route = f"{row.departure_name or 'TOP Factory'}-{row.destination_name or 'Destination'}"
        rows.append({
            "no": row.no,
            "driver_name": row.driver_name or "Unassigned",
            "plate_number": row.plate_number or "N/A",
            "rent_amount": revenue,
            "daily_total_cost": cost,
            "actual_daily_total_revenue": revenue,
            "actual_net_profit": profit,
            "daily_net_profit": profit,
            "remarks": f"Vehicle rental revenue from {route}",
            "trip_id": row.trip_id,
            "report_date": str(row.trip_day) if row.trip_day else None,
        })
    effective_date = str(rows[0]["report_date"]) if rows else (str(report_date) if report_date else None)
    return {
        "report_date": effective_date,
        "rows": rows,
        "totals": _daily_profit_totals(rows),
    }


@router.get("/income-statement")
async def income_statement_report(db: AsyncSession = Depends(get_session)) -> dict:
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
    return {
        "trip_count": row.trip_count or 0,
        "expense_total": expense_total,
        "revenue_total": revenue_total,
        "profit": revenue_total - expense_total,
        "receivable_count": row.receivable_count or 0,
        "payment_request_count": row.payment_request_count or 0,
    }


@router.get("/whatsapp-summary")
async def whatsapp_summary_report(
    format: str = Query("default", description="Format type: default, table, csv"),
    db: AsyncSession = Depends(get_session)
) -> dict:
    try:
        # Generate Payment Requests text
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

        # Generate Location Summary text
        loc_rows = await db.execute(text("""
            SELECT
                COALESCE(current_location.name, t.current_location_note, destination.name, 'Unknown') AS location_name,
                COUNT(*) AS vehicle_count
            FROM trip_trip t
            LEFT JOIN trip_location destination ON t.destination_id = destination.id
            LEFT JOIN trip_location current_location ON t.current_location_id = current_location.id
            WHERE COALESCE(t.state, '') NOT IN ('done', 'cancel', 'cancelled')
            GROUP BY COALESCE(current_location.name, t.current_location_note, destination.name, 'Unknown')
            ORDER BY vehicle_count DESC, location_name
        """))
        
        loc_lines = ["2. Current Location Report for all vehicles\n", "*Trailer Report*"]
        for row in loc_rows.fetchall():
            loc_lines.append(f"{row.vehicle_count}    {row.location_name}")

        return {
            "payment_requests_text": "\n".join(payment_lines),
            "current_location_text": "\n".join(loc_lines)
        }
    except Exception:
        return _fallback_whatsapp_summary(format_type=format)
