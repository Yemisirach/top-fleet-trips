from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import asyncio
import os

from app.core.auth import user_from_request
from app.routers import auth, catalog, dashboard, health, integrations, reports, trips, vehicles, journeys

app = FastAPI(title="Fleet Trips API", version="0.1.0")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    public_paths = {"/health", "/login.html", "/api/auth/login", "/api/auth/logout"}
    if (
        request.method == "OPTIONS"
        or path in public_paths
        or (path.startswith("/static/") and not path.endswith(".html"))
    ):
        return await call_next(request)

    if not user_from_request(request):
        if path.startswith("/api/"):
            return JSONResponse({"detail": "Login required"}, status_code=401)
        return RedirectResponse("/login.html", status_code=303)

    return await call_next(request)


@app.exception_handler(asyncio.TimeoutError)
async def timeout_exception_handler(request: Request, exc: asyncio.TimeoutError):
    fallback = reports.fallback_response_for_path(request.url.path, request.query_params)
    if fallback is not None:
        return JSONResponse(fallback)
    return JSONResponse({"detail": "Live Odoo DB timed out."}, status_code=503)

# Serve static files
static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/", response_class=HTMLResponse)
async def root():
    dashboard_path = os.path.join(static_dir, "dashboard.html")
    with open(dashboard_path, "r") as f:
        return f.read()

@app.get("/login.html", response_class=HTMLResponse)
async def login_page():
    login_path = os.path.join(static_dir, "login.html")
    with open(login_path, "r") as f:
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

@app.get("/payments.html")
async def payments_page():
    return RedirectResponse(url="/report.html#payment-requests", status_code=302)

@app.get("/map.html", response_class=HTMLResponse)
async def map_page():
    map_path = os.path.join(static_dir, "map.html")
    with open(map_path, "r") as f:
        return f.read()

app.include_router(health.router)
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(trips.router, prefix="/api/trips", tags=["trips"])
app.include_router(vehicles.router, prefix="/api/vehicles", tags=["vehicles"])
app.include_router(catalog.router, prefix="/api/catalog", tags=["catalog"])
app.include_router(reports.router, prefix="/api/reports", tags=["reports"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(integrations.router, prefix="/api/integrations", tags=["integrations"])
app.include_router(journeys.router, prefix="/api", tags=["journeys"])
