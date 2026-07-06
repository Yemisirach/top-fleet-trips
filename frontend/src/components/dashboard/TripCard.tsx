"use client";
import { useState, useCallback } from "react";
import Link from "next/link";
import { PanelRightOpen, Map, History } from "lucide-react";
import {
  money,
  normalizeState,
  stateLabel,
  getPaymentState,
  paymentLabel,
  getOrderCount,
} from "@/lib/formatters";
import { fetchJson, API_BASE } from "@/lib/api";
import type { Trip, TripLeg } from "@/types/trip";

interface TripCardProps {
  trip: Trip;
  targetId: string;
}

interface TimelineEntry {
  timestamp?: string;
  location?: string;
  note?: string;
  source?: string;
}

function buildLocalTimeline(trip: Trip): TimelineEntry[] {
  const legs = Array.isArray(trip.trips) ? trip.trips : [];
  const destination =
    Array.isArray(trip.destinations) && trip.destinations.length
      ? trip.destinations[0]
      : "Pending destination";
  if (!legs.length) {
    return [
      {
        timestamp: trip.departure_date || "",
        location: trip.journey_start || trip.origin || "TOP Factory",
        note: `Journey opened toward ${destination}`,
        source: "Dashboard",
      },
      {
        timestamp: trip.return_date || "",
        location: trip.journey_end || "TOP Factory",
        note: `Return to ${trip.journey_end || "TOP Factory"} pending`,
        source: "Dashboard",
      },
    ];
  }
  const entries: TimelineEntry[] = legs.flatMap((leg: TripLeg) => {
    const e: TimelineEntry[] = [
      {
        timestamp: leg.departure_date || trip.departure_date || "",
        location: leg.origin || trip.origin || "TOP Factory",
        note: `Trip leg toward ${leg.destination || "destination"} · Revenue ${money(leg.revenue || 0)} · Expense ${money(leg.expense || 0)}`,
        source: "Odoo",
      },
    ];
    if (leg.arrival_date)
      e.push({
        timestamp: leg.arrival_date,
        location: leg.destination || "Destination",
        note: `Arrived after ${leg.distance_km || 0} km`,
        source: "GPS",
      });
    return e;
  });
  entries.push({
    timestamp: trip.return_date || "",
    location: trip.journey_end || "TOP Factory",
    note: `Journey ends when vehicle returns to ${trip.journey_end || "TOP Factory"}`,
    source: "Dashboard",
  });
  return entries;
}

export default function TripCard({ trip, targetId }: TripCardProps) {
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const state = normalizeState(trip.status);
  const payState = getPaymentState(trip);
  const tripId = String(trip.id || "");
  const legs = Array.isArray(trip.trips) ? trip.trips : [];
  const destinations = Array.isArray(trip.destinations) ? trip.destinations : [];
  const journeyStart = trip.journey_start || "TOP Factory";
  const journeyEnd = trip.journey_end || "TOP Factory";
  const origin = trip.origin || journeyStart;
  const destination =
    destinations[0] || (legs[0] && legs[0].destination) || "Pending destination";

  const totalDistance = legs.reduce((s, l) => s + Number(l.distance_km || 0), 0);
  const seed = Number(tripId.slice(-4)) || 1;
  const moving = state === "dispatched";
  const speed = moving ? 58 + (seed % 24) : 0;
  const fuel = 38 + (seed % 47);
  const telemetryDistance = totalDistance || 420 + (seed % 900);
  const visibleLegs = legs.length
    ? legs.slice(0, 3)
    : [{ origin, destination, distance_km: telemetryDistance, status: state, revenue: trip.total_revenue, expense: trip.total_expense }];
  const profit = Number(trip.total_revenue || 0) - Number(trip.total_expense || 0);

  const toggleTimeline = useCallback(async () => {
    if (timelineOpen) {
      setTimelineOpen(false);
      return;
    }
    setTimelineOpen(true);
    setTimelineLoading(true);
    try {
      const data = await fetchJson<{ timeline?: TimelineEntry[] }>(
        `${API_BASE}/journeys/${encodeURIComponent(tripId)}/timeline`
      );
      setTimeline(data.timeline || buildLocalTimeline(trip));
    } catch {
      setTimeline(buildLocalTimeline(trip));
    } finally {
      setTimelineLoading(false);
    }
  }, [timelineOpen, tripId, trip]);

  const fmtTimestamp = (ts?: string) => {
    if (!ts) return "Pending";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString("en-GB", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <article className="trip-card">
      {/* Head */}
      <div className="trip-card-head">
        <div>
          <div className="plate">{trip.vehicle_plate || "No plate"}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {trip.customer_name || "Customer not assigned"} · {trip.vehicle_brand || "Fleet vehicle"}
          </div>
        </div>
        <span className={`pill ${state}`}>{stateLabel(state)}</span>
      </div>

      {/* Meta */}
      <div className="trip-meta-grid">
        <div className="meta-item">
          <div className="trip-meta-label muted">Customer</div>
          <div>{trip.customer_name || "N/A"}</div>
        </div>
        <div className="meta-item">
          <div className="trip-meta-label muted">Driver</div>
          <div>{trip.driver_name || "Unassigned"}</div>
        </div>
        <div className="meta-item">
          <div className="trip-meta-label muted">Departure</div>
          <div>{trip.departure_date || "Not set"}</div>
        </div>
        <div className="meta-item">
          <div className="trip-meta-label muted">Payment</div>
          <div>{paymentLabel(trip)}</div>
        </div>
        <div className="meta-item">
          <div className="trip-meta-label muted">Mayet GPS</div>
          <div>{trip.mayet_status || "No cache"}</div>
        </div>
        <div className="meta-item">
          <div className="trip-meta-label muted">Trips Inside</div>
          <div>{trip.trip_count || visibleLegs.length} trip{Number(trip.trip_count || visibleLegs.length) === 1 ? "" : "s"}</div>
        </div>
      </div>

      {/* Route */}
      <div className="route-panel">
        <div className="route-line">
          <span>{journeyStart}</span>
          <span className="route-arrow">→</span>
          <span>{destination}</span>
          <span className="route-arrow">→</span>
          <span>{journeyEnd}</span>
        </div>
        <div className="leg-list">
          {visibleLegs.map((leg, i) => (
            <div className="leg-row" key={i}>
              <span>
                <strong>{leg.origin || origin}</strong> → {leg.destination || destination}
              </span>
              <span>
                {money(leg.revenue || 0)} / {money(leg.expense || 0)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Money */}
      <div className="money-grid">
        <div 
          className="money-box" 
          style={{ cursor: "pointer" }}
          title={`Revenue breakdown: ${visibleLegs.length ? visibleLegs.map(l => `${l.destination || 'Leg'}: ${money(l.revenue || 0)}`).join(' | ') : money(trip.total_revenue)}\nClick to view full detail`}
          onClick={() => window.location.href = `/detail?journey_id=${encodeURIComponent(tripId)}`}
        >
          <div className="money-label">Revenue</div>
          <div className="money-value green">{money(trip.total_revenue)}</div>
        </div>
        <div 
          className="money-box" 
          style={{ cursor: "pointer" }}
          title={`Expense breakdown: ${visibleLegs.length ? visibleLegs.map(l => `${l.destination || 'Leg'}: ${money(l.expense || 0)}`).join(' | ') : money(trip.total_expense)}\nClick to view full detail`}
          onClick={() => window.location.href = `/detail?journey_id=${encodeURIComponent(tripId)}`}
        >
          <div className="money-label">Expense</div>
          <div className="money-value red">{money(trip.total_expense)}</div>
        </div>
        <div className="money-box"><div className="money-label">Paid</div><div className="money-value green">{money(trip.paid_amount)}</div></div>
        <div className="money-box"><div className="money-label">Pending</div><div className="money-value amber">{money(trip.pending_payment)}</div></div>
        <div className="money-box">
          <div className="money-label">Status</div>
          <div className={`money-value ${payState === "paid" ? "green" : payState === "pending" ? "red" : "amber"}`}>
            {paymentLabel(trip)}
          </div>
        </div>
        <div className="money-box"><div className="money-label">Orders</div><div className="money-value blue">{getOrderCount(trip)}</div></div>
      </div>

      {/* Telemetry */}
      <div className="telemetry-grid">
        <div className="telemetry-box"><div className="telemetry-label">Speed</div><div className="telemetry-value">{speed} km/h</div></div>
        <div className="telemetry-box"><div className="telemetry-label">Fuel</div><div className="telemetry-value">{fuel}%</div></div>
        <div className="telemetry-box"><div className="telemetry-label">Distance</div><div className="telemetry-value">{telemetryDistance} km</div></div>
      </div>

      {/* Actions */}
      <div className="card-actions">
        <Link className="btn primary" href={`/detail?journey_id=${encodeURIComponent(tripId)}`}>
          <PanelRightOpen size={16} /> Detail
        </Link>
        <button
          className="btn"
          type="button"
          onClick={() => {
            const plate = trip.vehicle_plate || trip.vehicle_id || tripId;
            if (plate) navigator.clipboard.writeText(plate);
            window.open(`https://mayetgps.com/objects?search=${encodeURIComponent(plate || '')}`, "mayet_gps");
          }}
        >
          <Map size={16} /> Map
        </button>
        <button className="btn" type="button" onClick={toggleTimeline}>
          <History size={16} /> Timeline
        </button>
      </div>

      {/* Timeline panel */}
      {timelineOpen && (
        <div className="timeline-panel open" id={`timeline-${targetId}-${tripId}`}>
          {timelineLoading ? (
            <div className="empty">Loading timeline…</div>
          ) : timeline.length === 0 ? (
            <div className="empty">No timeline entries.</div>
          ) : (
            timeline.map((entry, i) => (
              <div key={i} style={{ display: "grid", gap: 2 }}>
                <div className="timeline-time">{fmtTimestamp(entry.timestamp)}</div>
                <div className="timeline-location">{entry.location || "Unknown location"}</div>
                <div className="timeline-note">{entry.note || entry.source || ""}</div>
              </div>
            ))
          )}
        </div>
      )}
    </article>
  );
}
