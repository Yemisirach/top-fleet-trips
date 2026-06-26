"""Dashboard snapshot builder — fetches live dashboard data and caches to Redis."""
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

try:
    import redis as _redis
except ImportError:
    _redis = None

# Add backend path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))


REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
API_BASE = os.getenv("API_BASE", "http://fleet-api:8004")


def _get_redis():
    if _redis is None:
        return None
    import urllib.parse
    parsed = urllib.parse.urlparse(REDIS_URL)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    db = int(parsed.path.lstrip("/")) if parsed.path and str(parsed.path).strip("/") else 0
    return _redis.Redis(host=host, port=port, db=db, decode_responses=True)


async def build_snapshot():
    """Run in-process to avoid HTTP when possible, or fetch via API if deployed separately."""
    import httpx
    print(f"[{datetime.now(timezone.utc).isoformat()}] Building snapshot...")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            url = f"{API_BASE}/api/dashboard/full?mode=live"
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
    except httpx.ConnectError:
        # If API isn't available yet (e.g. during deploy), skip this cycle
        print("  → API not available, skipping snapshot build")
        return
    except Exception as exc:
        print(f"  → Error fetching dashboard data: {exc}")
        return

    if data.get("_mode") != "live":
        print(f"  → Live data unavailable, not caching fallback: {data.get('_warning', 'unknown error')}")
        return

    snapshot = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "live",
        "data": data,
    }

    r = _get_redis()
    if r:
        r.set("fleet:snapshot", json.dumps(snapshot), ex=300)
        print(f"  → Cached to Redis, TTL 5min. Summary: {len(data.get('recent_journeys', []))} journeys, "
              f"revenue={data.get('total_revenue', 0):,.0f}")
    else:
        path = os.getenv("SNAPSHOT_PATH", "/tmp/fleet_snapshot.json")
        with open(path, "w") as f:
            json.dump(snapshot, f)
        print(f"  → Written to {path}")


def main() -> None:
    asyncio.run(build_snapshot())


if __name__ == "__main__":
    main()
