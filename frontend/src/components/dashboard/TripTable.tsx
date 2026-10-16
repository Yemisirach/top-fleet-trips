"use client";
import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink, History, Map, PanelRightOpen } from "lucide-react";
import {
  buildJourneyRoute,
  buildMayetUrl,
  getJourneyDisplayLegs,
  getPrimaryJourneyDestination,
  isJourneyDestination,
  getOrderCount,
  legMoneyLabel,
  mayetSearchTerm,
  money,
  paymentLabel,
  stateLabel,
} from "@/lib/formatters";
import { fetchCachedJson, API_BASE } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { Trip } from "@/types/trip";

interface TripTableProps {
  trips: Trip[];
  limit?: number;
}

interface TimelineEntry {
  timestamp?: string;
  location?: string;
  note?: string;
  source?: string;
}

function buildLocalTimeline(trip: Trip): TimelineEntry[] {
  const legs = getJourneyDisplayLegs(trip);
  if (!legs.length) {
    return [
      {
        timestamp: trip.departure_date || trip.create_date || "",
        location: trip.journey_start || trip.origin || "Origin not set",
        note: `Journey opened toward ${getPrimaryJourneyDestination(trip)}`,
        source: "Dashboard",
      },
      {
        timestamp: trip.return_date || "",
        location: trip.journey_end || "Return location not set",
        note: `Journey ends when vehicle returns to ${trip.journey_end || "return location not set"}`,
        source: "Dashboard",
      },
    ];
  }
  const entries = legs.map((leg) => ({
    timestamp: leg.departure_date || trip.departure_date || "",
    location: leg.origin || trip.origin || "Origin not set",
    note: `Trip leg ${leg.origin || trip.origin || "Origin not set"} -> ${isJourneyDestination(leg.destination) ? leg.destination : getPrimaryJourneyDestination(trip)} · Revenue ${money(leg.revenue || 0)} · Expense ${money(leg.expense || 0)}`,
    source: leg.synthetic ? "Route" : "Odoo",
  }));
  entries.push({
    timestamp: trip.return_date || "",
    location: trip.journey_end || "Return location not set",
    note: `Journey ends when vehicle returns to ${trip.journey_end || "return location not set"}`,
    source: "Dashboard",
  });
  return entries;
}

function cleanTimelineEntries(entries: TimelineEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = [
      entry.timestamp || "",
      entry.location || "",
      entry.source || "",
      entry.note || "",
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function CompactLocation({ value }: { value: string }) {
  const text = String(value || "").trim();
  if (!text) return <span className="muted">–</span>;
  const words = text.split(/\s+/);
  if (words.length <= 2 && text.length <= 24) return <span>{text}</span>;
  return (
    <details className="gps-note-compact" onClick={(event) => event.stopPropagation()}>
      <summary>{words.slice(0, 2).join(" ")}...</summary>
      <div>{text}</div>
    </details>
  );
}

export default function TripTable({ trips, limit }: TripTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedLegKey, setExpandedLegKey] = useState<string | null>(null);
  const [timelineOpenId, setTimelineOpenId] = useState<string | null>(null);
  const [timelineLoadingId, setTimelineLoadingId] = useState<string | null>(null);
  const [timelineByTrip, setTimelineByTrip] = useState<Record<string, TimelineEntry[]>>({});

  if (!trips.length) {
    return <div className="empty">No journeys match this view.</div>;
  }

  const visibleTrips = typeof limit === "number" ? trips.slice(0, limit) : trips;
  const toggleExpanded = (tripId: string) => {
    setExpandedId((current) => {
      const next = current === tripId ? null : tripId;
      if (next !== tripId) setExpandedLegKey(null);
      return next;
    });
    setTimelineOpenId(null);
  };

  const toggleTimeline = async (trip: Trip) => {
    const tripId = String(trip.id);
    if (timelineOpenId === tripId) {
      setTimelineOpenId(null);
      return;
    }

    setExpandedId(tripId);
    setTimelineOpenId(tripId);
    if (timelineByTrip[tripId]) return;

    setTimelineLoadingId(tripId);
    try {
      const data = await fetchCachedJson<{ timeline?: TimelineEntry[] }>(
        `${API_BASE}/journeys/${encodeURIComponent(tripId)}/timeline`,
        undefined,
        { ttlMs: 300_000, cacheKey: `timeline:${tripId}` }
      );
      setTimelineByTrip((current) => ({
        ...current,
        [tripId]: data.timeline || buildLocalTimeline(trip),
      }));
    } catch {
      setTimelineByTrip((current) => ({
        ...current,
        [tripId]: buildLocalTimeline(trip),
      }));
    } finally {
      setTimelineLoadingId(null);
    }
  };

  const formatDateTime = (value?: string) => {
    if (!value) return "Not set";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const tableHeaders = ["Vehicle", "Date & Time", "Driver", "DB Location", "Payment", "Revenue", "Expense", "Profit", "Trips", "State"];

  return (
    <div className="journey-table-wrap">
      <table className="fleet-table dashboard-trip-table" id="recent-trip-table">
        <thead>
          <tr>
            {tableHeaders.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleTrips.map((t) => {
            const tripId = String(t.id);
            const plate = t.vehicle_plate || t.vehicle_id || tripId;
            const legs = getJourneyDisplayLegs(t);
            const route = buildJourneyRoute(t);
            const isExpanded = expandedId === tripId;
            const profit = Number(t.total_revenue || 0) - Number(t.total_expense || 0);
            const tripDateTime = formatDateTime(t.create_date || t.departure_date || t.write_date);
            const timelineEntries = cleanTimelineEntries(timelineByTrip[tripId] || []);

            return (
              <Fragment key={tripId}>
                <tr
                  aria-expanded={isExpanded}
                  className="hoverable-row"
                  style={{ cursor: "pointer" }}
                  onClick={() => toggleExpanded(tripId)}
                  title="Click to expand journey details"
                >
                  <td data-label="Vehicle">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                        type="button"
                        aria-label={isExpanded ? "Collapse journey" : "Expand journey"}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleExpanded(tripId);
                        }}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          border: "1px solid var(--line)",
                          background: "var(--panel-2)",
                          color: "var(--text)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flex: "0 0 auto",
                        }}
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                      <div>
                        <div style={{ fontWeight: 800 }}>{plate}</div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          Tap to expand
                        </div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Date & Time">{tripDateTime}</td>
                  <td data-label="Driver">{t.driver_name || "Unassigned"}</td>
                  <td data-label="DB Location">
                    <CompactLocation value={t.current_location || t.current_location_note || t.destination || "Pending"} />
                  </td>
                  <td data-label="Payment">{paymentLabel(t)}</td>
                  <td data-label="Revenue" className="green">{money(t.total_revenue)}</td>
                  <td data-label="Expense" className="red">{money(t.total_expense)}</td>
                  <td data-label="Profit" className={profit >= 0 ? "green" : "red"}>{money(profit)}</td>
                  <td data-label="Trips">{getOrderCount(t)}</td>
                  <td data-label="State">{stateLabel(t.status)}</td>
                </tr>

                {isExpanded && (
                  <tr className="journey-expanded-row">
                    <td className="journey-expanded-cell" colSpan={10} style={{ padding: 0, borderBottom: "1px solid var(--line)" }}>
                      <div
                        className="journey-expanded-detail"
                        style={{
                          padding: 16,
                          background: "var(--panel-2)",
                          borderTop: "1px solid var(--line)",
                          display: "grid",
                          gap: 14,
                        }}
                      >
                        <div className="journey-expanded-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 900, fontSize: 15 }}>{route}</div>
                            <div className="journey-expanded-summary-line">
                              <span>{t.customer_name || "No customer"}</span>
                              <span>{paymentLabel(t)}</span>
                              <span>{legs.length ? `${legs.length} trip${legs.length === 1 ? "" : "s"}` : "No trips"}</span>
                            </div>
                          </div>

                          <div className="journey-expanded-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <Link className="btn" href={`/detail?journey_id=${encodeURIComponent(tripId)}`}>
                              <PanelRightOpen size={16} /> Detail
                            </Link>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => void toggleTimeline(t)}
                            >
                              <History size={16} /> Timeline
                            </button>
                            <Link
                              className="btn primary"
                              href={`/map?journey_id=${encodeURIComponent(tripId)}&vehicle=${encodeURIComponent(plate)}`}
                            >
                              <Map size={16} /> View Map
                            </Link>
                            <a
                              className="btn"
                              href={buildMayetUrl(t.mayet_url, plate, tripId)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() => void copyTextToClipboard(mayetSearchTerm(plate))}
                              title={`Copies ${mayetSearchTerm(plate)} before opening Mayet`}
                            >
                              <ExternalLink size={16} /> View on Mayet
                            </a>
                          </div>
                        </div>

                        <div
                          className="journey-detail-grid"
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                            gap: 10,
                          }}
                        >
                          {[
                            ["Customer", t.customer_name || "N/A"],
                            ["Payment", paymentLabel(t)],
                            ["Revenue", money(t.total_revenue)],
                            ["Expense", money(t.total_expense)],
                            ["Profit", money(profit)],
                            ["Trips", String(legs.length || getOrderCount(t))],
                            ["State", stateLabel(t.status)],
                          ].map(([label, value]) => (
                            <div
                              key={label}
                              style={{
                                background: "var(--panel)",
                                border: "1px solid var(--line)",
                                borderRadius: 8,
                                padding: "10px 12px",
                              }}
                            >
                              <div className="muted" style={{ fontSize: 11, marginBottom: 4, textTransform: "uppercase" }}>
                                {label}
                              </div>
                              <div style={{ fontWeight: 700, fontSize: 13, wordBreak: "break-word" }}>{value}</div>
                            </div>
                          ))}
                        </div>

                        {legs.length > 0 && (
                          <div style={{ display: "grid", gap: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>
                              Trips
                            </div>
                            <div style={{ display: "grid", gap: 8 }}>
                              {legs.slice(0, 6).map((leg, index) => {
                                const legKey = `${tripId}:${leg.id || index}`;
                                const legProfit = Number(leg.revenue || 0) - Number(leg.expense || 0);
                                const paymentLines = Array.isArray(leg.payment_request_lines) ? leg.payment_request_lines : [];
                                const legPaid = Number(leg.paid_amount ?? t.paid_amount ?? 0);
                                const legPending = Number(leg.pending_payment ?? t.pending_payment ?? 0);
                                const legRequestTotal = Number(leg.payment_request_total ?? t.payment_request_total ?? 0);
                                const legRequestCount = Number(leg.payment_request_count ?? t.payment_request_count ?? 0);
                                const legPaymentLabel = legRequestTotal > 0
                                  ? `${money(legRequestTotal)} requested${legRequestCount ? ` · ${legRequestCount} request${legRequestCount === 1 ? "" : "s"}` : ""}`
                                  : paymentLabel(t);
                                const isLegExpanded = expandedLegKey === legKey;
                                return (
                                  <div key={legKey} className={`cached-leg-card${isLegExpanded ? " expanded" : ""}`}>
                                    <button
                                      type="button"
                                      className="cached-leg-row"
                                      onClick={() => setExpandedLegKey((current) => (current === legKey ? null : legKey))}
                                      aria-expanded={isLegExpanded}
                                    >
                                      <span className="route-mobile">
                                        <strong>{leg.origin || t.origin || "Origin not set"}</strong>
                                        <span className="route-arrow">→</span>
                                        {leg.destination || "Destination"}
                                        {leg.synthetic && <span className="muted"> · return</span>}
                                      </span>
                                      <span className="cached-leg-right">
                                        {legMoneyLabel(leg)}
                                        {isLegExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                      </span>
                                    </button>
                                    {isLegExpanded && (
                                      <div className="cached-leg-detail">
                                        {[
                                          ["Departure", formatDateTime(leg.departure_date || leg.create_date || t.departure_date)],
                                          ["Arrival", formatDateTime(leg.arrival_date)],
                                          ["Status", stateLabel(leg.status || t.status)],
                                          ["Revenue", money(leg.revenue || 0)],
                                          ["Expense", money(leg.expense || 0)],
                                          ["Profit", money(legProfit)],
                                          ["Distance", leg.distance_km ? `${leg.distance_km} km` : "N/A"],
                                          ["Payment", leg.synthetic ? "Return leg" : legPaymentLabel],
                                          ["Paid", money(legPaid)],
                                          ["Pending", money(legPending)],
                                        ].map(([label, value]) => (
                                          <div key={label}>
                                            <span>{label}</span>
                                            <strong>{value}</strong>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {isLegExpanded && (
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
                                                <tr key={`${legKey}-payment-line-${line.request_id || lineIndex}`}>
                                                  <td>
                                                    <strong>{line.item || line.description || "Payment request"}</strong>
                                                    {line.description && line.description !== line.item && (
                                                      <span>{line.description}</span>
                                                    )}
                                                  </td>
                                                  <td>{line.quantity || 1}</td>
                                                  <td>{money(line.amount || 0)}</td>
                                                  <td>{money(line.total ?? ((line.amount || 0) * (line.quantity || 1)))}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        ) : (
                                          <div className="empty">No payment request items linked to this trip.</div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              {legs.length > 6 && (
                                <div className="muted" style={{ fontSize: 12 }}>
                                  Showing first 6 trips. Open Detail for all legs.
                                </div>
                              )}
                                    </div>
                          </div>
                        )}

                        {timelineOpenId === tripId && (
                          <div className="timeline-panel open journey-timeline-panel">
                            <div className="journey-timeline-header">
                              <div>
                                <div className="panel-title">Journey Timeline</div>
                                <div className="muted" style={{ fontSize: 12 }}>Odoo timeline history and journey leg events</div>
                              </div>
                              <span className="visual-chip">{timelineEntries.length} events</span>
                            </div>
                            {timelineLoadingId === tripId ? (
                              <div className="empty">Loading timeline…</div>
                            ) : timelineEntries.length === 0 ? (
                              <div className="empty">No timeline entries.</div>
                            ) : (
                              <div className="journey-timeline">
                                {timelineEntries.map((entry, index) => (
                                  <div className="journey-timeline-item" key={`${tripId}-timeline-${index}`}>
                                    <div className="journey-timeline-marker">
                                      <span>{index + 1}</span>
                                    </div>
                                    <div className="journey-timeline-card">
                                      <div className="journey-timeline-top">
                                        <strong>{entry.location || "Unknown location"}</strong>
                                        <time>{formatDateTime(entry.timestamp)}</time>
                                      </div>
                                      <div className="journey-timeline-note">{entry.note || "Timeline event"}</div>
                                      {entry.source && <div className="journey-timeline-source">{entry.source}</div>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
