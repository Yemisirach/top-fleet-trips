#!/usr/bin/env python3
"""Seed a small set of active Odoo trips for dashboard/map validation."""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


ACTIVE_TRIP_SEEDS = [
    {"vehicle_id": 5135, "destination_id": 3, "state": "dispatched"},
    {"vehicle_id": 5136, "destination_id": 5, "state": "assigned"},
    {"vehicle_id": 5137, "destination_id": 8, "state": "available"},
]


async def seed_active_trips(*, apply: bool) -> list[dict]:
    from app.core.database import AsyncSessionLocal

    run_id = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    driver_id = 2336
    departure_id = 2
    results: list[dict] = []

    async with AsyncSessionLocal() as db:
        for index, seed in enumerate(ACTIVE_TRIP_SEEDS, start=1):
            name = f"SEED-ACTIVE-{run_id}-{index:02d}"
            payload = {
                "name": name,
                "driver_id": driver_id,
                "departure_id": departure_id,
                "destination_id": seed["destination_id"],
                "departure_date": date.today(),
                "vehicle_id": seed["vehicle_id"],
                "state": seed["state"],
                "create_uid": 1,
                "write_uid": 1,
            }
            if apply:
                result = await db.execute(
                    text("""
                        INSERT INTO trip_trip (
                            name, driver_id, departure_id, destination_id, departure_date,
                            vehicle_id, state, create_uid, create_date, write_uid, write_date
                        ) VALUES (
                            :name, :driver_id, :departure_id, :destination_id, :departure_date,
                            :vehicle_id, :state, :create_uid, now(), :write_uid, now()
                        )
                        RETURNING id
                    """),
                    payload,
                )
                payload["id"] = result.scalar_one()
            results.append(payload)
        if apply:
            await db.commit()

    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Write rows to Odoo instead of dry-run output.")
    args = parser.parse_args()
    rows = asyncio.run(seed_active_trips(apply=args.apply))
    for row in rows:
        print(row)


if __name__ == "__main__":
    main()
