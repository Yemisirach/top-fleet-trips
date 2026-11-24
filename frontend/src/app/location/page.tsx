"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Map, Menu, Moon, Phone, Sun } from "lucide-react";
import Sidebar, { WindowLogout } from "@/components/layout/Sidebar";
import LastSyncLabel, { SyncButton } from "@/components/layout/LastSync";
import { useFleetUser } from "@/hooks/useFleetUser";
import { useTheme } from "@/hooks/useTheme";
import { API_BASE, DASHBOARD_CACHE_KEY, fetchCachedJson, readCachedJson } from "@/lib/api";
import { driverPhone, scopeDashboard } from "@/lib/scope";
import { stateLabel } from "@/lib/formatters";
import type { DashboardSnapshot } from "@/types/dashboard";

export default function CurrentLocationPage() {
  const { theme, toggle } = useTheme();
  const user = useFleetUser();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [data, setData] = useState<DashboardSnapshot>({});

  useEffect(() => {
    const cached = readCachedJson<DashboardSnapshot>(DASHBOARD_CACHE_KEY);
    if (cached) setData(scopeDashboard(cached, user));
    fetchCachedJson<DashboardSnapshot>(`${API_BASE}/dashboard/full?mode=live`, undefined, {
      ttlMs: 60_000,
      cacheKey: DASHBOARD_CACHE_KEY,
    })
      .then((snapshot) => setData(scopeDashboard(snapshot, user)))
      .catch(() => setData(scopeDashboard(cached || {}, user)));
  }, [user]);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ cacheKey?: string; data?: DashboardSnapshot }>).detail;
      if (detail?.cacheKey === DASHBOARD_CACHE_KEY && detail.data) setData(scopeDashboard(detail.data, user));
    };
    window.addEventListener("fleet-cache-updated", onUpdate);
    return () => window.removeEventListener("fleet-cache-updated", onUpdate);
  }, [user]);

  const rows = useMemo(
    () => [...(data.vehicle_locations || [])].sort((a, b) => String(a.current_location_name || "").localeCompare(String(b.current_location_name || ""))),
    [data.vehicle_locations],
  );

  return (
    <div className="app-shell">
      <div className={`overlay${mobileOpen ? " open" : ""}`} onClick={() => setMobileOpen(false)} />
      <Sidebar currentView="locations" onViewChange={() => setMobileOpen(false)} mobileOpen={mobileOpen} />
      <div className="app-main" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", background: "var(--panel)", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <button className="btn md-hidden" onClick={() => setMobileOpen(true)} title="Open menu"><Menu size={18} /></button>
          <div style={{ flex: "1 1 220px" }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Current location</h1>
            <div className="muted" style={{ fontSize: 13 }}>{user?.role === "supervisor" ? "Assigned vehicles only" : "All vehicles"}</div>
          </div>
          <LastSyncLabel />
          <SyncButton />
          <Link className="btn" href="/map"><Map size={16} /> Map</Link>
          {user?.role !== "supervisor" && <Link className="btn primary" href="/map?full=1">Full map</Link>}
          <button className="btn" onClick={toggle}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
          <WindowLogout />
        </div>
        <div className="fleet-page" style={{ overflowX: "auto" }}>
          <table className="fleet-table">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Driver</th>
                <th>Location</th>
                <th>Note</th>
                <th>Days</th>
                <th>Status</th>
                <th>Call</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const phone = driverPhone(row);
                return (
                  <tr key={`${row.vehicle_id}-${row.trip_id}`}>
                    <td><Link href={`/map?vehicle=${encodeURIComponent(row.vehicle_plate || "")}`}>{row.vehicle_plate || "Vehicle"}</Link></td>
                    <td>{row.driver_name || "Unassigned"}</td>
                    <td>{row.current_location_name || "Pending"}</td>
                    <td>{row.current_location_note || "—"}</td>
                    <td>{row.current_location_days ?? "—"}</td>
                    <td>{stateLabel(row.state)}</td>
                    <td>
                      {phone ? <a className="btn" href={`tel:${phone}`}><Phone size={14} /> Call driver</a> : <span className="muted">No phone</span>}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="empty">No current locations in the saved copy.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
