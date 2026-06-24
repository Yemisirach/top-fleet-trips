"""Mayet GPS scraper — ingests live vehicle GPS data."""
import asyncio
import os
import sys
from datetime import datetime, timezone

# Add backend path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


def _get_redis():
    try:
        import redis as _redis
    except ImportError:
        return None
    import urllib.parse
    parsed = urllib.parse.urlparse(REDIS_URL)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    db = int(parsed.path.lstrip("/")) if parsed.path and str(parsed.path).strip("/") else 0
    return _redis.Redis(host=host, port=port, db=db, decode_responses=True)


async def run():
    print(f"[{datetime.now(timezone.utc).isoformat()}] GPS worker running...")
    # Placeholder: in real implementation this would call the Mayet API
    # and store positions in Redis with keys like fleet:gps:<vehicle_id>
    # Mayet API key and endpoint would be loaded from env vars.
    # For now, log a heartbeat so the container logs show activity.
    r = _get_redis()
    if r:
        r.set("fleet:gps:last_check", datetime.now(timezone.utc).isoformat(), ex=120)
    print("  → Mayet GPS not yet configured (needs API key + endpoint). Skipping.")


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
