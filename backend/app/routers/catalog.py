from fastapi import APIRouter

from app.models.trip import ExpenseType, FinancialTemplate, RevenueType, TripLocation
from app.services.catalog_service import list_expense_types, list_financial_templates, list_locations, list_revenue_types

router = APIRouter()


@router.get("/locations")
async def get_locations() -> list[TripLocation]:
    return list_locations()


@router.get("/expense-types")
async def get_expense_types() -> list[ExpenseType]:
    return list_expense_types()


@router.get("/revenue-types")
async def get_revenue_types() -> list[RevenueType]:
    return list_revenue_types()


@router.get("/financial-templates")
async def get_financial_templates() -> list[FinancialTemplate]:
    return list_financial_templates()
