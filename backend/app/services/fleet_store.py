"""Store fleet reads on the VPS and refresh them from live Odoo every minute."""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from app.core.database import AsyncSessionLocal
from app.core.server_cache import cache_mark_synced, cache_stored_at, cache_sync_status
from app.core.settings import get_settings
from app.routers.dashboard import get_full_dashboard
from app.routers.journeys import get_journeys
from app.routers.reports import (
    _load_payment_requests,
    current_location_report,
    current_location_summary_report,
    daily_profit_report,
    finance_cards_report,
    finance_summary_report,
    income_statement_report,
)
from app.routers.trips import list_trips
from app.routers.vehicles import list_vehicles

logger = logging.getLogger("fleet.store")
settings = get_settings()
_lock = asyncio.Lock()
STORE_USER = {"role": "manager", "username": "fleet-store", "name": "Fleet store"}


async def _refresh(name: str, cache_key: str, call: Callable[[object], Awaitable[object]]) -> bool:
    before = cache_stored_at(cache_key)
    try:
        async with AsyncSessionLocal() as db:
            await asyncio.wait_for(call(db), timeout=settings.db_query_timeout_seconds + 1)
    except Exception as exc:
        logger.warning("fleet store %s failed: %s", name, type(exc).__name__)
        return False
    after = cache_stored_at(cache_key)
    return bool(after and after != before)


async def sync_fleet_store(source: str) -> dict:
    """Refresh saved copies with bounded concurrency, leaving pool capacity for reads."""
    if _lock.locked() and source == "background":
        status = cache_sync_status()
        status["live"] = False
        status["skipped"] = True
        return status
    async with _lock:
        jobs = [
            ("payments", "fleet:reports:payment-requests:v2-trip", lambda db: _load_payment_requests(db, "fleet:reports:payment-requests:v2-trip")),
            ("locations", "fleet:reports:current-location:v3", lambda db: current_location_report(refresh=True, db=db, user=STORE_USER)),
            ("location-summary", "fleet:reports:current-location-summary:v4", lambda db: current_location_summary_report(refresh=True, db=db, user=STORE_USER)),
            ("dashboard", "fleet:dashboard:full:v7", lambda db: get_full_dashboard(mode="live", refresh=True, db=db, user=STORE_USER)),
            ("finance-cards", "fleet:reports:finance-cards:v4:today", lambda db: finance_cards_report(as_of=None, refresh=True, db=db)),
            ("finance-daily", "fleet:reports:finance-summary:v6:daily:all::", lambda db: finance_summary_report(period="daily", group_by="all", from_date=None, to_date=None, refresh=True, db=db)),
            ("finance-weekly", "fleet:reports:finance-summary:v6:weekly:all::", lambda db: finance_summary_report(period="weekly", group_by="all", from_date=None, to_date=None, refresh=True, db=db)),
            ("finance-monthly", "fleet:reports:finance-summary:v6:monthly:all::", lambda db: finance_summary_report(period="monthly", group_by="all", from_date=None, to_date=None, refresh=True, db=db)),
            ("finance-yearly", "fleet:reports:finance-summary:v6:yearly:all::", lambda db: finance_summary_report(period="yearly", group_by="all", from_date=None, to_date=None, refresh=True, db=db)),
            ("daily-profit", "fleet:reports:daily-profit:v16:today", lambda db: daily_profit_report(report_date=None, refresh=True, db=db)),
            ("income", "fleet:reports:income-statement:v2", lambda db: income_statement_report(refresh=True, db=db)),
            ("trips", "fleet:trips:list:v1:0:500", lambda db: list_trips(skip=0, limit=500, refresh=True, db=db)),
            ("vehicles", "fleet:vehicles:list:v1:0:500", lambda db: list_vehicles(skip=0, limit=500, refresh=True, db=db)),
            ("journeys", "fleet:journeys:list:v3::::::True", lambda db: get_journeys(plate=None, driver=None, from_date=None, to_date=None, status=None, include_trips=True, refresh=True, db=db)),
        ]
        stored: list[str] = []
        failed: list[str] = []
        semaphore = asyncio.Semaphore(3)

        async def run_job(name, cache_key, call):
            async with semaphore:
                if await _refresh(name, cache_key, call):
                    stored.append(name)
                else:
                    failed.append(name)

        await asyncio.gather(*(run_job(*job) for job in jobs))
        if stored:
            status = cache_mark_synced(source, stored, failed)
        else:
            status = cache_sync_status()
            status["live"] = False
            status["failed"] = failed
        status["stored_count"] = len(stored)
        status["failed_count"] = len(failed)
        logger.info("fleet store %s stored=%s failed=%s", source, len(stored), len(failed))
        return status


async def store_loop() -> None:
    await asyncio.sleep(20)
    while True:
        started = asyncio.get_running_loop().time()
        try:
            await sync_fleet_store("background")
        except Exception:
            logger.exception("fleet store background failed")
        elapsed = asyncio.get_running_loop().time() - started
        await asyncio.sleep(max(5, 60 - elapsed))
