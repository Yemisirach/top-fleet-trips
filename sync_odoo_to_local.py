#!/usr/bin/env python3
"""
Sync script: Pull fleet-related data from Odoo (TOP_2019) into local fleet_trips_local database.
Run manually or schedule via cron/systemd.
"""

import asyncio
import asyncpg
import os
from datetime import date, datetime
from typing import List, Dict, Any

# Database connections
ODOO_DSN = "postgresql://testbed_user:testbed@321@100.121.12.65:5432/TOP_2019"
LOCAL_DSN = "postgresql://postgres@/fleet_trips_local"  # uses peer auth as postgres user

class FleetDataSyncer:
    def __init__(self):
        self.odoo_pool = None
        self.local_pool = None

    async def connect(self):
        self.odoo_pool = await asyncpg.create_pool(ODOO_DSN, min_size=2, max_size=5)
        # For local DB, connect as postgres user via unix socket
        self.local_pool = await asyncpg.create_pool(
            "postgresql:///fleet_trips_local?host=/var/run/postgresql",
            min_size=2, max_size=5
        )
        print("✓ Connected to both databases")

    async def close(self):
        if self.odoo_pool:
            await self.odoo_pool.close()
        if self.local_pool:
            await self.local_pool.close()

    # ===== SYNC METHODS =====

    async def sync_fleet_vehicles(self):
        """Sync active fleet vehicles from Odoo"""
        query = """
            SELECT v.id, v.name, v.license_plate, m.name as model_name, b.name as brand_name,
                   v.active, v.driver_id,
                   (SELECT fvs.user_id FROM fleet_vehicle_supervisor fvs 
                    WHERE fvs.vehicle_id = v.id 
                    ORDER BY fvs.write_date DESC NULLS LAST, fvs.create_date DESC NULLS LAST LIMIT 1) as supervisor_id
            FROM fleet_vehicle v
            LEFT JOIN fleet_vehicle_model m ON v.model_id = m.id
            LEFT JOIN fleet_vehicle_model_brand b ON m.brand_id = b.id
            WHERE v.active = true
        """
        async with self.odoo_pool.acquire() as conn:
            rows = await conn.fetch(query)

        upsert = """
            INSERT INTO fleet_vehicles (id, name, license_plate, model_name, brand_name, active, driver_id, supervisor_id, synced_at, odoo_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $1)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                license_plate = EXCLUDED.license_plate,
                model_name = EXCLUDED.model_name,
                brand_name = EXCLUDED.brand_name,
                active = EXCLUDED.active,
                driver_id = EXCLUDED.driver_id,
                supervisor_id = EXCLUDED.supervisor_id,
                synced_at = NOW()
        """
        async with self.local_pool.acquire() as conn:
            await conn.executemany(upsert, [
                (r['id'], r['name'], r['license_plate'], r['model_name'], r['brand_name'],
                 r['active'], r['driver_id'], r['supervisor_id']) for r in rows
            ])
        print(f"✓ Synced {len(rows)} fleet vehicles")

    async def sync_trips(self):
        """Sync all trips from Odoo"""
        query = """
            SELECT id, name, state, departure_date, arrival_date, create_date, write_date,
                   vehicle_id, driver_id, departure_id, destination_id,
                   current_location_id, current_location_note, note, general_note,
                   expense_note, revenue_note, financial_template_id
            FROM trip_trip
        """
        async with self.odoo_pool.acquire() as conn:
            rows = await conn.fetch(query)

        upsert = """
            INSERT INTO trips (id, name, state, departure_date, arrival_date, create_date, write_date,
                               vehicle_id, driver_id, departure_id, destination_id,
                               current_location_id, current_location_note, note, general_note,
                               expense_note, revenue_note, financial_template_id, synced_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                state = EXCLUDED.state,
                departure_date = EXCLUDED.departure_date,
                arrival_date = EXCLUDED.arrival_date,
                write_date = EXCLUDED.write_date,
                vehicle_id = EXCLUDED.vehicle_id,
                driver_id = EXCLUDED.driver_id,
                departure_id = EXCLUDED.departure_id,
                destination_id = EXCLUDED.destination_id,
                current_location_id = EXCLUDED.current_location_id,
                current_location_note = EXCLUDED.current_location_note,
                note = EXCLUDED.note,
                general_note = EXCLUDED.general_note,
                expense_note = EXCLUDED.expense_note,
                revenue_note = EXCLUDED.revenue_note,
                financial_template_id = EXCLUDED.financial_template_id,
                synced_at = NOW()
        """
        async with self.local_pool.acquire() as conn:
            await conn.executemany(upsert, [
                (r['id'], r['name'], r['state'], r['departure_date'], r['arrival_date'],
                 r['create_date'], r['write_date'], r['vehicle_id'], r['driver_id'],
                 r['departure_id'], r['destination_id'], r['current_location_id'],
                 r['current_location_note'], r['note'], r['general_note'],
                 r['expense_note'], r['revenue_note'], r['financial_template_id']) for r in rows
            ])
        print(f"✓ Synced {len(rows)} trips")

    async def sync_trip_timeline(self):
        query = "SELECT * FROM trip_timeline"
        async with self.odoo_pool.acquire() as conn:
            rows = await conn.fetch(query)

        upsert = """
            INSERT INTO trip_timeline (id, trip_id, trip_reference, status, create_uid, create_date, write_uid, write_date, synced_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (id) DO UPDATE SET
                trip_id = EXCLUDED.trip_id,
                trip_reference = EXCLUDED.trip_reference,
                status = EXCLUDED.status,
                write_uid = EXCLUDED.write_uid,
                write_date = EXCLUDED.write_date,
                synced_at = NOW()
        """
        async with self.local_pool.acquire() as conn:
            await conn.executemany(upsert, [
                (r['id'], r['trip_id'], r['trip_reference'], r['status'],
                 r['create_uid'], r['create_date'], r['write_uid'], r['write_date']) for r in rows
            ])
        print(f"✓ Synced {len(rows)} trip timeline records")

    async def sync_trip_timeline_entries(self):
        query = "SELECT * FROM trip_timeline_entry"
        async with self.odoo_pool.acquire() as conn:
            rows = await conn.fetch(query)

        upsert = """
            INSERT INTO trip_timeline_entries (id, timeline_id, version_number, name, change_time, changed_by, change_type, snapshot_json, create_uid, create_date, write_uid, write_date, synced_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
            ON CONFLICT (id) DO UPDATE SET
                timeline_id = EXCLUDED.timeline_id,
                version_number = EXCLUDED.version_number,
                name = EXCLUDED.name,
                change_time = EXCLUDED.change_time,
                changed_by = EXCLUDED.changed_by,
                change_type = EXCLUDED.change_type,
                snapshot_json = EXCLUDED.snapshot_json,
                write_uid = EXCLUDED.write_uid,
                write_date = EXCLUDED.write_date,
                synced_at = NOW()
        """
        async with self.local_pool.acquire() as conn:
            await conn.executemany(upsert, [
                (r['id'], r['timeline_id'], r['version_number'], r['name'],
                 r['change_time'], r['changed_by'], r['change_type'], r['snapshot_json'],
                 r['create_uid'], r['create_date'], r['write_uid'], r['write_date']) for r in rows
            ])
        print(f"✓ Synced {len(rows)} trip timeline entries")

    async def sync_revenue_lines(self):
        query = "SELECT * FROM trip_revenue_line"
        async with self.odoo_pool.acquire() as conn:
            rows = await conn.fetch(query)

        upsert = """
            INSERT INTO trip_revenue_lines (id, trip_id, revenue_type_id, description, amount, quantity, total_revenue, create_uid, create_date, write_uid, write_date, synced_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
            ON CONFLICT (id) DO UPDATE SET
                trip_id = EXCLUDED.trip_id,
                revenue_type_id = EXCLUDED.revenue_type_id,
                description = EXCLUDED.description,
                amount = EXCLUDED.amount,
                quantity = EXCLUDED.quantity,
                total_revenue = EXCLUDED.total_revenue,
                write_uid = EXCLUDED.write_uid,
                write_date = EXCLUDED.write_date,
                synced_at = NOW()
        """
        async with self.local_pool.acquire() as conn:
            await conn.executemany(upsert, [
                (r['id'], r['trip_id'], r['revenue_type_id'], r['description'],
                 r['amount'], r['quantity'], r['total_revenue'],
                 r['create_uid'], r['create_date'], r['write_uid'], r['write_date']) for r in rows
            ])
        print(f"✓ Synced {len(rows)} revenue lines")

    async def sync_expense_lines(self):
        query = "SELECT * FROM trip_expense_line"
        async with self.odoo_pool.acquire() as conn:
            rows = await conn.fetch(query)

        upsert = """
            INSERT INTO trip_expense_lines (id, trip_id, expense_type_id, description, amount, quantity, total_expense, create_uid, create_date, write_uid, write_date, synced_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
            ON CONFLICT (id) DO UPDATE SET
                trip_id = EXCLUDED.trip_id,
                expense_type_id = EXCLUDED.expense_type_id,
                description = EXCLUDED.description,
                amount = EXCLUDED.amount,
                quantity = EXCLUDED.quantity,
                total_expense = EXCLUDED.total_expense,
                write_uid = EXCLUDED.write_uid,
                write_date = EXCLUDED.write_date,
                synced_at = NOW()
        """
        async with self.local_pool.acquire() as conn:
            await conn.executemany(upsert, [
                (r['id'], r['trip_id'], r['expense_type_id'], r['description'],
                 r['amount'], r['quantity'], r['total_expense'],
                 r['create_uid'], r['create_date'], r['write_uid'], r['write_date']) for r in rows
            ])
        print(f"✓ Synced {len(rows)} expense lines")

    async def sync_payment_requests(self):
        """Sync only fleet-related payment requests (with trip_id and is_trip_payment=true)"""
        query = """
            SELECT * FROM payment_request 
            WHERE trip_id IS NOT NULL AND COALESCE(is_trip_payment, false) = true
        """
        async with self.odoo_pool.acquire() as conn:
            rows = await conn.fetch(query)

        upsert = """
            INSERT INTO payment_requests (id, trip_id, name, ref, state, amount_birr, employee_id, branch_2, source_doc,
                                          is_trip_payment, selection_field, current_user_id, requester_id, prepared_by,
                                          approve_uid, approve_date, start_datetime, date, description, partner_id,
                                          journal, bank, source, purchaser, payment_document, skip_legacy_line_autofill,
                                          create_uid, create_date, write_uid, write_date, synced_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                    $21, $22, $23, $24, $25, $26, $27, $28, $29, NOW())
            ON CONFLICT (id) DO UPDATE SET
                trip_id = EXCLUDED.trip_id,
                name = EXCLUDED.name,
                ref = EXCLUDED.ref,
                state = EXCLUDED.state,
                amount_birr = EXCLUDED.amount_birr,
                employee_id = EXCLUDED.employee_id,
                branch_2 = EXCLUDED.branch_2,
                source_doc = EXCLUDED.source_doc,
                is_trip_payment = EXCLUDED.is_trip_payment,
                selection_field = EXCLUDED.selection_field,
                current_user_id = EXCLUDED.current_user_id,
                requester_id = EXCLUDED.requester_id,
                prepared_by = EXCLUDED.prepared_by,
                approve_uid = EXCLUDED.approve_uid,
                approve_date = EXCLUDED.approve_date,
                start_datetime = EXCLUDED.start_datetime,
                date = EXCLUDED.date,
                description = EXCLUDED.description,
                partner_id = EXCLUDED.partner_id,
                journal = EXCLUDED.journal,
                bank = EXCLUDED.bank,
                source = EXCLUDED.source,
                purchaser = EXCLUDED.purchaser,
                payment_document = EXCLUDED.payment_document,
                skip_legacy_line_autofill = EXCLUDED.skip_legacy_line_autofill,
                write_uid = EXCLUDED.write_uid,
                write_date = EXCLUDED.write_date,
                synced_at = NOW()
        """
        async with self.local_pool.acquire() as conn:
            await conn.executemany(upsert, [
                (r['id'], r['trip_id'], r['name'], r['ref'], r['state'], r['amount_birr'],
                 r['employee_id'], r['branch_2'], r['source_doc'], r['is_trip_payment'],
                 r['selection_field'], r['current_user'], r['requester_id'], r['prepared_by'],
                 r['approve_uid'], r['approve_date'], r['start_datetime'], r['date'],
                 r['description'], r['partner_id'], r['journal'], r['bank'], r['source'],
                 r['purchaser'], r['payment_document'], r['skip_legacy_line_autofill'],
                 r['create_uid'], r['create_date'], r['write_uid'], r['write_date']) for r in rows
            ])
        print(f"✓ Synced {len(rows)} fleet payment requests")

    async def sync_payment_request_lines(self):
        """Sync lines for fleet payment requests only"""
        query = """
            SELECT prl.* FROM payment_request_line prl
            JOIN payment_request pr ON pr.id = prl.payment_request_id
            WHERE pr.trip_id IS NOT NULL AND COALESCE(pr.is_trip_payment, false) = true
        """
        async with self.odoo_pool.acquire() as conn:
            rows = await conn.fetch(query)

        upsert = """
            INSERT INTO payment_request_lines (id, payment_request_id, item, description, amount, quantity, total, synced_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (id) DO UPDATE SET
                payment_request_id = EXCLUDED.payment_request_id,
                item = EXCLUDED.item,
                description = EXCLUDED.description,
                amount = EXCLUDED.amount,
                quantity = EXCLUDED.quantity,
                total = EXCLUDED.total,
                synced_at = NOW()
        """
        async with self.local_pool.acquire() as conn:
            await conn.executemany(upsert, [
                (r['id'], r['payment_request_id'], r['item'], r['description'],
                 r['amount'], r['quantity'], r['total']) for r in rows
            ])
        print(f"✓ Synced {len(rows)} payment request lines")

    async def sync_receivables(self):
        query = "SELECT * FROM trip_receivable"
        async with self.odoo_pool.acquire() as conn:
            rows = await conn.fetch(query)

        upsert = """
            INSERT INTO trip_receivables (id, trip_id, name, amount_due, state, payment_reference, customer_name,
                                          date_created, confirmed_by_id, confirmed_on, approved_by_id, approved_on,
                                          type, contact_id, customer_id, customer_text,
                                          create_uid, create_date, write_uid, write_date, synced_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW())
            ON CONFLICT (id) DO UPDATE SET
                trip_id = EXCLUDED.trip_id,
                name = EXCLUDED.name,
                amount_due = EXCLUDED.amount_due,
                state = EXCLUDED.state,
                payment_reference = EXCLUDED.payment_reference,
                customer_name = EXCLUDED.customer_name,
                date_created = EXCLUDED.date_created,
                confirmed_by_id = EXCLUDED.confirmed_by_id,
                confirmed_on = EXCLUDED.confirmed_on,
                approved_by_id = EXCLUDED.approved_by_id,
                approved_on = EXCLUDED.approved_on,
                type = EXCLUDED.type,
                contact_id = EXCLUDED.contact_id,
                customer_id = EXCLUDED.customer_id,
                customer_text = EXCLUDED.customer_text,
                write_uid = EXCLUDED.write_uid,
                write_date = EXCLUDED.write_date,
                synced_at = NOW()
        """
        async with self.local_pool.acquire() as conn:
            await conn.executemany(upsert, [
                (r['id'], r['trip_id'], r['name'], r['amount_due'], r['state'],
                 r['payment_reference'], r['customer_name'], r['date_created'],
                 r['confirmed_by_id'], r['confirmed_on'], r['approved_by_id'], r['approved_on'],
                 r['type'], r['contact_id'], r['customer_id'], r['customer_text'],
                 r['create_uid'], r['create_date'], r['write_uid'], r['write_date']) for r in rows
            ])
        print(f"✓ Synced {len(rows)} receivables")

    async def generate_daily_reports(self):
        """Generate daily reports from synced trip data with actual/remark columns.
        This creates/updates daily_reports for today's trips with calculated totals.
        The revenue_actual, expense_actual, remark, remark_category are left for manual entry."""
        query = """
            SELECT 
                t.id as trip_id,
                t.name,
                t.vehicle_id,
                t.driver_id,
                t.departure_date,
                t.arrival_date,
                t.departure_id,
                t.destination_id,
                v.license_plate,
                d.name as driver_name,
                dep.name as departure_name,
                des.name as destination_name,
                COALESCE(SUM(trl.total_revenue), 0) as revenue_total,
                COALESCE(SUM(tel.total_expense), 0) as expense_total,
                COALESCE(SUM(pr.amount_birr), 0) as payment_request_total
            FROM trip_trip t
            LEFT JOIN fleet_vehicles v ON v.id = t.vehicle_id
            LEFT JOIN hr_employee d ON d.id = t.driver_id
            LEFT JOIN trip_location dep ON dep.id = t.departure_id
            LEFT JOIN trip_location des ON des.id = t.destination_id
            LEFT JOIN trip_revenue_line trl ON trl.trip_id = t.id
            LEFT JOIN trip_expense_line tel ON tel.trip_id = t.id
            LEFT JOIN payment_request pr ON pr.trip_id = t.id AND COALESCE(pr.is_trip_payment, false) = true
            WHERE t.departure_date = CURRENT_DATE
            GROUP BY t.id, t.name, t.vehicle_id, t.driver_id, t.departure_date, t.arrival_date,
                     t.departure_id, t.destination_id, v.license_plate, d.name, dep.name, des.name
        """
        async with self.odoo_pool.acquire() as conn:
            rows = await conn.fetch(query)

        upsert = """
            INSERT INTO daily_reports (report_date, vehicle_id, trip_id, driver_id, driver_name, vehicle_plate,
                                       route, departure_name, destination_name, departure_date, arrival_date,
                                       revenue_total, expense_total, profit_reported, status, synced_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'draft', NOW(), NOW())
            ON CONFLICT (report_date, vehicle_id) DO UPDATE SET
                trip_id = EXCLUDED.trip_id,
                driver_id = EXCLUDED.driver_id,
                driver_name = EXCLUDED.driver_name,
                vehicle_plate = EXCLUDED.vehicle_plate,
                route = EXCLUDED.route,
                departure_name = EXCLUDED.departure_name,
                destination_name = EXCLUDED.destination_name,
                departure_date = EXCLUDED.departure_date,
                arrival_date = EXCLUDED.arrival_date,
                revenue_total = EXCLUDED.revenue_total,
                expense_total = EXCLUDED.expense_total,
                profit_reported = EXCLUDED.profit_reported,
                updated_at = NOW(),
                synced_at = NOW()
            -- Note: revenue_actual, expense_actual, remark, remark_category are PRESERVED (not overwritten)
        """
        today = date.today()
        async with self.local_pool.acquire() as conn:
            for r in rows:
                route = f"{r['departure_name'] or ''} → {r['destination_name'] or ''}".strip()
                profit = float(r['revenue_total'] or 0) - float(r['expense_total'] or 0)
                await conn.execute(upsert, today, r['vehicle_id'], r['trip_id'], r['driver_id'],
                                   r['driver_name'], r['license_plate'], route,
                                   r['departure_name'], r['destination_name'],
                                   r['departure_date'], r['arrival_date'],
                                   r['revenue_total'], r['expense_total'], profit)
        print(f"✓ Generated/updated {len(rows)} daily reports for {today}")

    async def run_full_sync(self):
        """Run complete sync in dependency order"""
        print(f"\n=== Starting full sync at {datetime.now()} ===\n")
        
        await self.sync_fleet_vehicles()
        await self.sync_trips()
        await self.sync_trip_timeline()
        await self.sync_trip_timeline_entries()
        await self.sync_revenue_lines()
        await self.sync_expense_lines()
        await self.sync_payment_requests()
        await self.sync_payment_request_lines()
        await self.sync_receivables()
        await self.generate_daily_reports()
        
        print(f"\n=== Full sync completed at {datetime.now()} ===\n")


async def main():
    syncer = FleetDataSyncer()
    try:
        await syncer.connect()
        await syncer.run_full_sync()
    except Exception as e:
        print(f"✗ Sync failed: {e}")
        raise
    finally:
        await syncer.close()


if __name__ == "__main__":
    asyncio.run(main())