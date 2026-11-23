from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from app.core.settings import get_settings

try:
    import redis as redis_client
except ImportError:  # pragma: no cover - optional runtime dependency
    redis_client = None


CACHE_TTL_SECONDS = 60


def _redis():
    if redis_client is None:
        return None
    try:
        return redis_client.Redis.from_url(get_settings().redis_url, decode_responses=True)
    except Exception:
        return None


def cache_get(key: str) -> Any | None:
    redis = _redis()
    if redis is None:
        return None
    try:
        raw = redis.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


def cache_get_stale(key: str) -> Any | None:
    return cache_get(f"{key}:stale")


def cache_set(key: str, value: Any, ttl_seconds: int = CACHE_TTL_SECONDS) -> None:
    redis = _redis()
    if redis is None:
        return
    try:
        payload = json.dumps(value, default=str)
        redis.setex(key, ttl_seconds, payload)
        redis.set(f"{key}:stale", payload)
        redis.set(f"{key}:stored_at", datetime.now(timezone.utc).isoformat())
    except Exception:
        return


LAST_SYNC_KEY = "fleet:server-last-sync"


def cache_stored_at(key: str) -> str | None:
    redis = _redis()
    if redis is None:
        return None
    try:
        return redis.get(f"{key}:stored_at")
    except Exception:
        return None


def cache_mark_synced(source: str, stored: list[str], failed: list[str]) -> dict[str, Any]:
    payload = {
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "stored": stored,
        "failed": failed,
        "live": True,
    }
    redis = _redis()
    if redis is not None:
        try:
            redis.set(LAST_SYNC_KEY, json.dumps(payload))
        except Exception:
            return payload
    return payload


def cache_sync_status() -> dict[str, Any]:
    redis = _redis()
    if redis is None:
        return {"synced_at": None, "source": None, "live": False, "stored": [], "failed": []}
    try:
        raw = redis.get(LAST_SYNC_KEY)
        if not raw:
            return {"synced_at": None, "source": None, "live": False, "stored": [], "failed": []}
        data = json.loads(raw)
        if isinstance(data, dict):
            data["live"] = bool(data.get("synced_at"))
            return data
    except Exception:
        return {"synced_at": None, "source": None, "live": False, "stored": [], "failed": []}
    return {"synced_at": None, "source": None, "live": False, "stored": [], "failed": []}
