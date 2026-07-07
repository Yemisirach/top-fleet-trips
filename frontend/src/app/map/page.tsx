"use client";
import { useState, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { LayoutDashboard, Moon, Sun, Copy, ExternalLink, MapPin, Truck, User, Navigation, CheckCircle, Search } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { fetchJson, API_BASE } from "@/lib/api";
import { money } from "@/lib/formatters";
import type { Trip } from "@/types/trip";

import Sidebar, { type SidebarView } from "@/components/layout/Sidebar";

function MapContent() {
  const { theme, toggle } = useTheme();
  const params = useSearchParams();
  const tripId = params.get("journey_id") || params.get("trip_id");
  const vehicleParam = params.get("vehicle") || params.get("plate") || params.get("search");

  const [vehicleSearch, setVehicleSearch] = useState(vehicleParam || "");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [allTrips, setAllTrips] = useState<Trip[]>([]);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [journeySearch, setJourneySearch] = useState("");
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
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

  const filteredTrips = journeySearch.trim()
    ? allTrips.filter((t) => {
        const q = journeySearch.toLowerCase();
        const plate = (t.vehicle_plate || "").toLowerCase();
        // Match full plate, or any dash-separated segment (e.g. '16652' matches '16652-34002')
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
    setVehicleSearch(t.vehicle_plate || t.vehicle_id || String(t.id));
    setCopied(false);
    setJourneySearch("");
    setSearchDropdownOpen(false);
    window.history.pushState({}, "", `/map?journey_id=${encodeURIComponent(t.id)}`);
  };

  const handleCopyAndOpen = () => {
    if (vehicleSearch) {
      navigator.clipboard.writeText(vehicleSearch).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
    window.open(`https://mayetgps.com/objects?search=${encodeURIComponent(vehicleSearch || '')}`, "mayet_gps");
  };

  const handleCopyPlate = () => {
    if (vehicleSearch) {
      navigator.clipboard.writeText(vehicleSearch).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const destination = trip
    ? (Array.isArray(trip.destinations) && trip.destinations.length
        ? trip.destinations[0]
        : trip.destination || "Destination pending")
    : null;

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
            <div className="muted" style={{ fontSize: 13 }}>Live fleet tracking — opens in a separate tab for full functionality</div>
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

        {/* Main Content — replaces the broken iframe */}
        <div className="map-container" style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          
          {/* Center: Launch Pad */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 32 }}>
            <div style={{ maxWidth: 520, width: "100%", display: "flex", flexDirection: "column", gap: 24 }}>

              {/* Hero card */}
              <div style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 16,
                padding: "40px 32px",
                textAlign: "center",
                boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
              }}>
                <div style={{
                  width: 72, height: 72, borderRadius: 16,
                  background: "linear-gradient(135deg, #00499e 0%, #0068d6 100%)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 20,
                }}>
                  <MapPin size={36} color="#fff" />
                </div>

                <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 900 }}>
                  {vehicleSearch ? `Track ${vehicleSearch}` : "Open Mayet GPS"}
                </h2>
                <p className="muted" style={{ margin: "0 0 24px", fontSize: 14, lineHeight: 1.6 }}>
                  Mayet GPS opens in a new browser tab on the Objects page.
                  {vehicleSearch ? ` Plate "${vehicleSearch}" will be copied to your clipboard — just paste it into Mayet's search bar (top left).` : " Select a journey to auto-copy the plate number."}
                </p>

                {/* Primary CTA */}
                <button
                  onClick={handleCopyAndOpen}
                  style={{
                    width: "100%",
                    minHeight: 52,
                    border: "none",
                    borderRadius: 12,
                    background: "linear-gradient(135deg, #00499e 0%, #0068d6 100%)",
                    color: "#fff",
                    fontSize: 16,
                    fontWeight: 800,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    transition: "transform 0.15s ease, box-shadow 0.15s ease",
                    boxShadow: "0 4px 14px rgba(0, 73, 158, 0.35)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(0, 73, 158, 0.45)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 14px rgba(0, 73, 158, 0.35)"; }}
                  id="open-mayet-btn"
                >
                  <ExternalLink size={20} />
                  {vehicleSearch ? "Copy Plate & Open Mayet GPS" : "Open Mayet GPS"}
                </button>

                {/* Copy-only button */}
                {vehicleSearch && (
                  <button
                    onClick={handleCopyPlate}
                    className="fleet-btn"
                    style={{
                      width: "100%",
                      marginTop: 12,
                      minHeight: 44,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      fontSize: 14,
                    }}
                    id="copy-plate-btn"
                  >
                    {copied ? <CheckCircle size={16} color="#0e9849" /> : <Copy size={16} />}
                    {copied ? "Plate Copied!" : `Copy Plate: ${vehicleSearch}`}
                  </button>
                )}
              </div>

              {/* Quick steps */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 12,
              }}>
                {[
                  { step: "1", label: "Open Mayet", desc: "Click the button above" },
                  { step: "2", label: "Log In", desc: "top@mayet.com / Pass123" },
                  { step: "3", label: "Paste Plate", desc: "Ctrl+V in Mayet search bar" },
                ].map((s) => (
                  <div key={s.step} style={{
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: "16px 14px",
                    textAlign: "center",
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "var(--bg)", border: "1px solid var(--border)",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontWeight: 900, fontSize: 13, marginBottom: 8, color: "#00499e",
                    }}>
                      {s.step}
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>{s.label}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{s.desc}</div>
                  </div>
                ))}
              </div>
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
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 13, textAlign: "center" }}>No journey selected. Select one above.</div>
                )}
              </div>
            </div>

            {/* Mayet Credentials */}
            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", padding: 16, borderRadius: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10 }}>Mayet Login Credentials</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
                <span className="muted">Email</span> 
                <strong>top@mayet.com</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span className="muted">Password</span> 
                <strong>Pass123</strong>
              </div>
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading map...</div>}>
      <MapContent />
    </Suspense>
  );
}
