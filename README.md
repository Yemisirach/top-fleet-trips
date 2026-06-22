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
