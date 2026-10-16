from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.models.trip import ExpenseType, FinancialTemplate, RevenueType, TripLocation
from app.services.catalog_service import list_expense_types, list_financial_templates, list_locations, list_revenue_types

router = APIRouter()


@router.get("/locations")
async def get_locations(db: AsyncSession = Depends(get_session)) -> list[TripLocation]:
    return await list_locations(db)


@router.get("/expense-types")
async def get_expense_types(db: AsyncSession = Depends(get_session)) -> list[ExpenseType]:
    return await list_expense_types(db)


@router.get("/revenue-types")
async def get_revenue_types(db: AsyncSession = Depends(get_session)) -> list[RevenueType]:
    return await list_revenue_types(db)


@router.get("/financial-templates")
async def get_financial_templates(db: AsyncSession = Depends(get_session)) -> list[FinancialTemplate]:
    return await list_financial_templates(db)
