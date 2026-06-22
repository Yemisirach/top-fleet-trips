from fastapi import APIRouter

from app.services.catalog_service import list_payment_requests, list_receivables
from app.services.trip_service import list_trips

router = APIRouter()


@router.get("/current-location")
async def current_location_report() -> list[dict]:
    return [
        {
            "trip_id": trip.id,
            "reference": trip.reference,
            "vehicle_id": trip.vehicle_id,
            "current_location_note": trip.current_location_note,
            "current_location_days": trip.current_location_days,
        }
        for trip in list_trips()
    ]


@router.get("/payment-requests")
async def payment_request_report() -> list[dict]:
    return [request.model_dump() for request in list_payment_requests()]


@router.get("/income-statement")
async def income_statement_report() -> dict:
    trips = list_trips()
    return {
        "trip_count": len(trips),
        "expense_total": sum(trip.expense_total for trip in trips),
        "revenue_total": sum(trip.revenue_total for trip in trips),
        "profit": sum(trip.profit for trip in trips),
        "receivable_count": len(list_receivables()),
    }
