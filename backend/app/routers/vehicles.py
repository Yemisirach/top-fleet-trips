from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.server_cache import cache_get, cache_get_stale, cache_set
from app.services.fleet_odoo_service import get_fleet_vehicles, get_fleet_vehicle_by_id
from app.models.trip import VehicleSupervisor
from app.services.trip_service import assign_supervisors

router = APIRouter()


@router.get("")
async def list_vehicles(
    skip: int = 0,
    limit: int = 500,
    refresh: bool = Query(False),
    db: AsyncSession = Depends(get_session),
) -> list[dict]:
    """List all fleet vehicles from Odoo."""
    cache_key = f"fleet:vehicles:list:v1:{skip}:{limit}"
    if not refresh:
        cached = cache_get(cache_key) or cache_get_stale(cache_key)
        if cached is not None:
            return cached
    vehicles = await get_fleet_vehicles(db, skip=skip, limit=limit)
    response = [
        {
            "id": v.id,
            "license_plate": v.license_plate,
            "model": v.model_name,
            "brand": v.brand_name,
            "vin": v.vin_sn,
            "driver_id": v.driver_id,
            "state_id": v.state_id,
            "fuel_type": v.fuel_type,
            "active": v.active,
        }
        for v in vehicles
    ]
    cache_set(cache_key, response, ttl_seconds=60)
    return response


@router.get("/{vehicle_id}")
async def get_vehicle(
    vehicle_id: int,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Get a specific fleet vehicle by ID."""
    vehicle = await get_fleet_vehicle_by_id(db, vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return {
        "id": vehicle.id,
        "license_plate": vehicle.license_plate,
        "model": vehicle.model_name,
        "brand": vehicle.brand_name,
        "vin": vehicle.vin_sn,
        "driver_id": vehicle.driver_id,
        "state_id": vehicle.state_id,
        "fuel_type": vehicle.fuel_type,
        "active": vehicle.active,
    }


@router.post("/supervisors")
async def post_supervisors(
    payload: list[VehicleSupervisor],
    db: AsyncSession = Depends(get_session),
) -> dict[str, int]:
    """Assign supervisors to vehicles in the Odoo-backed supervisor table."""
    count = await assign_supervisors(db, payload)
    return {"count": count}
