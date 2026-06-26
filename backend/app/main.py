from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

import os

from app.routers import catalog, dashboard, health, integrations, reports, trips, vehicles, journeys

app = FastAPI(title="Fleet Trips API", version="0.1.0")

# Serve static files
static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/", response_class=HTMLResponse)
async def root():
    dashboard_path = os.path.join(static_dir, "dashboard.html")
    with open(dashboard_path, "r") as f:
        return f.read()

@app.get("/detail.html", response_class=HTMLResponse)
async def detail_page():
    detail_path = os.path.join(static_dir, "detail.html")
    with open(detail_path, "r") as f:
        return f.read()

@app.get("/report.html", response_class=HTMLResponse)
async def report_page():
    report_path = os.path.join(static_dir, "report.html")
    with open(report_path, "r") as f:
        return f.read()

@app.get("/map.html", response_class=HTMLResponse)
async def map_page():
    map_path = os.path.join(static_dir, "map.html")
    with open(map_path, "r") as f:
        return f.read()

app.include_router(health.router)
app.include_router(trips.router, prefix="/api/trips", tags=["trips"])
app.include_router(vehicles.router, prefix="/api/vehicles", tags=["vehicles"])
app.include_router(catalog.router, prefix="/api/catalog", tags=["catalog"])
app.include_router(reports.router, prefix="/api/reports", tags=["reports"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(integrations.router, prefix="/api/integrations", tags=["integrations"])
app.include_router(journeys.router, prefix="/api", tags=["journeys"])
