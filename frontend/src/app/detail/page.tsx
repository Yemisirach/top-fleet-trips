"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LayoutDashboard, Map, Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { fetchJson, API_BASE } from "@/lib/api";
import { money, normalizeState, stateLabel, getPaymentState, paymentLabel } from "@/lib/formatters";
import type { Trip, GpsPayload } from "@/types/trip";

interface TimelineEntry {
  title: string;
  meta: string;
  note: string;
}

function buildTimeline(trip: Trip): TimelineEntry[] {
  const legs = Array.isArray(trip.trips) ? trip.trips : [];
  const destination =
    Array.isArray(trip.destinations) && trip.destinations.length
      ? trip.destinations[0]
      : trip.destination;
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
        note: `Trip leg toward ${leg.destination || "destination"} · Revenue ${money(leg.revenue || 0)} · Expense ${money(leg.expense || 0)}`,
      },
    ];
    if (leg.arrival_date)
      e.push({
        title: leg.destination || "Destination",
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

export default function DetailPage() {
  const { theme, toggle } = useTheme();
  const params = useSearchParams();
  const tripId = params.get("journey_id") || params.get("trip_id");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [gps, setGps] = useState<GpsPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tripId) { setError("No trip id provided."); return; }
    (async () => {
      const mode = localStorage.getItem("fleetDashboardMode") || "live";
      let found: Trip | null = null;
      try {
        const data = await fetchJson<{ recent_journeys?: Trip[] }>(
          `${API_BASE}/dashboard/full?mode=${encodeURIComponent(mode)}`
        );
        found = (data.recent_journeys || []).find((t) => String(t.id) === String(tripId)) || null;
      } catch {}
      if (!found) {
        try { found = await fetchJson<Trip>(`${API_BASE}/journeys/${encodeURIComponent(tripId)}`); } catch {}
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

  if (!trip) {
    return <div className="empty" style={{ padding: 60 }}>Loading…</div>;
  }

  const state = normalizeState(trip.status || trip.state);
  const destinations = Array.isArray(trip.destinations) ? trip.destinations : [];
  const journeyStart = trip.journey_start || "TOP Factory";
  const journeyEnd = trip.journey_end || "TOP Factory";
  const route = `${journeyStart} → ${destinations[0] || trip.destination || "DB destination pending"} → ${journeyEnd}`;
  const revenue = Number(trip.total_revenue || 0);
  const expense = Number(trip.total_expense || 0);
  const dbLocation =
    trip.current_location ||
    (Array.isArray(trip.destinations) ? trip.destinations[0] : trip.destination) ||
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
  const legs = Array.isArray(trip.trips) ? trip.trips : [];
  const mapLink = `/map?journey_id=${encodeURIComponent(trip.id)}&vehicle=${encodeURIComponent(trip.vehicle_plate || trip.vehicle_id || String(trip.id))}`;

  const metrics: [string, string | number, string][] = [
    ["Driver", trip.driver_name || "Unassigned", ""],
    ["Journey Revenue", money(revenue), "green"],
    ["Paid", money(trip.paid_amount), "green"],
    ["Pending", money(trip.pending_payment), "amber"],
    ["Journey Expense", money(expense), "red"],
    ["Profit", money(revenue - expense), revenue - expense >= 0 ? "green" : "red"],
    ["Trips Inside", trip.trip_count || (Array.isArray(trip.trips) ? trip.trips.length : 1), ""],
    ["Return To", journeyEnd, ""],
  ];

  return (
    <>
      {/* Topbar */}
      <header className="fleet-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/static/fleet-trips-logo.svg" alt="Fleet Trips" style={{ width: 40, height: 40, borderRadius: 8 }} />
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
              if (plate) navigator.clipboard.writeText(plate);
              window.open(`https://mayetgps.com/objects?search=${encodeURIComponent(plate || '')}`, "mayet_gps");
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

      <main className="fleet-page">
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

        {/* Timeline + location compare + route */}
        <div className="panel">
          <div className="panel-header"><div className="panel-title">Timeline &amp; Location</div></div>
          <div className="panel-body" style={{ display: "grid", gap: 16 }}>
            {/* Timeline */}
            <div className="timeline" id="timeline">
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

            {/* Location compare */}
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <div className="panel-title" style={{ fontSize: 13, marginBottom: 8 }}>Location Comparison</div>
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

            {/* Route legs */}
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <div className="panel-title" style={{ fontSize: 13, marginBottom: 8 }}>Route</div>
              <div id="route-summary" style={{ display: "grid", gap: 8 }}>
                {legs.length ? (
                  legs.map((leg, i) => (
                    <div className="compare-row" key={i}>
                      <div className="compare-label">Trip {leg.id || i + 1}</div>
                      <div>
                        {leg.origin || "Origin"} → {leg.destination || "Destination"} · Revenue {money(leg.revenue || 0)} · Expense {money(leg.expense || 0)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="compare-row">
                    <div className="compare-label">Journey</div>
                    <div>
                      {journeyStart} → {Array.isArray(trip.destinations) ? trip.destinations.join(", ") : trip.destination || "Destination pending"} → {journeyEnd}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
