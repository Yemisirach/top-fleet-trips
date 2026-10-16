#!/usr/bin/env python3
"""
Seed payment-request scenarios against a running Fleet Trips API.

This is for local or staging environments only.
The app no longer uses mock trips in-process, so the clean way to seed
payment requests is through the API on top of a staging Odoo-backed dataset.
"""

from __future__ import annotations

import argparse
import asyncio
import os
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP

import httpx
from sqlalchemy import text


PAYMENT_REQUEST_SCENARIOS = [
    {"state": "draft", "label": "Draft vendor request"},
    {"state": "confirmed", "label": "Confirmed trip payment"},
    {"state": "approved", "label": "Approved payment request"},
    {"state": "paid", "label": "Paid settlement"},
    {"state": "done", "label": "Completed trip settlement"},
    {"state": "posted", "label": "Posted accounting entry"},
    {"state": "cancelled", "label": "Cancelled request"},
]

PAYMENT_ITEMS = [
    ("Fuel", Decimal("0.46")),
    ("Driver allowance", Decimal("0.18")),
    ("Loading labor", Decimal("0.14")),
    ("Road toll", Decimal("0.08")),
    ("Maintenance", Decimal("0.09")),
    ("Miscellaneous", Decimal("0.05")),
]


@dataclass(frozen=True)
class SeedConfig:
    base_url: str
    username: str
    password: str
    items_per_request: int
    trusted_local_cookie: bool
    direct_db: bool


def _money(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _split_amount(total: Decimal, count: int) -> list[Decimal]:
    count = max(2, min(count, len(PAYMENT_ITEMS)))
    weights = [weight for _, weight in PAYMENT_ITEMS[:count]]
    parts: list[Decimal] = []
    remaining = total
    for index in range(count - 1):
        weight = weights[index]
        weight_total = sum(weights)
        portion = (total * weight / weight_total).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        parts.append(portion)
        remaining -= portion
    parts.append(remaining.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    return parts


def _build_line_items(state: str, label: str, total: Decimal, line_count: int) -> tuple[list[dict], str]:
    amounts = _split_amount(total, line_count)
    items = []
    text_lines = []
    for index, amount in enumerate(amounts, start=1):
        item_name = PAYMENT_ITEMS[index - 1][0]
        item = f"{item_name} - {state}"
        description = f"{label}: {item_name.lower()} cost item {index}"
        items.append(
            {
                "item": item,
                "description": description,
                "amount": _money(amount),
                "quantity": 1,
                "total": _money(amount),
            }
        )
        text_lines.append(f"{item}: {description} - {_money(amount):.2f}")
    return items, "\n".join(text_lines)


def _login(client: httpx.Client, config: SeedConfig) -> dict:
    if config.trusted_local_cookie:
        from app.core.auth import AUTH_COOKIE_NAME, create_token

        user = {"username": config.username, "name": config.username, "role": "manager", "auth_source": "seed"}
        client.cookies.set(AUTH_COOKIE_NAME, create_token(user))
        return user

    response = client.post(
        "/api/auth/login",
        json={"username": config.username, "password": config.password},
    )
    response.raise_for_status()
    payload = response.json()
    user = payload.get("user") or {}
    if not user:
        raise RuntimeError("Login succeeded but no user payload was returned.")
    return user


def _fetch_trips(client: httpx.Client) -> list[dict]:
    response = client.get("/api/trips")
    response.raise_for_status()
    trips = response.json()
    if not isinstance(trips, list) or not trips:
        raise RuntimeError("No trips were returned by GET /api/trips.")
    return trips


def _pick_trip(trips: list[dict], index: int) -> dict:
    trip = trips[index % len(trips)]
    trip_id = trip.get("id")
    if trip_id is None:
        raise RuntimeError(f"Trip at index {index} is missing an id: {trip}")
    return trip


def _seed_payment_request(
    client: httpx.Client,
    *,
    trip: dict,
    state: str,
    label: str,
    sequence: int,
    items_per_request: int,
) -> dict:
    trip_id = int(trip["id"])
    total = Decimal("8400") + Decimal(sequence * 1275) + Decimal(trip_id % 9) * Decimal("125")
    line_items, request_text = _build_line_items(state, label, total, items_per_request)
    payload = {
        "name": f"SEED-PR-{state.upper()}-{trip_id}-{sequence:02d}",
        "reference": f"PR-{state[:3].upper()}-{trip_id}-{sequence:02d}",
        "trip_id": trip_id,
        "trip_reference": str(trip.get("name") or trip_id),
        "vehicle_plate": trip.get("vehicle_plate") or "",
        "state": state,
        "date": date.today().isoformat(),
        "total_amount": _money(total),
        "notes": f"{label} for trip {trip.get('name') or trip_id}",
        "request_text": request_text,
        "line_items": line_items,
    }
    response = client.post("/api/reports/payment-requests", json=payload)
    if response.status_code == 404:
        response = client.post("/api/reports/payment-request", json=payload)
    response.raise_for_status()
    created = response.json()
    payment = created.get("payment") or {}
    return {
        "trip_id": trip_id,
        "trip_name": trip.get("name") or str(trip_id),
        "payment_id": payment.get("id"),
        "state": payment.get("state", state),
        "reference": payment.get("reference") or payload["reference"],
        "total_amount": payment.get("total_amount", _money(total)),
        "line_count": len(line_items),
    }


def _seed_all(config: SeedConfig) -> list[dict]:
    results: list[dict] = []
    with httpx.Client(base_url=config.base_url, timeout=30.0) as client:
        _login(client, config)
        trips = _fetch_trips(client)
        for index, scenario in enumerate(PAYMENT_REQUEST_SCENARIOS):
            trip = _pick_trip(trips, index)
            results.append(
                _seed_payment_request(
                    client,
                    trip=trip,
                    state=scenario["state"],
                    label=scenario["label"],
                    sequence=index + 1,
                    items_per_request=config.items_per_request,
                )
            )
    return results


async def _fetch_db_trips(limit: int) -> list[dict]:
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT
                    t.id,
                    t.name,
                    COALESCE(v.license_plate, '') AS vehicle_plate
                FROM trip_trip t
                LEFT JOIN fleet_vehicle v ON t.vehicle_id = v.id
                ORDER BY t.id DESC
                LIMIT :limit
            """),
            {"limit": limit},
        )
        return [dict(row._mapping) for row in result.fetchall()]


async def _seed_payment_request_db(
    *,
    trip: dict,
    state: str,
    label: str,
    sequence: int,
    items_per_request: int,
) -> dict:
    from app.core.database import AsyncSessionLocal

    trip_id = int(trip["id"])
    now = datetime.utcnow()
    total = Decimal("8400") + Decimal(sequence * 1275) + Decimal(trip_id % 9) * Decimal("125")
    line_items, request_text = _build_line_items(state, label, total, items_per_request)
    payment_name = f"SEED-PR-{state.upper()}-{trip_id}-{now.strftime('%Y%m%d%H%M%S')}-{sequence:02d}"
    payment_ref = f"PR-{state[:3].upper()}-{trip_id}-{sequence:02d}"
    db_user_id = 1
    approved_on = now if state in {"approved", "paid", "done", "posted"} else None

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                INSERT INTO payment_request (
                    source, amount, state, create_uid, create_date, write_uid, write_date,
                    ref, description, date, approve_uid, approve_date, amount_birr,
                    "current_user", requester_id, prepared_by, name, source_doc, is_trip_payment, trip_id
                ) VALUES (
                    :source, :amount, :state, :create_uid, now(), :write_uid, now(),
                    :ref, :description, :date, :approve_uid, :approve_date, :amount_birr,
                    :current_user, :requester_id, :prepared_by, :name, :source_doc, :is_trip_payment, :trip_id
                )
                RETURNING id
            """),
            {
                "source": "seed",
                "amount": _money(total),
                "state": state,
                "create_uid": db_user_id,
                "write_uid": db_user_id,
                "ref": payment_ref,
                "description": request_text,
                "date": date.today(),
                "approve_uid": db_user_id if approved_on else None,
                "approve_date": approved_on,
                "amount_birr": _money(total),
                "current_user": db_user_id,
                "requester_id": db_user_id,
                "prepared_by": db_user_id,
                "name": payment_name,
                "source_doc": str(trip.get("name") or trip_id),
                "is_trip_payment": True,
                "trip_id": trip_id,
            },
        )
        payment_id = result.scalar_one()
        for line in line_items:
            await db.execute(
                text("""
                    INSERT INTO payment_request_line (
                        payment_request_id, item, description, amount, quantity, total,
                        create_uid, create_date, write_uid, write_date
                    ) VALUES (
                        :payment_request_id, :item, :description, :amount, :quantity, :total,
                        :create_uid, now(), :write_uid, now()
                    )
                """),
                {
                    "payment_request_id": payment_id,
                    "item": line["item"],
                    "description": line["description"],
                    "amount": line["amount"],
                    "quantity": line["quantity"],
                    "total": line["total"],
                    "create_uid": db_user_id,
                    "write_uid": db_user_id,
                },
            )
        await db.commit()

    return {
        "trip_id": trip_id,
        "trip_name": trip.get("name") or str(trip_id),
        "payment_id": payment_id,
        "state": state,
        "reference": payment_ref,
        "total_amount": _money(total),
        "line_count": len(line_items),
    }


async def _seed_all_db(config: SeedConfig) -> list[dict]:
    trips = await _fetch_db_trips(len(PAYMENT_REQUEST_SCENARIOS))
    if not trips:
        raise RuntimeError("No trips were returned by the Odoo DB.")
    results = []
    for index, scenario in enumerate(PAYMENT_REQUEST_SCENARIOS):
        results.append(
            await _seed_payment_request_db(
                trip=_pick_trip(trips, index),
                state=scenario["state"],
                label=scenario["label"],
                sequence=index + 1,
                items_per_request=config.items_per_request,
            )
        )
    return results


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed payment request scenarios through the Fleet API.")
    parser.add_argument(
        "--base-url",
        default=os.getenv("FLEET_BASE_URL", "http://127.0.0.1:8004"),
        help="Fleet Trips base URL, for example http://127.0.0.1:8004 or http://167.235.55.60:3016",
    )
    parser.add_argument(
        "--username",
        default=os.getenv("FLEET_SEED_USERNAME", "danat.yoh"),
        help="Login username for the Fleet Trips app",
    )
    parser.add_argument(
        "--password",
        default=os.getenv("FLEET_SEED_PASSWORD", "123"),
        help="Login password for the Fleet Trips app",
    )
    parser.add_argument(
        "--items-per-request",
        type=int,
        default=int(os.getenv("FLEET_SEED_ITEMS_PER_REQUEST", "4")),
        help="Number of line items per seeded payment request, from 2 to 6",
    )
    parser.add_argument(
        "--trusted-local-cookie",
        action="store_true",
        default=os.getenv("FLEET_SEED_TRUSTED_LOCAL_COOKIE", "").strip().lower() in {"1", "true", "yes", "on"},
        help="Create a signed local auth cookie from FLEET_AUTH_SECRET instead of logging in",
    )
    parser.add_argument(
        "--direct-db",
        action="store_true",
        default=os.getenv("FLEET_SEED_DIRECT_DB", "").strip().lower() in {"1", "true", "yes", "on"},
        help="Seed directly through the configured Odoo DB instead of the HTTP API",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = SeedConfig(
        base_url=args.base_url.rstrip("/"),
        username=args.username,
        password=args.password,
        items_per_request=max(2, min(args.items_per_request, len(PAYMENT_ITEMS))),
        trusted_local_cookie=args.trusted_local_cookie,
        direct_db=args.direct_db,
    )

    results = asyncio.run(_seed_all_db(config)) if config.direct_db else _seed_all(config)
    print(f"Seeded {len(results)} payment request scenarios:")
    for result in results:
        print(
            f"  - {result['reference']} | trip={result['trip_name']} | "
            f"state={result['state']} | items={result['line_count']} | amount={result['total_amount']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
