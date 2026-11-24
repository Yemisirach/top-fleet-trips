"""Sync scheduling checks without a live Odoo or Redis connection."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.services import fleet_store


class FleetStoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_refresh_is_bounded_and_reports_partial_failure(self):
        active = 0
        peak = 0
        seen = []

        async def refresh(name, key, call):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            seen.append(name)
            await asyncio.sleep(0.001)
            active -= 1
            return name != "payments"

        with patch.object(fleet_store, "_lock", asyncio.Lock()), \
             patch.object(fleet_store, "_refresh", refresh), \
             patch.object(fleet_store, "cache_mark_synced", return_value={"live": True}) as mark:
            status = await fleet_store.sync_fleet_store("background")
        self.assertEqual(peak, 3)
        self.assertEqual(len(seen), 14)
        self.assertEqual(status["stored_count"], 13)
        self.assertEqual(status["failed_count"], 1)
        self.assertEqual(mark.call_args.args[2], ["payments"])

    async def test_total_failure_preserves_last_success_time(self):
        with patch.object(fleet_store, "_lock", asyncio.Lock()), \
             patch.object(fleet_store, "_refresh", AsyncMock(return_value=False)), \
             patch.object(fleet_store, "cache_sync_status", return_value={"synced_at": "previous"}), \
             patch.object(fleet_store, "cache_mark_synced") as mark:
            status = await fleet_store.sync_fleet_store("manual")
        self.assertFalse(status["live"])
        self.assertEqual(status["synced_at"], "previous")
        self.assertEqual(status["failed_count"], 14)
        mark.assert_not_called()

    async def test_background_does_not_overlap_an_active_sync(self):
        lock = asyncio.Lock()
        await lock.acquire()
        with patch.object(fleet_store, "_lock", lock), \
             patch.object(fleet_store, "cache_sync_status", return_value={}), \
             patch.object(fleet_store, "_refresh", AsyncMock()) as refresh:
            status = await fleet_store.sync_fleet_store("background")
        self.assertTrue(status["skipped"])
        refresh.assert_not_called()


if __name__ == "__main__":
    unittest.main()
