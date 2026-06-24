"""Service for querying Odoo fleet data directly from the source PostgreSQL DB."""

from dataclasses import dataclass
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import get_settings

settings = get_settings()


@dataclass
class FleetVehicle:
    id: int
    license_plate: Optional[str]
    model_name: Optional[str]
    brand_name: Optional[str]
    vin_sn: Optional[str]
    driver_id: Optional[int]
    state_id: Optional[int]
    fuel_type: Optional[str]
    active: bool


@dataclass
class FleetTrip:
    id: int
    name: Optional[str]
    financial_template_id: Optional[int]
    driver_id: Optional[int]
    departure_id: Optional[int]
    destination_id: Optional[int]
    current_location_id: Optional[int]
    current_location_note: Optional[str]
    departure_date: Optional[str]
    arrival_date: Optional[str]
    vehicle_id: Optional[int]
    note: Optional[str]
    state: Optional[str]
    general_note: Optional[str]
    expense_note: Optional[str]
    revenue_note: Optional[str]
    create_date: Optional[str]
    write_date: Optional[str]


async def get_fleet_vehicles(session: AsyncSession, skip: int = 0, limit: int = 100) -> list[FleetVehicle]:
    """Fetch all active fleet vehicles with their model/brand info."""
    query = text(
        """
        SELECT
            v.id,
            v.license_plate,
            m.name as model_name,
            b.name as brand_name,
            v.vin_sn,
            v.driver_id,
            v.state_id,
            v.fuel_type,
            v.active
        FROM fleet_vehicle v
        LEFT JOIN fleet_vehicle_model m ON v.model_id = m.id
        LEFT JOIN fleet_vehicle_model_brand b ON m.brand_id = b.id
        WHERE v.active = true
        ORDER BY v.id
        LIMIT :limit OFFSET :skip
        """
    )
    result = await session.execute(query, {"skip": skip, "limit": limit})
    rows = result.fetchall()
    return [FleetVehicle(**dict(row._mapping)) for row in rows]


async def get_fleet_vehicle_by_id(session: AsyncSession, vehicle_id: int) -> Optional[FleetVehicle]:
    """Fetch a single fleet vehicle by ID."""
    query = text(
        """
        SELECT
            v.id,
            v.license_plate,
            m.name as model_name,
            b.name as brand_name,
            v.vin_sn,
            v.driver_id,
            v.state_id,
            v.fuel_type,
            v.active
        FROM fleet_vehicle v
        LEFT JOIN fleet_vehicle_model m ON v.model_id = m.id
        LEFT JOIN fleet_vehicle_model_brand b ON m.brand_id = b.id
        WHERE v.id = :vehicle_id
        """)
    result = await session.execute(query, {"vehicle_id": vehicle_id})
    row = result.fetchone()
    if row is None:
        return None
    return FleetVehicle(**dict(row._mapping))


async def get_fleet_trips(session: AsyncSession, skip: int = 0, limit: int = 100) -> list[FleetTrip]:
    """Fetch all fleet trips from Odoo."""
    query = text(
        """
        SELECT
            t.id,
            t.name,
            t.financial_template_id,
            t.driver_id,
            t.departure_id,
            t.destination_id,
            t.current_location_id,
            t.current_location_note,
            t.departure_date::text,
            t.arrival_date::text,
            t.vehicle_id,
            t.note,
            t.state,
            t.general_note,
            t.expense_note,
            t.revenue_note,
            t.create_date::text,
            t.write_date::text
        FROM trip_trip t
        ORDER BY t.id
        LIMIT :limit OFFSET :skip
        """
    )
    result = await session.execute(query, {"skip": skip, "limit": limit})
    rows = result.fetchall()
    return [FleetTrip(**dict(row._mapping)) for row in rows]


async def get_fleet_trip_by_id(session: AsyncSession, trip_id: int) -> Optional[FleetTrip]:
    """Fetch a single trip by ID."""
    query = text(
        """
        SELECT
            t.id,
            t.name,
            t.financial_template_id,
            t.driver_id,
            t.departure_id,
            t.destination_id,
            t.current_location_id,
            t.current_location_note,
            t.departure_date::text,
            t.arrival_date::text,
            t.vehicle_id,
            t.note,
            t.state,
            t.general_note,
            t.expense_note,
            t.revenue_note,
            t.create_date::text,
            t.write_date::text
        FROM trip_trip t
        WHERE t.id = :trip_id
        """)
    result = await session.execute(query, {"trip_id": trip_id})
    row = result.fetchone()
    if row is None:
        return None
    return FleetTrip(**dict(row._mapping))