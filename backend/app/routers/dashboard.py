from fastapi import APIRouter

from app.services.trip_service import seed_sample_data
from app.repositories.memory import repo

router = APIRouter()


@router.get("/snapshot")
async def get_snapshot() -> dict:
    seed_sample_data()
    snapshot = repo.snapshot()
    return snapshot.model_dump()

