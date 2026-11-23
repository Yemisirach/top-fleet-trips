"use client";
import { useState, useCallback, useEffect } from "react";
import { fetchCachedJson, readCachedJson, API_BASE, DASHBOARD_CACHE_KEY } from "@/lib/api";
import { scopeDashboard, storedFleetUser, type FleetUser } from "@/lib/scope";
import type { DashboardSnapshot, DashboardMode } from "@/types/dashboard";
import type { Trip } from "@/types/trip";

export function useDashboard() {
  const [user, setUser] = useState<FleetUser | null>(null);
  const [data, setData] = useState<DashboardSnapshot>({});
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<DashboardMode>("live");

  useEffect(() => {
    const savedUser = storedFleetUser();
    const cached = readCachedJson<DashboardSnapshot>(DASHBOARD_CACHE_KEY);
    if (savedUser) setUser(savedUser);
    if (cached) setData(scopeDashboard(cached, savedUser));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/auth/me`, { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled) return;
        const next = payload?.user || storedFleetUser();
        setUser(next);
        setData((current) => scopeDashboard(current, next));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async (m?: DashboardMode, force = false) => {
    const activeMode = m || mode;
    const cacheKey = activeMode === "live" ? DASHBOARD_CACHE_KEY : `dashboard:${activeMode}:${DASHBOARD_CACHE_KEY}`;
    const cached = readCachedJson<DashboardSnapshot>(cacheKey);
    if (cached) {
      setData((current) => (current.recent_journeys || current.payment_summary ? current : scopeDashboard(cached, user)));
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const snap = await fetchCachedJson<DashboardSnapshot>(
        `${API_BASE}/dashboard/full?mode=${activeMode}`,
        undefined,
        { ttlMs: 6 * 60 * 60 * 1000, cacheKey, forceRefresh: force }
      );
      setData(scopeDashboard(snap, user));
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
      if (!cached) {
        setData({
          recent_journeys: [],
          _warning: err instanceof Error ? err.message : "Live Odoo data unavailable",
        });
      }
    }
    setLoading(false);
  }, [mode, user]);

  const changeMode = useCallback((m: DashboardMode) => {
    setMode(m);
    load(m);
  }, [load]);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ cacheKey?: string; data?: DashboardSnapshot }>).detail;
      if (detail?.cacheKey === DASHBOARD_CACHE_KEY && detail.data) setData(scopeDashboard(detail.data, user));
    };
    window.addEventListener("fleet-cache-updated", onUpdate);
    return () => window.removeEventListener("fleet-cache-updated", onUpdate);
  }, [user]);

  const allTrips: Trip[] = data.recent_journeys ?? [];

  return { data, allTrips, loading, mode, load, changeMode };
}
