# Workers

Background jobs for sync, GPS ingestion, and snapshot generation.

## Mayet GPS worker

`mayet_scraper.py` persists a Mayet web session and looks up vehicles by plate
number. GPS results are cached in Redis as `fleet:gps:<PLATE>` for the detail
and visual map pages.

Required runtime config:

- `MAYET_URL` defaults to `https://mayetgps.com/`
- `MAYET_USERNAME`
- `MAYET_PASSWORD`
- `MAYET_LOGIN_PATH` defaults to `/authentication/create`
- `MAYET_LOGIN_POST_PATH` defaults to `/authentication/store`
- `MAYET_SEARCH_PATH` defaults to `/objects/list/data`
- `MAYET_SESSION_PATH` defaults to `/tmp/fleet-trips-mayet-session.json`
- `MAYET_PLATES` comma-separated plate numbers to scrape; leave blank to scrape the Mayet object list for all vehicles
- `GPS_CACHE_TTL_SECONDS` defaults to `300`
- `MAYET_CATALOG_CACHE_TTL_SECONDS` defaults to `3600`
- `REDIS_URL`

Keep credentials in environment variables or secrets management, not in source
files. If Mayet search is only available through browser-rendered UI, swap the
HTTP lookup implementation for a Playwright adapter while keeping the same Redis
cache contract.

Do not write Mayet data directly into live Odoo until a dry-run comparison and
backup have been reviewed. See `docs/mayet-odoo-sync.md`.
