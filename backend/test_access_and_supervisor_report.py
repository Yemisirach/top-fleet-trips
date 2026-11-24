import asyncio
from datetime import date
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from app.main import app, _supervisor_blocked, _assigned_detail
from app.routers.supervisor import assemble_report, daily_report
from app.core import auth

SUPERVISOR = {"username": "alice", "name": "Alice", "role": "supervisor"}


class AccessTests(TestCase):
    def test_supervisor_policy_blocks_unscoped_and_financial_routes(self):
        for route in ["/api/trips", "/api/vehicles", "/api/journeys", "/api/dashboard/snapshot",
                      "/api/dashboard/vehicles", "/api/reports/payment-requests", "/api/reports/finance-cards",
                      "/api/vehicles/supervisors", "/api/integrations/odoo/schema"]:
            self.assertTrue(_supervisor_blocked(route), route)
        for route in ["/api/supervisor/daily-report", "/api/dashboard/full", "/api/dashboard/vehicle-history/123"]:
            self.assertFalse(_supervisor_blocked(route), route)

    def test_http_denies_supervisor_direct_access(self):
        with patch("app.main.user_from_request", return_value=SUPERVISOR):
            client = TestClient(app)
            for route in ["/api/trips", "/api/vehicles", "/api/reports/payment-requests", "/api/dashboard/snapshot"]:
                self.assertEqual(client.get(route).status_code, 403)
            self.assertEqual(client.post("/api/vehicles/supervisors", json=[]).status_code, 403)

    def test_detail_ids_are_checked_against_assigned_data(self):
        snapshot = {"recent_journeys": [{"id": 1, "supervisor_name": "Alice"}, {"id": 2, "supervisor_name": "Bob"}]}
        with patch("app.core.scope._dashboard_cache", return_value=snapshot):
            self.assertTrue(_assigned_detail("/api/journeys/1", SUPERVISOR, "GET"))
            self.assertFalse(_assigned_detail("/api/journeys/2/timeline", SUPERVISOR, "GET"))
            self.assertFalse(_assigned_detail("/api/journeys/1", SUPERVISOR, "POST"))

    def test_report_totals_only_include_assigned_rows_and_do_not_double_count_costs(self):
        rows = [
            {"id": 1, "vehicle_id": 10, "supervisor_name": "Alice", "total_revenue": 300, "payment_request_lines": [{"total": 99}]},
            {"id": 2, "vehicle_id": 20, "supervisor_name": "Bob", "total_revenue": 9000},
            {"id": 3, "vehicle_id": 10, "supervisor_name": "Alice", "total_revenue": 100, "payment_request_lines": [{"item": "Fuel", "total": 25}]},
        ]
        report = assemble_report(rows, {1: [{"item": "Fuel", "total": 50}]}, date(2026, 11, 24), SUPERVISOR)
        self.assertEqual(report["cost"], 75)
        self.assertEqual(report["revenue"], 400)
        self.assertEqual(len(report["vehicles"]), 1)
        self.assertEqual(report["vehicles"][0]["trips"][0]["cost_items"][0]["total"], 50)

    def test_dashboard_drops_unscoped_company_aggregates(self):
        from app.core.scope import scope_dashboard
        data = {"summary": {"total_drivers": 99}, "payment_summary": {"company_revenue": 12345},
                "vehicles_by_brand": [{"count": 99}], "future_private_field": "secret"}
        scoped = scope_dashboard(data, SUPERVISOR)
        self.assertNotIn("payment_summary", scoped)
        self.assertNotIn("vehicles_by_brand", scoped)
        self.assertNotIn("future_private_field", scoped)
        self.assertEqual(scoped["summary"]["total_drivers"], 0)


class ReportFailureTests(IsolatedAsyncioTestCase):
    async def test_db_failure_without_saved_data_is_unavailable_not_zero(self):
        from fastapi import HTTPException
        with patch("app.routers.supervisor.fetch_trip_rows", AsyncMock(side_effect=RuntimeError("offline"))), \
             patch("app.routers.supervisor.cache_get_stale", return_value=None):
            with self.assertRaises(HTTPException) as error:
                await daily_report(date(2026, 11, 24), True, None, SUPERVISOR)
        self.assertEqual(error.exception.status_code, 503)

    async def test_saved_report_keeps_original_sync_timestamp(self):
        saved = {"synced_at": "previous", "cost": 123, "vehicles": []}
        with patch("app.routers.supervisor.fetch_trip_rows", AsyncMock(side_effect=RuntimeError("offline"))), \
             patch("app.routers.supervisor.cache_get_stale", return_value=saved):
            report = await daily_report(date(2026, 11, 24), True, None, SUPERVISOR)
        self.assertEqual(report["synced_at"], "previous")
        self.assertEqual(report["cost"], 123)
        self.assertTrue(report["saved"])

    async def test_shared_fallback_password_is_not_accepted(self):
        with patch.object(auth, "USERS", {"alice": {**SUPERVISOR, "password": "$2b$invalid"}}), \
             patch.object(auth, "_verify_password", return_value=False), \
             patch.object(auth, "_authenticate_odoo_xmlrpc", return_value=None):
            self.assertIsNone(await auth.authenticate("alice", "123"))
