# Fleet Trips Operations

## Service

Fleet Trips runs through systemd:

```bash
systemctl status fleet-api.service
systemctl restart fleet-api.service
```

The app listens on port `8004`.

## Important Pages

- Dashboard: `/`
- Visual map: `/map.html?journey_id=<id>`
- Detail page: `/detail.html?journey_id=<id>`
- Reports: `/report.html`

## Verification

```bash
curl http://127.0.0.1:8004/health
curl "http://127.0.0.1:8004/api/dashboard/full?mode=live"
curl "http://127.0.0.1:8004/api/dashboard/full?mode=demo"
curl "http://127.0.0.1:8004/api/journeys/1/timeline"
```

## Mayet Login Page Expiry

Mayet login pages can show "The page has expired due to inactivity" when embedded in an iframe or opened with a stale browser session. Fleet Trips should not depend on an embedded Mayet login page.

The reliable flow is:

1. Mayet worker logs in with credentials.
2. Worker stores vehicle GPS/status in Redis.
3. Fleet map reads cached GPS through the API.
4. Users can open Mayet directly in a new tab for manual inspection.
