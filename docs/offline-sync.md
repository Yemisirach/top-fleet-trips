# Offline reads and Odoo synchronization

The FastAPI lifespan starts `fleet_store.store_loop`. After a 20-second startup
delay, it refreshes the Odoo datasets on a 60-second cadence. Three datasets run
concurrently, each with its own database session and timeout. A running cycle is
never overlapped; if it takes longer than a minute, the next cycle starts after
completion. Failed datasets retain their previous Redis copies. Docker Compose
enables Redis AOF persistence on the existing data volume.

The frontend restores IndexedDB before fetching cached reads. It downloads server
copies on startup, every 60 seconds, and when connectivity returns. Successful
downloads update memory, IndexedDB, and subscribed page state without reloading
the page. Aliases share one network request; concurrent refreshes share one cycle.
Previously visited date/filter variants are also refreshed. Manual Sync first
requests `/api/fleet/sync`, then downloads the resulting copies. The last-sync
label uses the server's confirmed Odoo sync timestamp, not the browser clock.

The service worker saves page shells and static assets. API responses bypass its
shared HTTP cache. Business data is stored in account-scoped IndexedDB and browser
storage, with separate keys for date/filter variants. Network failures can use
only the current account's saved data; access denials cannot use an offline fallback. After the worker first takes
control, the current page and loaded scripts/styles are warmed for offline reload.
Only data and pages already saved on the device are available offline. External
map tiles are not cached; a fully offline geographic basemap is not provided.
Offline writes are not queued. Background browser timers may be throttled when
the app is hidden or the device sleeps. Independent server/browser timers mean
new database data may appear on the following browser poll.

## Verification

- `node --test frontend/tests/offline-sync.test.cjs` (Node 24): offline cold start,
  cache publication, deduplication, manual/background sync, failure retention,
  filtered reads, exact service-worker cache matching, and server-error fallback.
- From `backend`: `python -m unittest test_fleet_store -v` checks bounded
  concurrency, partial/total failures, and overlapping background cycles.
- From `frontend`: `npx tsc --noEmit` and `npm run build` with `BACKEND_ORIGIN` set.

Live validation still requires deployment configuration: the API's `DATABASE_URL`
(or its fallback `ODOO_DATABASE_URL`) must point to the database with the Odoo
tables, and Redis must be reachable. This checkout has no configured live database.
Check a known Odoo record after an edit, wait for a completed server sync and browser
poll, then disconnect and reload a visited page. Confirm that its saved rows remain
visible, reconnect, and confirm that updated rows arrive without a page reload.


## Roles and assigned-vehicle daily report

Supervisor API access is deny-by-default. Only scoped dashboard/location/GPS reads,
authentication, sync endpoints, and the dedicated daily report are allowed.
Journey/trip detail requests must match records in that supervisor's scoped saved
dashboard; missing assignment evidence denies access. Managers alone can change
vehicle supervisor assignments and approve/edit payment requests. Salespeople can
create payment requests and view the broader reports.

The supervisor home includes a date-selected daily report from
`GET /api/supervisor/daily-report`. It includes trips last updated on the selected day in East Africa time, and matches current Odoo supervisor assignments by name. Expenses
come from trip expense lines, or payment request lines when no trip expenses exist;
the two sources are not added together. Revenue is the trip's own receivables,
including unconfirmed amounts shown separately. These are activity-day snapshots, not a
cashbook of payments received that day. No demo or hardcoded business records are
used. Failed first loads show unavailable; saved reports retain their original sync
time and explicit saved-data label. A successful empty result means no trips on the
selected date, not a database failure.

Account names, roles, and session expiration identify browser cache scopes. Legacy
unscoped data is ignored. Login/logout clear saved business data; responses arriving
after an account change are discarded. Logging out while disconnected does not
revoke the server cookie until the server is reachable, but local access must still
be cleared. Supervisor accounts must be configured with individual bcrypt hashes
in FLEET_USERS or use valid Odoo authentication; automatic shared-password accounts
and alternate fallback passwords have been removed. Existing sessions should be
invalidated during rollout by rotating FLEET_AUTH_SECRET, and users must sign in
again to establish the new offline identity.

Weekly and yearly views subscribe to the minute cache updates and query Odoo on opening. Their financial date grouping remains unchanged. The supervisor daily report uses only the last update date; it does not reconstruct historical versions of a trip.


## Manager report storage deployment

Manager edits are stored in SQLite at `/app/data/daily_profit_custom.db`. Compose
mounts the `fleet_report_data` volume there. Before replacing an existing container,
back up its existing SQLite database using SQLite's backup facility (including any
uncheckpointed WAL data), then restore the backup into the new volume. Adding an
empty volume does not migrate previous container-local edits automatically.

Actual revenue overrides affect daily, weekly, and yearly totals; Odoo revenue is
retained separately. Empty Actual restores Odoo revenue; zero is a real override.
Remarks appear in weekly and yearly views and exports. Overrides match date and
trip, never another trip on the same plate. Payment driver totals sum the displayed
request lines under the current filters; item numbering remains sequential.
