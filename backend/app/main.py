from fastapi import FastAPI

from app.routers import catalog, dashboard, health, integrations, reports, trips, vehicles

app = FastAPI(title="Fleet Trips API", version="0.1.0")

app.include_router(health.router)
app.include_router(trips.router, prefix="/api/trips", tags=["trips"])
app.include_router(vehicles.router, prefix="/api/vehicles", tags=["vehicles"])
app.include_router(catalog.router, prefix="/api/catalog", tags=["catalog"])
app.include_router(reports.router, prefix="/api/reports", tags=["reports"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(integrations.router, prefix="/api/integrations", tags=["integrations"])
