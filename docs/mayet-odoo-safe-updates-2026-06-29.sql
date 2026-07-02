-- Safe Mayet -> Odoo vehicle name updates from the 2026-06-29 dry run.
-- Run with an Odoo DB user that has UPDATE permission on fleet_vehicle.
-- Only 2 vehicles matched unambiguously by plate format.

BEGIN;

CREATE TABLE IF NOT EXISTS fleet_vehicle_mayet_name_backup_20260629_0747 AS
SELECT id, name, license_plate, location, write_date, now() AS backed_up_at
FROM fleet_vehicle
WHERE false;

INSERT INTO fleet_vehicle_mayet_name_backup_20260629_0747
    (id, name, license_plate, location, write_date, backed_up_at)
SELECT id, name, license_plate, location, write_date, now()
FROM fleet_vehicle
WHERE id IN (5022, 5054);

UPDATE fleet_vehicle
SET name = 'SINO/SINO TRUCK/3-06154 ET',
    write_date = now()
WHERE id = 5022
  AND license_plate = 'ET-06154';

UPDATE fleet_vehicle
SET name = 'Frankun/FRANKUN/3-03678 ET',
    write_date = now()
WHERE id = 5054
  AND license_plate = 'ET-03678';

COMMIT;
