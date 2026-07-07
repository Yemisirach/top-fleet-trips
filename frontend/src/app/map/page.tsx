"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  LayoutDashboard, Moon, Sun, ExternalLink, MapPin, Truck,
  User, Navigation, Search, Satellite, Clock, Gauge, Zap,
  Radio, RefreshCw, ChevronRight,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { fetchJson, API_BASE } from "@/lib/api";
import { money } from "@/lib/formatters";
import type { Trip } from "@/types/trip";
import type { GpsPayload, MayetVehicle } from "@/types/trip";
import Sidebar, { type SidebarView } from "@/components/layout/Sidebar";

interface GpsInfo {
  plate?: string;
  latitude?: number;
  longitude?: number;
  location?: string;
  address?: string;
  speed?: number;
  captured_at?: string;
  ignition?: string;
}

export default function MapPage() {
  const { theme, toggle } = useTheme();
  const params = useSearchParams();
  const tripId = params.get("journey_id") || params.get("trip_id");
  const vehicleParam = params.get("vehicle") || params.get("plate") || params.get("search");

  const [vehicleSearch, setVehicleSearch] = useState(vehicleParam || "");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [allTrips, setAllTrips] = useState<Trip[]>([]);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [journeySearch, setJourneySearch] = useState("");
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [gpsData, setGpsData] = useState<GpsInfo | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const mode = localStorage.getItem("fleetDashboardMode") || "live";
    fetchJson<{ recent_journeys?: Trip[] }>(`${API_BASE}/dashboard/full?mode=${encodeURIComponent(mode)}`)
      .then(d => {
        const journeys = d.recent_journeys || [];
        setAllTrips(journeys);

        const activeTripId = tripId || (journeys.length > 0 ? journeys[0].id : null);
        if (activeTripId) {
          const found = journeys.find((t) => String(t.id) === String(activeTripId));
          if (found) {
            setTrip(found);
            setVehicleSearch(found.vehicle_plate || found.vehicle_id || String(found.id));
          }
        }
      })
      .catch(() => {});
  }, [tripId]);

  // Close search dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Fetch GPS data when vehicle changes
  const fetchGps = useCallback((plate: string) => {
    if (!plate) return;
    setGpsLoading(true);
    fetchJson<GpsPayload>(`${API_BASE}/dashboard/gps/${encodeURIComponent(plate)}`)
      .then(d => {
        if (d.gps) {
          setGpsData(d.gps as GpsInfo);
        } else {
          setGpsData(null);
        }
      })
      .catch(() => setGpsData(null))
      .finally(() => setGpsLoading(false));
  }, []);

  useEffect(() => {
    if (vehicleSearch) fetchGps(vehicleSearch);
  }, [vehicleSearch, fetchGps]);

  const filteredTrips = journeySearch.trim()
    ? allTrips.filter((t) => {
        const q = journeySearch.toLowerCase();
        const plate = (t.vehicle_plate || "").toLowerCase();
        const plateSegments = plate.split(/[-\s]+/);
        const plateMatch = plate.includes(q) || plateSegments.some((seg) => seg.startsWith(q));
        return (
          plateMatch ||
          String(t.id).toLowerCase().includes(q) ||
          (t.driver_name || "").toLowerCase().includes(q) ||
          (t.customer_name || "").toLowerCase().includes(q) ||
          (t.origin || "").toLowerCase().includes(q) ||
          (Array.isArray(t.destinations) ? t.destinations.join(" ") : t.destination || "").toLowerCase().includes(q)
        );
      })
    : allTrips;

  const selectTrip = (t: Trip) => {
    setTrip(t);
    const plate = t.vehicle_plate || t.vehicle_id || String(t.id);
    setVehicleSearch(plate);
    setJourneySearch("");
    setSearchDropdownOpen(false);
    window.history.pushState({}, "", `/map?journey_id=${encodeURIComponent(t.id)}`);
  };

  const handleTrackOnMayet = () => {
    setLaunching(true);
    // Open the auto-login bridge in a new tab
    const url = `${API_BASE}/dashboard/mayet/open?plate=${encodeURIComponent(vehicleSearch || "")}`;
    window.open(url, "mayet_gps");
    setTimeout(() => setLaunching(false), 2000);
  };

  const destination = trip
    ? (Array.isArray(trip.destinations) && trip.destinations.length
        ? trip.destinations[0]
        : trip.destination || "Destination pending")
    : null;

  const timeAgo = (dateStr?: string) => {
    if (!dateStr) return "Unknown";
    try {
      const d = new Date(dateStr);
      const diff = Date.now() - d.getTime();
      if (diff < 60_000) return "Just now";
      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
      if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
      return `${Math.floor(diff / 86_400_000)}d ago`;
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="app-shell">
      <div className={`overlay${mobileSidebarOpen ? " open" : ""}`} onClick={() => setMobileSidebarOpen(false)}></div>
      <Sidebar
        currentView={"map" as SidebarView}
        onViewChange={(v) => {
          if (v === "reports") { window.location.href = "/reports"; }
          else if (v === "map") { window.location.href = "/map"; }
          else { window.location.href = `/?view=${v}`; }
        }}
        mobileOpen={mobileSidebarOpen}
      />
      <div className="app-main" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>

        {/* Topbar */}
        <div style={{ display: "flex", alignItems: "center", padding: "16px 24px", background: "var(--panel)", borderBottom: "1px solid var(--border)", gap: 16 }}>
          <button className="btn md-hidden" onClick={() => setMobileSidebarOpen(true)} style={{ padding: 8, marginRight: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
          </button>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Mayet GPS Tracking</h1>
            <div className="muted" style={{ fontSize: 13 }}>Live fleet tracking — auto-login and plate search</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="btn" onClick={toggle} title="Toggle theme">
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {tripId && (
              <Link href={`/detail?journey_id=${encodeURIComponent(tripId)}`} className="btn">
                Back to Detail
              </Link>
            )}
            <Link href="/" className="btn primary">
              <LayoutDashboard size={16} /> Dashboard
            </Link>
          </div>
        </div>

        {/* Main Content */}
        <div className="map-container" style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* Center: Tracking Hub */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 32 }}>
            <div style={{ maxWidth: 560, width: "100%", display: "flex", flexDirection: "column", gap: 20 }}>

              {/* Hero Card */}
              <div style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 16,
                padding: "36px 32px",
                textAlign: "center",
                boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
              }}>
                <div style={{
                  width: 68, height: 68, borderRadius: 16,
                  background: "linear-gradient(135deg, #00499e 0%, #0068d6 100%)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 20,
                  boxShadow: "0 4px 20px rgba(0, 73, 158, 0.3)",
                }}>
                  <Satellite size={32} color="#fff" />
                </div>

                <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 900 }}>
                  {vehicleSearch ? `Track ${vehicleSearch}` : "Select a Vehicle"}
                </h2>
                <p className="muted" style={{ margin: "0 0 24px", fontSize: 14, lineHeight: 1.6 }}>
                  {vehicleSearch
                    ? "Click below to open Mayet GPS — you'll be automatically logged in with the plate number pre-filled."
                    : "Choose a journey from the sidebar to begin live GPS tracking."}
                </p>

                {/* Primary CTA */}
                <button
                  onClick={handleTrackOnMayet}
                  disabled={!vehicleSearch || launching}
                  style={{
                    width: "100%",
                    minHeight: 52,
                    border: "none",
                    borderRadius: 12,
                    background: vehicleSearch
                      ? "linear-gradient(135deg, #00499e 0%, #0068d6 100%)"
                      : "var(--border)",
                    color: vehicleSearch ? "#fff" : "var(--muted)",
                    fontSize: 16,
                    fontWeight: 800,
                    cursor: vehicleSearch ? "pointer" : "default",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    transition: "transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease",
                    boxShadow: vehicleSearch ? "0 4px 14px rgba(0, 73, 158, 0.35)" : "none",
                    opacity: launching ? 0.7 : 1,
                  }}
                  onMouseEnter={(e) => { if (vehicleSearch) { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(0, 73, 158, 0.45)"; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = vehicleSearch ? "0 4px 14px rgba(0, 73, 158, 0.35)" : "none"; }}
                  id="open-mayet-btn"
                >
                  {launching ? (
                    <><Radio size={20} /> Opening Mayet GPS…</>
                  ) : (
                    <><ExternalLink size={20} /> {vehicleSearch ? "Track on Mayet GPS" : "Select a Vehicle First"}</>
                  )}
                </button>

                {/* How it works */}
                <div className="muted" style={{ marginTop: 16, fontSize: 12, lineHeight: 1.5 }}>
                  <Zap size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
                  Auto-login enabled — opens Mayet GPS in a new tab, logged in with plate pre-filled
                </div>
              </div>

              {/* GPS Live Preview */}
              {vehicleSearch && (
                <div style={{
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  overflow: "hidden",
                }}>
                  <div style={{
                    padding: "14px 20px",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: gpsData ? "#0e9849" : "#6b7280",
                        boxShadow: gpsData ? "0 0 8px rgba(14, 152, 73, 0.5)" : "none",
                      }} />
                      <span style={{ fontWeight: 800, fontSize: 14 }}>Last Known Position</span>
                    </div>
                    <button
                      className="btn"
                      onClick={() => fetchGps(vehicleSearch)}
                      style={{ padding: "4px 10px", minHeight: 28, fontSize: 12 }}
                      disabled={gpsLoading}
                    >
                      <RefreshCw size={12} className={gpsLoading ? "spin" : ""} /> Refresh
                    </button>
                  </div>

                  {gpsLoading && !gpsData ? (
                    <div className="muted" style={{ padding: "24px 20px", textAlign: "center", fontSize: 13 }}>
                      Loading GPS data…
                    </div>
                  ) : gpsData ? (
                    <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8 }}>
                        <MapPin size={14} color="#0068d6" />
                        <span style={{ fontSize: 14, fontWeight: 700 }}>
                          {gpsData.location || gpsData.address || "Position available"}
                        </span>
                      </div>
                      {gpsData.latitude != null && gpsData.longitude != null && (
                        <div style={{ gridColumn: "1 / -1" }}>
                          <span className="muted" style={{ fontSize: 12 }}>
                            {gpsData.latitude.toFixed(5)}, {gpsData.longitude.toFixed(5)}
                          </span>
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Clock size={13} color="var(--muted)" />
                        <div>
                          <div className="muted" style={{ fontSize: 11 }}>Updated</div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{timeAgo(gpsData.captured_at)}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Gauge size={13} color="var(--muted)" />
                        <div>
                          <div className="muted" style={{ fontSize: 11 }}>Speed</div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{gpsData.speed != null ? `${gpsData.speed} km/h` : "—"}</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="muted" style={{ padding: "24px 20px", textAlign: "center", fontSize: 13 }}>
                      No cached GPS data. Track on Mayet GPS for live position.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Sidebar: Journey Details */}
          <div className="map-sidebar" style={{ width: 340, background: "var(--panel)", borderLeft: "1px solid var(--border)", padding: 20, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>

            {/* Journey Selector */}
            <div className="panel" style={{ margin: 0 }}>
              <div className="panel-header" style={{ padding: "12px 16px" }}><div className="panel-title">Journey Details</div></div>
              <div className="panel-body" style={{ padding: 16 }}>

                <div style={{ marginBottom: 16, position: "relative" }} ref={searchRef}>
                  <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Switch Journey</label>
                  <div style={{ position: "relative" }}>
                    <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none" }} />
                    <input
                      className="fleet-input"
                      type="text"
                      placeholder="Search plate, driver, customer..."
                      value={journeySearch}
                      onChange={(e) => {
                        setJourneySearch(e.target.value);
                        setSearchDropdownOpen(true);
                      }}
                      onFocus={() => setSearchDropdownOpen(true)}
                      style={{ paddingLeft: 32, width: "100%" }}
                    />
                  </div>
                  {searchDropdownOpen && (
                    <div style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      zIndex: 50,
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      marginTop: 4,
                      maxHeight: 260,
                      overflowY: "auto",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                    }}>
                      {filteredTrips.length === 0 ? (
                        <div className="muted" style={{ padding: "12px 14px", fontSize: 13, textAlign: "center" }}>No journeys found</div>
                      ) : (
                        filteredTrips.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => selectTrip(t)}
                            style={{
                              width: "100%",
                              display: "block",
                              textAlign: "left",
                              padding: "10px 14px",
                              border: "none",
                              borderBottom: "1px solid var(--border)",
                              background: trip && String(trip.id) === String(t.id) ? "var(--bg)" : "transparent",
                              cursor: "pointer",
                              fontSize: 13,
                              color: "var(--fg)",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = trip && String(trip.id) === String(t.id) ? "var(--bg)" : "transparent"; }}
                          >
                            <div style={{ fontWeight: 700 }}>{t.vehicle_plate || "No Plate"}</div>
                            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                              {t.id} · {t.driver_name || "Unassigned"} · {t.customer_name || "Customer"}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {trip ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                      <span className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}><Truck size={14} /> Vehicle</span>
                      <strong>{vehicleSearch || "N/A"}</strong>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                      <span className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}><User size={14} /> Driver</span>
                      <strong>{trip.driver_name || "Unassigned"}</strong>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                      <span className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}><Navigation size={14} /> Origin</span>
                      <strong>{trip.origin || "N/A"}</strong>
                    </div>
                    {destination && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                        <span className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}><MapPin size={14} /> Destination</span>
                        <strong>{destination}</strong>
                      </div>
                    )}

                    {/* GPS Status Badge */}
                    {trip.mayet_status && (
                      <div style={{
                        background: "rgba(0, 104, 214, 0.08)",
                        border: "1px solid rgba(0, 104, 214, 0.15)",
                        borderRadius: 8,
                        padding: "10px 12px",
                        marginTop: 4,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <Satellite size={13} color="#0068d6" />
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#0068d6" }}>GPS Status</span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{trip.mayet_status}</div>
                        {trip.mayet_captured_at && (
                          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{timeAgo(trip.mayet_captured_at)}</div>
                        )}
                      </div>
                    )}

                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span className="muted">Revenue</span>
                        <strong style={{ color: "#0e9849" }}>{money(trip.total_revenue)}</strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span className="muted">Expense</span>
                        <strong style={{ color: "#dc2626" }}>{money(trip.total_expense)}</strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span className="muted">Status</span>
                        <strong>{trip.status || trip.state || "N/A"}</strong>
                      </div>
                    </div>

                    {/* Quick track button in sidebar */}
                    <button
                      onClick={handleTrackOnMayet}
                      disabled={!vehicleSearch || launching}
                      style={{
                        marginTop: 8,
                        width: "100%",
                        minHeight: 40,
                        border: "none",
                        borderRadius: 10,
                        background: "linear-gradient(135deg, #00499e 0%, #0068d6 100%)",
                        color: "#fff",
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                      }}
                    >
                      <ExternalLink size={15} />
                      Track on Mayet
                      <ChevronRight size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 13, textAlign: "center" }}>No journey selected. Search above to pick one.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
