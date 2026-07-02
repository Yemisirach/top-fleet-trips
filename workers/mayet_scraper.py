"""Mayet GPS scraper.

Looks up vehicles by plate number, persists the Mayet web session, and stores
latest GPS positions in Redis as fleet:gps:<PLATE>.

Credentials and endpoint details must come from env vars. Do not hardcode them.
"""

from __future__ import annotations

import asyncio
import html
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import httpx

# Add backend path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))


REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
MAYET_URL = os.getenv("MAYET_URL", "https://mayetgps.com/").rstrip("/")
MAYET_USERNAME = os.getenv("MAYET_USERNAME", "")
MAYET_PASSWORD = os.getenv("MAYET_PASSWORD", "")
MAYET_LOGIN_PATH = os.getenv("MAYET_LOGIN_PATH", "/authentication/create")
MAYET_LOGIN_POST_PATH = os.getenv("MAYET_LOGIN_POST_PATH", "/authentication/store")
MAYET_SEARCH_PATH = os.getenv("MAYET_SEARCH_PATH", "/objects/list/data")
MAYET_SESSION_PATH = Path(os.getenv("MAYET_SESSION_PATH", "/tmp/fleet-trips-mayet-session.json"))
MAYET_PLATES = [plate.strip() for plate in os.getenv("MAYET_PLATES", "").split(",") if plate.strip()]
GPS_CACHE_TTL_SECONDS = int(os.getenv("GPS_CACHE_TTL_SECONDS", "300"))
MAYET_CATALOG_CACHE_TTL_SECONDS = int(os.getenv("MAYET_CATALOG_CACHE_TTL_SECONDS", "3600"))


class _LoginFormParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.forms: list[dict[str, Any]] = []
        self._current: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name: value or "" for name, value in attrs}
        if tag == "form":
            self._current = {
                "action": values.get("action") or MAYET_LOGIN_PATH,
                "method": (values.get("method") or "post").lower(),
                "inputs": [],
            }
            self.forms.append(self._current)
            return
        if self._current is not None and tag == "input":
            self._current["inputs"].append(values)

    def handle_endtag(self, tag: str) -> None:
        if tag == "form":
            self._current = None


def _login_form(html: str) -> dict[str, Any]:
    parser = _LoginFormParser()
    parser.feed(html)
    for form in parser.forms:
        fields = {field.get("name", "") for field in form.get("inputs", [])}
        if "password" in fields and ({"identifier", "email", "username"} & fields):
            return form
    return {"action": MAYET_LOGIN_POST_PATH, "method": "post", "inputs": []}


def _login_payload(form: dict[str, Any]) -> dict[str, str]:
    payload: dict[str, str] = {}
    for field in form.get("inputs", []):
        name = field.get("name")
        if not name:
            continue
        field_type = (field.get("type") or "").lower()
        if field_type in {"submit", "button", "file"}:
            continue
        if field_type == "checkbox" and name != "remember_me":
            continue
        payload[name] = field.get("value") or ""
    for name in ("identifier", "email", "username"):
        if name in payload:
            payload[name] = MAYET_USERNAME
    payload["password"] = MAYET_PASSWORD
    payload.setdefault("identifier", MAYET_USERNAME)
    payload.setdefault("remember_me", "1")
    return payload


@dataclass
class GpsPosition:
    plate: str
    latitude: float | None
    longitude: float | None
    location: str | None = None
    address: str | None = None
    speed: float | None = None
    ignition: str | None = None
    captured_at: str | None = None
    raw: dict[str, Any] | None = None

    def to_cache(self) -> dict[str, Any]:
        return {
            "plate": self.plate,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "location": self.location,
            "address": self.address,
            "speed": self.speed,
            "ignition": self.ignition,
            "captured_at": self.captured_at or datetime.now(timezone.utc).isoformat(),
            "raw": self.raw or {},
        }


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


def _plate_key(plate: str) -> str:
    return plate.replace(" ", "").upper()


def _first_plate_number(plate: str) -> str:
    match = re.search(r"\d+", plate or "")
    return match.group(0).lstrip("0") if match else plate


def _load_cookies() -> dict[str, str]:
    if not MAYET_SESSION_PATH.exists():
        return {}
    try:
        data = json.loads(MAYET_SESSION_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    cookies = data.get("cookies", {})
    return cookies if isinstance(cookies, dict) else {}


def _save_cookies(client: httpx.AsyncClient) -> None:
    MAYET_SESSION_PATH.parent.mkdir(parents=True, exist_ok=True)
    cookies = {cookie.name: cookie.value for cookie in client.cookies.jar}
    MAYET_SESSION_PATH.write_text(json.dumps({
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "base_url": MAYET_URL,
        "cookies": cookies,
    }))


async def _client() -> httpx.AsyncClient:
    client = httpx.AsyncClient(
        base_url=MAYET_URL,
        timeout=30.0,
        follow_redirects=True,
        headers={
            "User-Agent": "FleetTrips/1.0",
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    for name, value in _load_cookies().items():
        client.cookies.set(name, value)
    return client


async def ensure_session(client: httpx.AsyncClient) -> bool:
    """Reuse existing cookies first; login only when credentials are available."""
    try:
        response = await client.get("/")
        response_path = response.url.path.lower()
        if response.status_code < 400 and "/authentication" not in response_path:
            _save_cookies(client)
            return True
    except httpx.HTTPError:
        pass

    if not (MAYET_USERNAME and MAYET_PASSWORD):
        return bool(_load_cookies())

    login_page = await client.get(MAYET_LOGIN_PATH)
    login_page.raise_for_status()
    if "/authentication" not in login_page.url.path.lower():
        _save_cookies(client)
        return True
    form = _login_form(login_page.text)
    response = await client.post(form.get("action") or MAYET_LOGIN_POST_PATH, data=_login_payload(form))
    response.raise_for_status()
    _save_cookies(client)
    return True


def _payload_candidates(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        candidates = payload.get("data") or payload.get("vehicles") or payload.get("items") or [payload]
        return candidates if isinstance(candidates, list) else [candidates]
    return []


def _position_from_item(plate: str, item: dict[str, Any]) -> GpsPosition | None:
    item_plate = html.unescape(str(item.get("plate") or item.get("plate_no") or item.get("license_plate") or item.get("name") or "")).strip()
    plate_search = _first_plate_number(plate)
    if plate_search and item_plate and plate_search not in _plate_key(item_plate):
        return None
    position_html = html.unescape(str(item.get("position") or ""))
    coordinate_match = re.search(r"(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)", position_html)
    lat = item.get("latitude") or item.get("lat") or item.get("y")
    lng = item.get("longitude") or item.get("lng") or item.get("lon") or item.get("x")
    if coordinate_match:
        lat = lat or coordinate_match.group(1)
        lng = lng or coordinate_match.group(2)
    status_text = str(item.get("status") or "")
    status_match = re.search(r"title=['\"]([^'\"]+)['\"]", status_text)
    return GpsPosition(
        plate=item_plate or plate,
        latitude=float(lat) if lat not in (None, "") else None,
        longitude=float(lng) if lng not in (None, "") else None,
        location=status_match.group(1) if status_match else item.get("location") or item.get("status") or item.get("geofence"),
        address=item.get("address") or item.get("addr") or re.sub(r"<[^>]+>", "", position_html).strip() or None,
        speed=float(item["speed"]) if item.get("speed") not in (None, "") else None,
        ignition=str(item.get("ignition") or item.get("acc") or "") or None,
        captured_at=item.get("time") or item.get("timestamp") or item.get("gps_time"),
        raw=item,
    )


def _extract_position(plate: str, payload: Any) -> GpsPosition | None:
    """Parse common Mayet/API response shapes without assuming a fixed schema."""
    for item in _payload_candidates(payload):
        if not isinstance(item, dict):
            continue
        position = _position_from_item(plate, item)
        if position:
            return position
    return None


def _extract_all_positions(payload: Any) -> list[GpsPosition]:
    positions: list[GpsPosition] = []
    for item in _payload_candidates(payload):
        if not isinstance(item, dict):
            continue
        position = _position_from_item("", item)
        if position and position.plate:
            positions.append(position)
    return positions


def _datatable_params(plate: str = "") -> dict[str, str]:
    columns = ["name", "status", "time", "position", "action"]
    params = {
        "draw": "1",
        "start": "0",
        "length": "200",
        "search[value]": plate,
        "search[regex]": "false",
        "order[0][column]": "0",
        "order[0][dir]": "asc",
    }
    for index, column in enumerate(columns):
        params[f"columns[{index}][data]"] = column
        params[f"columns[{index}][name]"] = column
        params[f"columns[{index}][searchable]"] = "true" if column == "name" else "false"
        params[f"columns[{index}][orderable]"] = "true" if column == "name" else "false"
        params[f"columns[{index}][search][value]"] = ""
        params[f"columns[{index}][search][regex]"] = "false"
    return params


async def scrape_plate(client: httpx.AsyncClient, plate: str) -> GpsPosition | None:
    if not MAYET_SEARCH_PATH:
        print("  -> MAYET_SEARCH_PATH is not configured; session is persisted but plate lookup is skipped.")
        return None

    search_plate = _first_plate_number(plate)
    params = _datatable_params(search_plate) if "objects/list/data" in MAYET_SEARCH_PATH else {"plate": search_plate, "q": search_plate, "search": search_plate}
    response = await client.get(MAYET_SEARCH_PATH, params=params)
    response.raise_for_status()
    try:
        payload = response.json()
    except ValueError:
        payload = {"html": response.text}
    return _extract_position(plate, payload)


async def scrape_all(client: httpx.AsyncClient) -> list[GpsPosition]:
    if not MAYET_SEARCH_PATH:
        return []
    response = await client.get(MAYET_SEARCH_PATH, params=_datatable_params(""))
    response.raise_for_status()
    try:
        payload = response.json()
    except ValueError:
        payload = {"html": response.text}
    return _extract_all_positions(payload)


def cache_position(position: GpsPosition) -> bool:
    redis = _get_redis()
    if not redis:
        return False
    raw = json.dumps(position.to_cache(), default=str)
    keys = {
        f"fleet:gps:{position.plate}",
        f"fleet:gps:{position.plate.upper()}",
        f"fleet:gps:{_plate_key(position.plate)}",
    }
    for key in keys:
        redis.set(key, raw, ex=GPS_CACHE_TTL_SECONDS)
    redis.set("fleet:gps:last_check", datetime.now(timezone.utc).isoformat(), ex=GPS_CACHE_TTL_SECONDS)
    return True


def cache_vehicle_catalog(positions: list[GpsPosition]) -> bool:
    redis = _get_redis()
    if not redis:
        return False
    payload = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "count": len(positions),
        "vehicles": [position.to_cache() for position in positions],
    }
    redis.set("fleet:mayet:vehicles", json.dumps(payload, default=str), ex=MAYET_CATALOG_CACHE_TTL_SECONDS)
    return True


async def run(plates: list[str] | None = None) -> None:
    plates = plates or MAYET_PLATES
    print(f"[{datetime.now(timezone.utc).isoformat()}] Mayet GPS worker running...")
    async with await _client() as client:
        session_ok = await ensure_session(client)
        if not session_ok:
            print("  -> Mayet session unavailable. Set MAYET_USERNAME and MAYET_PASSWORD or provide a saved session.")
            return
        if not plates:
            try:
                positions = await scrape_all(client)
            except Exception as exc:
                print(f"  -> Mayet object scrape failed: {exc}")
                return
            cache_vehicle_catalog(positions)
            cached = sum(1 for position in positions if cache_position(position))
            print(f"  -> Cached {cached} Mayet GPS positions from object list")
            return
        for plate in plates:
            try:
                position = await scrape_plate(client, plate)
                if not position:
                    print(f"  -> {plate}: no GPS result")
                    continue
                if cache_position(position):
                    print(f"  -> {plate}: cached GPS position")
                else:
                    print(f"  -> {plate}: GPS found, but Redis client is not installed or unavailable")
            except Exception as exc:
                print(f"  -> {plate}: scrape failed: {exc}")


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
