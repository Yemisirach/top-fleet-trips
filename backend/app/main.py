from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import asyncio
import os
from contextlib import asynccontextmanager, suppress

from app.core.auth import user_from_request
from app.routers import auth, catalog, dashboard, health, integrations, reports, trips, vehicles, journeys
from app.routers import fleet_sync
from app.services.fleet_store import store_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(store_loop())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


app = FastAPI(title="Fleet Trips API", version="0.1.0", lifespan=lifespan)

# ==================== CORS Configuration ====================
from fastapi.middleware.cors import CORSMiddleware
import os

def get_allowed_origins():
    origins_str = os.getenv("CORS_ORIGINS", "http://167.235.55.60:3003")
    return [origin.strip() for origin in origins_str.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
# ============================================================


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

    user = user_from_request(request)
    if not user:
        if path.startswith("/api/"):
            return JSONResponse({"detail": "Login required"}, status_code=401)
        return RedirectResponse("/login.html", status_code=303)

    if user.get("role") == "supervisor" and _supervisor_blocked(path):
        return JSONResponse({"detail": "Supervisors can only open assigned vehicles."}, status_code=403)

    return await call_next(request)


def _supervisor_blocked(path: str) -> bool:
    blocked = (
        "/api/reports/finance",
        "/api/reports/payment",
        "/api/reports/daily-profit",
        "/api/reports/yearly-profit",
        "/api/reports/income",
        "/api/reports/whatsapp",
        "/api/reports/responsible",
    )
    return any(part in path for part in blocked)


@app.exception_handler(asyncio.TimeoutError)
async def timeout_exception_handler(request: Request, exc: asyncio.TimeoutError):
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

@app.get("/payments.html", response_class=HTMLResponse)
async def payments_page():
    payments_path = os.path.join(static_dir, "payments.html")
    with open(payments_path, "r") as f:
        return f.read()

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
app.include_router(fleet_sync.router, prefix="/api/fleet", tags=["fleet-sync"])
