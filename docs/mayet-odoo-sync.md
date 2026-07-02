# Mayet GPS to Odoo Sync

## Goal

Use Mayet credentials to ingest every Mayet vehicle, cache live GPS state, and update matching Odoo fleet vehicles only after a controlled approval step.

## Current Safe Contract

The Mayet worker writes GPS records into Redis:

- `fleet:gps:<original plate>`
- `fleet:gps:<upper plate>`
- `fleet:gps:<normalized plate>`

The dashboard and map read those cached records through:

- `GET /api/dashboard/gps/{vehicle_ref}`
- `GET /api/dashboard/mayet/vehicles`

## Production Workflow

1. Load credentials through environment variables:
   - `MAYET_URL`
   - `MAYET_USERNAME`
   - `MAYET_PASSWORD`
   - `MAYET_SEARCH_PATH`
   - `REDIS_URL`
2. Run Mayet object scrape with no `MAYET_PLATES` value to fetch all vehicles.
3. Normalize plates and Mayet vehicle names.
4. Create a dry-run report comparing Mayet vehicles to Odoo `fleet_vehicle` records.
5. Review unmatched, duplicate, and risky matches.
6. Back up affected Odoo rows.
7. Apply approved updates to Odoo.
8. Keep GPS/status updates in Redis unless an Odoo field is explicitly selected for synchronization.

## Data That Can Be Updated Safely

- Vehicle display name, if Odoo has a blank or outdated name.
- License plate normalization, only when the plate match is unambiguous.
- Last known GPS cache outside Odoo, through Redis.

## Data That Needs Approval

- Replacing Odoo license plates.
- Changing driver assignment.
- Writing Mayet status into Odoo operational state.
- Bulk updates to all vehicles.

## Required Before Live Odoo Writes

- Mayet credentials.
- Odoo target fields.
- Backup location.
- Approval for a dry-run diff.
- Approval for the final write.

## Sample Scenario Seeding

For demos, use mock/demo mode instead of writing fake trips into live Odoo. Demo mode already covers planned, in-progress, completed, cancelled, paid, pending, partial payment, multiple destinations, and multiple vehicle order counts.

If real Odoo demo records are needed, create them in a separate staging database first.
