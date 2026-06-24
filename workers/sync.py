"""Sync worker — health checks Odoo connection and logs schema status."""
import asyncio
import os
import sys
from datetime import datetime, timezone

# Add backend path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

# Minimal imports that work whether backend deps are installed or not
try:
    from app.core.database import get_session, AsyncSessionLocal
    from app.services.odoo_service import check_odoo_connection
    from app.services.odoo_sync_service import inspect_trip_schema
    _imports_ok = True
except Exception:
    _imports_ok = False

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


async def sync_once():
    print(f"[{datetime.now(timezone.utc).isoformat()}] Running sync...")

    if not _imports_ok:
        print("  → Backend imports not available; skipping in-proc sync.")
        # Fallback: try API check over HTTP
        import httpx
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get("http://fleet-api:8004/api/integrations/odoo/status")
                print(f"  → API odoo/status: {resp.status_code}")
        except httpx.ConnectError:
            print("  → API not reachable")
        return

    try:
        session_gen = AsyncSessionLocal()
        async_gen = await anext(session_gen.__aiter__())
        s = async_gen
        if s is None:
            raise RuntimeError("Could not obtain session from AsyncSessionLocal")

        status = await check_odoo_connection(s)
        print(f"  → Odoo: {status.message}")

        result = await inspect_trip_schema(s)
        print(f"  → Schema: {result.ok} ({len(result.tables_seen)} tables seen)")
        if result.tables_missing:
            print(f"  → Missing tables: {result.tables_missing}")

    except Exception as exc:
        print(f"  → Sync error: {exc}")


async def run():
    await sync_once()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
