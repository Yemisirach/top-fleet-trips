import os
import tempfile
import unittest
from unittest.mock import patch
from app.services.daily_custom_store import save_custom_entry, get_custom_entries
from app.routers.reports import _apply_actual, _apply_year_edits
from app.routers.reports import save_daily_profit_custom_data, DailyProfitCustomPayload


class CustomReportTests(unittest.TestCase):
    def test_trip_isolation_and_persistence(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, FLEET_DATA_DIR=folder):
            save_custom_entry('2026-11-26', 'ABC:101', actual='500', remark='Only 101', plate_number='ABC', trip_id='101')
            entries = get_custom_entries('2026-11-26')
            self.assertNotIn('plate:ABC', entries)
            self.assertNotIn('trip:202', entries)
            self.assertEqual(entries['trip:101']['actual'], '500')
            self.assertEqual(get_custom_entries('2026-11-25'), {})

    def test_actual_and_clear_preserve_odoo_amount(self):
        row = {'actual_daily_total_revenue': 100, 'rent_amount': 100, 'daily_total_cost': 30, 'actual': '0'}
        _apply_actual(row)
        self.assertEqual(row['actual_daily_total_revenue'], 0)
        self.assertEqual(row['actual_net_profit'], -30)
        row['actual'] = ''
        _apply_actual(row)
        self.assertEqual(row['actual_daily_total_revenue'], 100)

    def test_year_totals_use_exact_trip_and_date_edits(self):
        payload = {'rows': [
            {'trip_id': 101, 'trip_day': '2026-11-26', 'revenue_total': 100, 'cost_total': 20},
            {'trip_id': 202, 'trip_day': '2026-11-26', 'revenue_total': 200, 'cost_total': 30}]}
        with patch('app.routers.reports.get_custom_entries', return_value={'trip:101': {'actual': '500', 'remark': 'Checked'}}):
            _apply_year_edits(payload)
            self.assertEqual(sum(r['revenue_total'] for r in payload['rows']), 700)

            self.assertEqual(payload['rows'][0]['remark'], 'Checked')
            _apply_year_edits(payload)
            self.assertEqual(sum(r['revenue_total'] for r in payload['rows']), 700)


class SaveDateTests(unittest.IsolatedAsyncioTestCase):
    async def test_historical_save_never_updates_today_cache(self):
        with patch('app.routers.reports.save_custom_entry'), \
             patch('app.routers.reports.get_custom_entries', return_value={}), \
             patch('app.routers.reports.cache_get', return_value=None) as read, \
             patch('app.routers.reports.cache_get_stale', return_value=None), \
             patch('app.routers.reports.cache_del') as delete:
            await save_daily_profit_custom_data(DailyProfitCustomPayload(report_date='2020-01-02', row_key='ABC:101', actual='500'), {'username': 'manager'})
        self.assertEqual(read.call_args.args[0], 'fleet:reports:daily-profit:v16:2020-01-02')
        self.assertEqual(delete.call_args.args[0], 'fleet:reports:daily-profit:v16:2020-01-02')
