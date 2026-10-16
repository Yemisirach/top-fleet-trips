from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.trip import VehicleSupervisor


async def assign_supervisors(db: AsyncSession, supervisors: list[VehicleSupervisor]) -> int:
    """Persist vehicle supervisors in the Odoo-backed fleet_vehicle_supervisor table."""
    await db.execute(text("DELETE FROM fleet_vehicle_supervisor"))
    inserted = 0
    for supervisor in supervisors:
        await db.execute(
            text("""
                INSERT INTO fleet_vehicle_supervisor (vehicle_id, user_id)
                VALUES (:vehicle_id, :user_id)
            """),
            {
                "vehicle_id": supervisor.vehicle_id,
                "user_id": supervisor.user_id,
            },
        )
        inserted += 1
    await db.commit()
    return inserted
