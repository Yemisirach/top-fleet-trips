"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Map, MapPin, Menu, Moon, Phone, Sun, Truck } from "lucide-react";
import Sidebar, { WindowLogout } from "@/components/layout/Sidebar";
import LastSyncLabel, { SyncButton } from "@/components/layout/LastSync";
import { useFleetUser } from "@/hooks/useFleetUser";
import { useTheme } from "@/hooks/useTheme";
import { API_BASE, DASHBOARD_CACHE_KEY, fetchCachedJson, readCachedJson } from "@/lib/api";
import { driverPhone, isSupervisor, trackerKey, scopeDashboard } from "@/lib/scope";
import { buildJourneyRoute, getOrderCount, stateLabel } from "@/lib/formatters";
import type { DashboardSnapshot } from "@/types/dashboard";
import type { MayetVehicle } from "@/types/trip";

interface GpsPlace {
  plate?: string;
  latitude?: number | string;
  longitude?: number | string;
  short_name?: string;
  full_name?: string;
}

export default function SupervisorPage() {
  const { theme, toggle } = useTheme();
  const user = useFleetUser();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [journeyView, setJourneyView] = useState(false);
  const [data, setData] = useState<DashboardSnapshot>({});
  const [places, setPlaces] = useState<GpsPlace[]>([]);
  const [gpsVehicles, setGpsVehicles] = useState<MayetVehicle[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setJourneyView(params.get("view") === "journeys");
  }, []);

  useEffect(() => {
    const cached = readCachedJson<DashboardSnapshot>(DASHBOARD_CACHE_KEY);
    if (cached) setData(scopeDashboard(cached, user));
    fetchCachedJson<DashboardSnapshot>(`${API_BASE}/dashboard/full?mode=live`, undefined, {
      ttlMs: 60_000,
      cacheKey: DASHBOARD_CACHE_KEY,
    })
      .then((snapshot) => setData(scopeDashboard(snapshot, user)))
      .catch(() => setData(scopeDashboard(cached || {}, user)));
    const savedPlaces = readCachedJson<{ places?: GpsPlace[] }>("dashboard:gps-places");
    if (savedPlaces?.places) setPlaces(savedPlaces.places);
    fetchCachedJson<{ places?: GpsPlace[] }>(`${API_BASE}/dashboard/gps-places`, undefined, {
      ttlMs: 60_000,
      cacheKey: "dashboard:gps-places:tracker",
    })
      .then((payload) => setPlaces(payload.places || []))
      .catch(() => undefined);
    const savedGps = readCachedJson<{ vehicles?: MayetVehicle[] }>("dashboard:mayet:vehicles");
    if (savedGps?.vehicles) setGpsVehicles(savedGps.vehicles);
    fetchCachedJson<{ vehicles?: MayetVehicle[] }>(`${API_BASE}/dashboard/mayet/vehicles`, undefined, {
      ttlMs: 60_000,
      cacheKey: "dashboard:mayet:vehicles:tracker",
    })
      .then((payload) => setGpsVehicles(payload.vehicles || []))
      .catch(() => undefined);
    const onLocal = (event: Event) => {
      const detail = (event as CustomEvent<{ cacheKey?: string; data?: DashboardSnapshot }>).detail;
      if (event.type === "fleet-local-ready" || detail?.cacheKey === DASHBOARD_CACHE_KEY) {
        const saved = detail?.data || readCachedJson<DashboardSnapshot>(DASHBOARD_CACHE_KEY);
        if (saved) setData(scopeDashboard(saved, user));
      }
    };
    window.addEventListener("fleet-local-ready", onLocal);
    window.addEventListener("fleet-cache-updated", onLocal);
    return () => {
      window.removeEventListener("fleet-local-ready", onLocal);
      window.removeEventListener("fleet-cache-updated", onLocal);
    };
  }, [user]);

  const gpsLabel = (plate?: string) => {
    const key = trackerKey(plate);
    if (!key) return "No GPS";
    const place = places.find((item) => trackerKey(item.plate) === key);
    const named = place?.full_name || place?.short_name;
    if (named) return named;
    const vehicle = gpsVehicles.find((item) => trackerKey(item.plate) === key);
    const tracker = String(vehicle?.address || vehicle?.location || "").trim();
    const statusWord = /^(offline|online|ack|engine|idle|moving|stopped)$/i.test(tracker);
    const coordinate = /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(tracker);
    if (tracker && !statusWord && !coordinate) return tracker;
    const latitude = place?.latitude || vehicle?.latitude || vehicle?.lat;
    const longitude = place?.longitude || vehicle?.longitude || vehicle?.lng;
    if (latitude && longitude) return `${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`;
    return "No GPS";
  };

  const locations = data.vehicle_locations || [];
  const journeys = data.recent_journeys || [];
  const name = user?.name || data.supervisor_name || "Supervisor";
  const rows = useMemo(
    () => [...locations].sort((a, b) => String(a.vehicle_plate || "").localeCompare(String(b.vehicle_plate || ""))),
    [locations],
  );

  return (
    <div className="app-shell">
      <div className={`overlay${mobileOpen ? " open" : ""}`} onClick={() => setMobileOpen(false)} />
      <Sidebar currentView={journeyView ? "trips" : "overview"} onViewChange={() => setMobileOpen(false)} mobileOpen={mobileOpen} />
      <div className="app-main" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", background: "var(--panel)", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <button className="btn md-hidden" onClick={() => setMobileOpen(true)} title="Open menu"><Menu size={18} /></button>
          <div style={{ flex: "1 1 220px" }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{journeyView ? "Journeys" : name}</h1>
            <div className="muted" style={{ fontSize: 13 }}>{journeyView ? "Assigned vehicle journeys" : "Assigned vehicles only"}</div>
          </div>
          <LastSyncLabel />
          <SyncButton />
          <button className="btn" onClick={toggle}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
          <WindowLogout />
        </div>
        <div className="fleet-page" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn" href="/location"><MapPin size={16} /> Current location</Link>
            <Link className="btn primary" href="/map"><Map size={16} /> Map</Link>
            <Link className="btn" href="/supervisor?view=journeys"><Truck size={16} /> Journeys</Link>
          </div>
          <div className="muted">{rows.length} assigned vehicles · {journeys.length} journeys</div>
          {!isSupervisor(user) && user && <p className="muted">This page is the supervisor home. Managers still use Overview.</p>}
          {!journeyView && <div style={{ overflowX: "auto" }}>
            <table className="fleet-table">
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Driver</th>
                  <th>Current location</th>
                  <th>GPS location</th>
                  <th>Status</th>
                  <th>Call</th>
                  <th>Map</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const phone = driverPhone(row);
                  const plate = row.vehicle_plate || "Vehicle";
                  return (
                    <tr key={`${row.vehicle_id}-${row.trip_id}`}>
                      <td><strong>{plate}</strong></td>
                      <td>{row.driver_name || "Unassigned"}</td>
                      <td>{row.current_location_name || row.current_location_note || "Pending"}</td>
                      <td>{gpsLabel(plate)}</td>
                      <td>{stateLabel(row.state)}</td>
                      <td>
                        {phone ? (
                          <a className="btn" href={`tel:${phone}`}><Phone size={14} /> Call driver</a>
                        ) : (
                          <span className="muted">No phone</span>
                        )}
                      </td>
                      <td><Link className="btn" href={`/map?vehicle=${encodeURIComponent(plate)}`}>Open</Link></td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="empty">No assigned vehicles in the saved copy yet. Use Sync after the database answers.</td></tr>
                )}
              </tbody>
            </table>
          </div>}
          {journeyView && <section>
            <h2 style={{ fontSize: 16, margin: "8px 0" }}>Assigned journeys</h2>
            <div className="muted" style={{ marginBottom: 8 }}>Same journey grouping as the main app: a journey starts at a TOP depot and ends when the vehicle returns. Trips inside that journey are counted, not listed as separate journeys.</div>
            <div style={{ overflowX: "auto" }}>
              <table className="fleet-table">
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Date</th>
                    <th>Driver</th>
                    <th>Journey</th>
                    <th>Current location</th>
                    <th>GPS location</th>
                    <th>Trips</th>
                    <th>State</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {journeys.map((trip) => {
                    const plate = trip.vehicle_plate || "";
                    const href = `/map?journey_id=${encodeURIComponent(String(trip.id))}&vehicle=${encodeURIComponent(plate)}`;
                    const when = trip.departure_date || trip.create_date || "";
                    return (
                      <tr key={trip.id}>
                        <td><Link href={href}><strong>{plate || "—"}</strong></Link></td>
                        <td>{when ? String(when).slice(0, 16).replace("T", " ") : "—"}</td>
                        <td>{trip.driver_name || "Unassigned"}</td>
                        <td>{buildJourneyRoute(trip)}</td>
                        <td>{trip.current_location || trip.current_location_note || "Pending"}</td>
                        <td>{gpsLabel(plate)}</td>
                        <td>{getOrderCount(trip)}</td>
                        <td>{stateLabel(trip.status || trip.state)}</td>
                        <td><Link className="btn" href={href}>Open</Link></td>
                      </tr>
                    );
                  })}
                  {journeys.length === 0 && (
                    <tr><td colSpan={9} className="empty">No journeys for the assigned vehicles.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>}
        </div>
      </div>
    </div>
  );
}
