# Fleet Trips

Fleet workflow platform for managing trips, vehicle assignments, payments, receivables, live GPS snapshots, and supervisor dashboards.

## Scope

- Trip lifecycle: Draft -> Available -> Assigned -> Dispatched -> Done
- Financial sketchpads for expenses and revenue
- Payment request integration
- Receivables integration
- Supervisor-scoped dashboards
- Snapshot API for fast reads
- GPS ingestion via Mayet
- Odoo sync pipeline

## App Login

Fleet Trips uses its own app login, separate from Odoo sessions.

- Manager: `danat.yoh` / `123` - can approve and update payment requests
- Supervisor: `alula.yem` / `123` - can view app data
- Salesperson: `barbra.sem` / `123` - can view app data

Set `FLEET_AUTH_SECRET` in production so login cookies are signed with a deployment-specific secret.

## Repo Layout

- `backend/` FastAPI app
- `workers/` sync, GPS, and snapshot jobs
- `frontend/` dashboard app
- `docs/` architecture and implementation notes

## Next Steps

1. Add environment variables and secrets management.
2. Implement the FastAPI service contract.
3. Implement workers and queue/event handling.
4. Add Docker Compose for local and deployment runs.

## Operations and Product Docs

- [Operations runbook](docs/operations.md)
- [Mayet GPS to Odoo sync plan](docs/mayet-odoo-sync.md)
- [Mayet to Odoo dry run - 2026-06-29](docs/mayet-odoo-dry-run-2026-06-29.md)
- [Safe Mayet to Odoo update SQL - 2026-06-29](docs/mayet-odoo-safe-updates-2026-06-29.sql)
- [Mobile app plan](docs/mobile-app.md)

## Current Status

- FastAPI service scaffolded
- Trips, vehicles, and dashboard snapshot routes exist
- In-memory repository is wired for development
- Docker Compose is available for local deployment

## API Endpoints

- `GET /health`
- `GET /api/trips`
- `POST /api/trips`
- `GET /api/trips/{trip_id}`
- `PATCH /api/trips/{trip_id}`
- `POST /api/trips/{trip_id}/expense-lines`
- `GET /api/vehicles`
- `POST /api/vehicles/supervisors`
- `GET /api/dashboard/snapshot`
