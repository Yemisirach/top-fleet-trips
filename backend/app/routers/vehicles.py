from fastapi import APIRouter

from app.models.trip import VehicleSupervisor
from app.services.trip_service import assign_supervisors

router = APIRouter()


@router.get("")
async def get_vehicles() -> list[dict]:
    return [
        {"id": "VEH-001", "plate_no": "ET-1234", "status": "active"},
        {"id": "VEH-002", "plate_no": "ET-5678", "status": "active"},
    ]


@router.post("/supervisors")
async def post_supervisors(payload: list[VehicleSupervisor]) -> dict[str, int]:
    assign_supervisors(payload)
    return {"count": len(payload)}

