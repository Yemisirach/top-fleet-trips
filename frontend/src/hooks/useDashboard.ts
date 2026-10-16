"use client";
import { useState, useCallback } from "react";
import { fetchCachedJson, readCachedJson, API_BASE } from "@/lib/api";
import type { DashboardSnapshot, DashboardMode } from "@/types/dashboard";
import type { Trip } from "@/types/trip";

const DASHBOARD_CACHE_VERSION = "journey-routes-full-odoo-v6-supervised-locations";

export function useDashboard() {
  const [data, setData] = useState<DashboardSnapshot>({});
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<DashboardMode>("live");

  const load = useCallback(async (m?: DashboardMode) => {
    const activeMode = m || mode;
    const cacheKey = `dashboard:${activeMode}:${DASHBOARD_CACHE_VERSION}`;
    const cached = readCachedJson<DashboardSnapshot>(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const snap = await fetchCachedJson<DashboardSnapshot>(
        `${API_BASE}/dashboard/full?mode=${activeMode}`,
        undefined,
        { ttlMs: 300_000, cacheKey }
      );
      setData(snap);
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
      setData({
        recent_journeys: [],
        _warning: err instanceof Error ? err.message : "Live Odoo data unavailable",
      });
    }
    setLoading(false);
  }, [mode]);

  const changeMode = useCallback((m: DashboardMode) => {
    setMode(m);
    load(m);
  }, [load]);

  const allTrips: Trip[] = data.recent_journeys ?? [];

  return { data, allTrips, loading, mode, load, changeMode };
}
