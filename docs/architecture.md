# Architecture

## Core Services

- `fleet-api`: FastAPI read/write service
- `sync-worker`: Odoo and data sync worker
- `gps-worker`: Mayet live GPS ingestion worker
- `snapshot-worker`: builds the dashboard snapshot
- `dashboard`: frontend application

## Data Flow

1. Odoo sync updates trip, vehicle, and financial data.
2. GPS worker ingests live position updates.
3. Workers publish events to the message bus.
4. Snapshot worker merges source data into a final JSON snapshot.
5. API serves snapshot and trip views to the frontend.

## Notes

- Keep one source of truth per domain.
- Make events versioned.
- Make workers idempotent.
- Add observability from day one.
