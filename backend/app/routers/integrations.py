from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.services.odoo_service import check_odoo_connection

router = APIRouter()


@router.get("/odoo/status")
async def get_odoo_status(session: AsyncSession = Depends(get_session)) -> dict:
    status = await check_odoo_connection(session)
    return status.__dict__
