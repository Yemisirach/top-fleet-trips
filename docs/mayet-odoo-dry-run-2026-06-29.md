# Mayet to Odoo Dry Run - 2026-06-29

## Result

- Mayet scrape: 166 vehicle GPS/object records cached.
- Odoo active vehicles checked: 134.
- Safe unambiguous plate matches: 2.
- Unmatched or unsafe matches: 132.
- Mayet duplicate normalized keys: 2.

## Safe Matches Found

| Odoo ID | Odoo Plate | Current Odoo Name | Mayet Plate | Mayet Status | Proposed Name |
| --- | --- | --- | --- | --- | --- |
| 5022 | ET-06154 | SINO/SINO TRUCK/ET-06154 | 3-06154 ET | Online | SINO/SINO TRUCK/3-06154 ET |
| 5054 | ET-03678 | Frankun/FRANKUN/ET-03678 | 3-03678 ET | Offline | Frankun/FRANKUN/3-03678 ET |

## Write Attempt

The approved write was attempted after creating a backup transaction, but the configured database user does not have update permission on `fleet_vehicle`.

Error:

```text
permission denied for relation fleet_vehicle
```

No Odoo vehicle rows were changed because the transaction failed and rolled back.

## Next Step

Use one of these paths:

- Provide an Odoo/API credential that can write vehicle names through Odoo itself.
- Grant the configured database user update permission on `fleet_vehicle`.
- Run the generated update through a DBA/admin account after reviewing this dry run.

Direct database writes should remain limited to unambiguous matches unless a separate plate-mapping table is approved.
