from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.services.fleet_odoo_service import get_fleet_vehicles, get_fleet_vehicle_by_id
from app.models.trip import VehicleSupervisor
from app.services.trip_service import assign_supervisors

router = APIRouter()


@router.get("")
async def list_vehicles(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_session),
) -> list[dict]:
    """List all fleet vehicles from Odoo."""
    vehicles = await get_fleet_vehicles(db, skip=skip, limit=limit)
    return [
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
async def post_supervisors(payload: list[VehicleSupervisor]) -> dict[str, int]:
    """Assign supervisors to vehicles."""
    assign_supervisors(payload)
    return {"count": len(payload)}