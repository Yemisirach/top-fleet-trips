from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query

from app.core.auth import require_user
from app.core.scope import scope_dashboard
from app.core.server_cache import cache_get, cache_get_stale, cache_stored_at, cache_sync_status
from app.services.fleet_store import sync_fleet_store

router = APIRouter()
ADDIS = ZoneInfo("Africa/Addis_Ababa")


def _saved(key: str):
    fresh = cache_get(key)
    return fresh if fresh is not None else cache_get_stale(key)


@router.get("/sync-status")
async def fleet_sync_status(user: dict = Depends(require_user)) -> dict:
    status = cache_sync_status()
    return {
        "synced_at": status.get("synced_at"),
        "source": status.get("source"),
        "live": bool(status.get("synced_at")),
    }


@router.get("/shared-copy")
async def fleet_shared_copy(
    include: str = Query(""),
    user: dict = Depends(require_user),
) -> dict:
    """One server copy for every manager browser. Redis only. Does not touch live Odoo or the header time."""
    today = datetime.now(ADDIS).date().isoformat()
    profit_key = "fleet:reports:daily-profit:v16:today"
    dash_key = "fleet:dashboard:full:v7"
    profit = _saved(profit_key)
    report_date = today
    totals = None
    if isinstance(profit, dict) and user.get("role") != "supervisor":
        report_date = str(profit.get("report_date") or today)
        totals = profit.get("totals")
    payload = {
        "revision": "|".join([
            cache_stored_at(dash_key) or "",
            cache_stored_at(profit_key) or "",
        ]),
        "report_date": report_date,
        "totals": totals,
    }
    if include == "dashboard":
        dashboard = _saved(dash_key)
        if isinstance(dashboard, dict):
            payload["dashboard"] = scope_dashboard(dashboard, user)
    return payload


@router.post("/sync")
async def fleet_sync_now(user: dict = Depends(require_user)) -> dict:
    status = await sync_fleet_store("manual")
    return {
        "synced_at": status.get("synced_at"),
        "source": status.get("source") or "manual",
        "live": bool(status.get("stored_count")),
        "stored_count": status.get("stored_count") or 0,
        "failed_count": status.get("failed_count") or 0,
    }
