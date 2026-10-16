"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, LayoutDashboard, Map, Menu, Moon, Sun } from "lucide-react";
import Sidebar, { type SidebarView } from "@/components/layout/Sidebar";
import { useTheme } from "@/hooks/useTheme";
import { fetchJson, API_BASE } from "@/lib/api";
import { buildJourneyRoute, getJourneyDisplayLegs, getPrimaryJourneyDestination, isJourneyDestination, money, normalizeState, stateLabel, firstPlateNumber } from "@/lib/formatters";
import type { Trip, GpsPayload } from "@/types/trip";

interface TimelineEntry {
  title: string;
  meta: string;
  note: string;
}

function buildTimeline(trip: Trip): TimelineEntry[] {
  const legs = getJourneyDisplayLegs(trip);
  const destination = getPrimaryJourneyDestination(trip);
  if (!legs.length) {
    return [
      {
        title: trip.journey_start || trip.origin || "TOP Factory",
        meta: trip.departure_date || "Not set",
        note: `Journey opened toward ${destination || "destination pending"}`,
      },
      {
        title: trip.journey_end || "TOP Factory",
        meta: trip.return_date || "Pending",
        note: `Journey ends when vehicle returns to ${trip.journey_end || "TOP Factory"}`,
      },
    ];
  }
  const entries: TimelineEntry[] = legs.flatMap((leg) => {
    const e: TimelineEntry[] = [
      {
        title: leg.origin || trip.origin || "TOP Factory",
        meta: leg.departure_date || trip.departure_date || "Not set",
        note: `${leg.synthetic ? "Return leg" : "Trip leg"} toward ${isJourneyDestination(leg.destination) ? leg.destination : destination} · Revenue ${money(leg.revenue || 0)} · Expense ${money(leg.expense || 0)}`,
      },
    ];
    if (leg.arrival_date)
      e.push({
        title: isJourneyDestination(leg.destination) ? leg.destination || "Destination" : trip.journey_end || "Return location",
        meta: leg.arrival_date,
        note: `Arrived after ${leg.distance_km || 0} km`,
      });
    return e;
  });
  entries.push({
    title: trip.journey_end || "TOP Factory",
    meta: trip.return_date || "Pending",
    note: `Return to ${trip.journey_end || "TOP Factory"}`,
  });
  return entries;
}

function paymentItemName(item?: string, description?: string) {
  const itemText = String(item || "").trim();
  const descriptionText = String(description || "").trim();
  const raw = /^line\s+\d+$/i.test(itemText)
    ? descriptionText
    : itemText || descriptionText || "Payment request";
  return raw
    .replace(/^cancelled\s+request:\s*/i, "")
    .replace(/\s*-\s*(cancelled|canceled|approved|posted|done|paid|draft)\b.*$/i, "")
    .replace(/^approved\s+payment\s+request:\s*/i, "")
    .replace(/^posted\s+accounting\s+entry:\s*/i, "")
    .trim() || "Payment request";
}

function DetailContent() {
  const { theme, toggle } = useTheme();
  const params = useSearchParams();
  const tripId = params.get("journey_id") || params.get("trip_id");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [gps, setGps] = useState<GpsPayload | null>(null);
  const [error, setError] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [expandedLegKey, setExpandedLegKey] = useState<string>("");

  useEffect(() => {
    if (!tripId) { 
      return; 
    }
    (async () => {
      const mode = localStorage.getItem("fleetDashboardMode") || "live";
      let found: Trip | null = null;
      try {
        found = await fetchJson<Trip>(`${API_BASE}/journeys/${encodeURIComponent(tripId)}`);
      } catch {}
      if (!found) {
        try {
          const data = await fetchJson<{ recent_journeys?: Trip[] }>(
            `${API_BASE}/dashboard/full?mode=${encodeURIComponent(mode)}`
          );
          found = (data.recent_journeys || []).find((t) => String(t.id) === String(tripId)) || null;
        } catch {}
      }
      if (!found) { setError("Trip not found in the selected data source."); return; }
      setTrip(found);
      // GPS
      if (found.mayet_status || found.mayet_captured_at) {
        setGps({ gps: { location: found.mayet_status, captured_at: found.mayet_captured_at, latitude: found.mayet_latitude, longitude: found.mayet_longitude } });
      } else {
        try {
          const g = await fetchJson<GpsPayload>(
            `${API_BASE}/dashboard/gps/${encodeURIComponent(found.vehicle_plate || found.vehicle_id || String(found.id))}`
          );
          setGps(g);
        } catch {}
      }
    })();
  }, [tripId]);

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
        {error}
      </div>
    );
  }

  if (!tripId) {
    return <div className="empty" style={{ padding: 60 }}>No journey selected.</div>;
  }

  if (!trip) {
    return <div className="empty" style={{ padding: 60 }}>Loading…</div>;
  }

  const state = normalizeState(trip.status || trip.state);
  const journeyStart = trip.journey_start || "TOP Factory";
  const journeyEnd = trip.journey_end || "TOP Factory";
  const route = buildJourneyRoute(trip);
  const revenue = Number(trip.total_revenue || 0);
  const expense = Number(trip.total_expense || 0);
  const dbLocation =
    trip.current_location ||
    getPrimaryJourneyDestination(trip) ||
    trip.current_location_note ||
    "DB location pending";
  const gpsData = gps?.gps;
  const gpsLocation = gpsData
    ? [gpsData.location, gpsData.address,
       gpsData.latitude && gpsData.longitude ? `${gpsData.latitude}, ${gpsData.longitude}` : ""]
        .filter(Boolean)
        .join(" · ")
    : "No cached Mayet GPS position";
  const diff =
    gpsData && dbLocation && gpsLocation && !gpsLocation.toLowerCase().includes(String(dbLocation).toLowerCase());
  const timeline = buildTimeline(trip);
  const legs = getJourneyDisplayLegs(trip);
  const mapLink = `/map?journey_id=${encodeURIComponent(trip.id)}&vehicle=${encodeURIComponent(trip.vehicle_plate || trip.vehicle_id || String(trip.id))}`;
  const nav = (view: SidebarView) => {
    if (view === "overview") window.location.href = "/";
    else if (view === "reports") window.location.href = "/reports";
    else if (view === "payments") window.location.href = "/payments";
    else if (view === "map") window.location.href = "/map";
    else window.location.href = `/?view=${view}`;
  };

  const metrics: [string, string | number, string][] = [
    ["Driver", trip.driver_name || "Unassigned", ""],
    ["Journey Revenue", money(revenue), "green"],
    ["Paid", money(trip.paid_amount), "green"],
    ["Pending", money(trip.pending_payment), "amber"],
    ["Journey Expense", money(expense), "red"],
    ["Profit", money(revenue - expense), revenue - expense >= 0 ? "green" : "red"],
    ["Trips Inside", legs.length || trip.trip_count || 1, ""],
    ["Return To", journeyEnd, ""],
  ];

  return (
    <div className="app-shell">
      <div className={`overlay${mobileSidebarOpen ? " open" : ""}`} onClick={() => setMobileSidebarOpen(false)} />
      <Sidebar currentView={"trips" as SidebarView} onViewChange={nav} mobileOpen={mobileSidebarOpen} onCloseMobile={() => setMobileSidebarOpen(false)} />
      <div className="app-main">
      {/* Topbar */}
      <header className="fleet-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn md-hidden" onClick={() => setMobileSidebarOpen(true)} title="Open menu">
            <Menu size={18} />
          </button>
          <img src="/top-logo-full.jpg" alt="TOP Fleet" style={{ width: 42, height: 34, borderRadius: 8, objectFit: "contain", background: "#fff", padding: 2 }} />
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }} id="page-title">{trip.vehicle_plate || String(trip.id)}</div>
            <div style={{ color: "var(--muted)", fontSize: 13 }} id="page-subtitle">DB location and Mayet GPS comparison</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn" href="/">
            <LayoutDashboard size={16} /> Dashboard
          </Link>
          <button
            className="btn primary"
            id="map-link"
            onClick={() => {
              const plate = trip.vehicle_plate || trip.vehicle_id || String(trip.id);
              const searchStr = firstPlateNumber(plate);
              if (searchStr) navigator.clipboard.writeText(searchStr);
              window.open(`https://mayetgps.com/objects?search=${encodeURIComponent(searchStr)}`, "mayet_gps");
            }}
          >
            <Map size={16} /> Track on Mayet
          </button>
          <button className="btn" id="theme-toggle" onClick={toggle}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      <main className="fleet-page detail-full-page">
        {/* Header panel */}
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title" id="trip-heading">{trip.vehicle_plate || String(trip.id)}</div>
              <div style={{ color: "var(--muted)", fontSize: 13 }} id="trip-route">{route}</div>
            </div>
            <span className={`pill ${state}`} id="trip-state">{stateLabel(state)}</span>
          </div>
          <div className="panel-body">
            <div className="metrics-strip" id="metrics">
              {metrics.map(([label, value, tone]) => (
                <div className="metric-box" key={label}>
                  <div className="metric-label">{label}</div>
                  <div className={`metric-value ${tone}`}>{String(value)}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Route legs */}
        <section className="panel neon-detail-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Route Trip Legs</div>
              <div className="muted" style={{ fontSize: 12 }}>Tap a trip leg to expand revenue, expense, and payment request items.</div>
            </div>
          </div>
          <div className="panel-body neon-legs" id="route-summary">
            {legs.length ? (
              legs.map((leg, index) => {
                const legKey = `${trip.id}:${leg.id || index}`;
                const isExpanded = expandedLegKey === legKey;
                const profit = Number(leg.revenue || 0) - Number(leg.expense || 0);
                const paymentLines = Array.isArray(leg.payment_request_lines) ? leg.payment_request_lines : [];
                const ExpandIcon = isExpanded ? ChevronDown : ChevronRight;

                return (
                  <div key={legKey} className={`cached-leg-card${isExpanded ? " expanded" : ""}`}>
                    <button
                      type="button"
                      className="cached-leg-row"
                      onClick={() => setExpandedLegKey((current) => (current === legKey ? "" : legKey))}
                      aria-expanded={isExpanded}
                    >
                      <div>
                        <strong>{leg.origin || "Origin"} → {leg.destination || "Destination"}</strong>
                        <span className="muted">
                          {leg.synthetic ? "Return leg" : `Trip ${leg.id || index + 1}`} · {leg.departure_date || trip.departure_date || "Date pending"}
                        </span>
                      </div>
                      <div className="cached-leg-right">
                        <strong className={profit >= 0 ? "green" : "red"}>{money(profit)}</strong>
                        <span>Profit</span>
                        <ExpandIcon size={16} />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="cached-leg-detail">
                        <div>
                          <span>Revenue</span>
                          <strong className="green">{money(leg.revenue || 0)}</strong>
                        </div>
                        <div>
                          <span>Expense</span>
                          <strong className="red">{money(leg.expense || 0)}</strong>
                        </div>
                        <div>
                          <span>Paid</span>
                          <strong>{money(leg.paid_amount || 0)}</strong>
                        </div>
                        <div>
                          <span>Pending</span>
                          <strong>{money(leg.pending_payment || 0)}</strong>
                        </div>
                        <div>
                          <span>Distance</span>
                          <strong>{Number(leg.distance_km || 0).toLocaleString("en-ET")} km</strong>
                        </div>
                        <div>
                          <span>Status</span>
                          <strong>{stateLabel(normalizeState(leg.status || trip.status || trip.state))}</strong>
                        </div>

                        <div className="cached-leg-payment-list">
                          <div className="cached-leg-payment-title">Payment request item list</div>
                          {paymentLines.length ? (
                            <table>
                              <thead>
                                <tr>
                                  {["Item", "Qty", "Asked Price", "Line Total"].map((heading) => (
                                    <th key={heading}>{heading}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {paymentLines.map((line, lineIndex) => (
                                  <tr key={`${legKey}-line-${line.request_id || lineIndex}`}>
                                    <td><strong>{paymentItemName(line.item, line.description)}</strong></td>
                                    <td>{line.quantity || 1}</td>
                                    <td>{money(line.amount || 0)}</td>
                                    <td>{money(line.total ?? ((line.amount || 0) * (line.quantity || 1)))}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div className="empty">No payment request items linked to this trip leg.</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="compare-row">
                <div className="compare-label">Journey</div>
                <div>{buildJourneyRoute(trip)}</div>
              </div>
            )}
          </div>
        </section>

        {/* Location compare */}
        <section className="panel neon-detail-panel">
          <div className="panel-header"><div className="panel-title">Location Comparison</div></div>
          <div className="panel-body">
            <div className="compare" id="location-compare" style={{ display: "grid", gap: 8 }}>
              <div className="compare-row"><div className="compare-label">DB Location</div><div>{dbLocation}</div></div>
              <div className="compare-row"><div className="compare-label">GPS Location</div><div>{gpsLocation}</div></div>
              <div className="compare-row">
                <div className="compare-label">Difference</div>
                <div className={diff ? "red" : "green"}>
                  {diff ? "GPS and DB location differ" : gpsData ? "GPS matches DB context" : "Waiting for Mayet GPS cache"}
                </div>
              </div>
              <div className="compare-row">
                <div className="compare-label">Mayet</div>
                <div>
                  <a className="btn" href={gps?.mayet_url || "https://mayetgps.com/"} target="_blank" rel="noreferrer">
                    Open Mayet
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Timeline moved to bottom */}
        <section className="panel neon-detail-panel">
          <div className="panel-header"><div className="panel-title">Timeline</div></div>
          <div className="panel-body">
            <div className="timeline neon-timeline" id="timeline">
              {timeline.map((entry, i) => (
                <div className="timeline-entry" key={i}>
                  <div className="timeline-dot" />
                  <div className="timeline-card">
                    <strong>{entry.title}</strong>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>
                      {entry.meta} · {entry.note}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      </div>
    </div>
  );
}

export default function DetailPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading trip details...</div>}>
      <DetailContent />
    </Suspense>
  );
}
