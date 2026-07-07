"use client";
import { useState, useCallback } from "react";
import { fetchJson, API_BASE } from "@/lib/api";
import { generateDemoTrips } from "@/lib/demo";
import type { DashboardSnapshot, DashboardMode } from "@/types/dashboard";
import type { Trip } from "@/types/trip";

export function useDashboard() {
  const [data, setData] = useState<DashboardSnapshot>({});
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<DashboardMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("fleetDashboardMode") as DashboardMode) || "live";
    }
    return "live";
  });

  const load = useCallback(async (m?: DashboardMode) => {
    setLoading(true);
    // Always use demo data (Odoo-style with payment requests + TOP Factory)
    const demoTrips = generateDemoTrips(8);
    setData({ recent_journeys: demoTrips });
    setLoading(false);
  }, []);

  const changeMode = useCallback((m: DashboardMode) => {
    localStorage.setItem("fleetDashboardMode", m);
    setMode(m);
    load(m);
  }, [load]);

  const allTrips: Trip[] = data.recent_journeys ?? [];

  return { data, allTrips, loading, mode, load, changeMode };
}
