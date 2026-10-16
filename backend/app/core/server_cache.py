from __future__ import annotations

import json
from typing import Any

from app.core.settings import get_settings

try:
    import redis as redis_client
except ImportError:  # pragma: no cover - optional runtime dependency
    redis_client = None


CACHE_TTL_SECONDS = 600


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
    except Exception:
        return
