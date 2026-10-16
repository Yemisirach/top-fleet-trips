"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fetchJson, API_BASE } from "@/lib/api";
import { money } from "@/lib/formatters";
import type { FinanceCards, FinanceCard, FinancePeriod, FinanceSummary, FinanceTrip, FinanceTripDetail } from "@/types/trip";

type LoadState<T> = { status: "loading" | "ready" | "error"; data?: T; error?: string };

const rangeLabel = (card: FinanceCard) =>
  card.period_start === card.period_end ? card.period_start : `${card.period_start} to ${card.period_end}`;

const resultLabel = (trip: FinanceTrip) => (trip.receivable_posted ? money(trip.profit) : "Waiting");

function TripDetailView({ detail }: { detail: FinanceTripDetail }) {
  const counted = detail.cost_source === "expense_lines" ? "trip expense lines" : "the trip payment request";
  const ignored = detail.cost_source === "expense_lines" && detail.request_total > 0
    ? " The payment request is the same cost, so it is not added again."
    : "";
  return (
    <div style={{ display: "grid", gap: 12, padding: "4px 8px 8px" }}>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        {detail.receivable_posted
          ? `Posted profit is customer receivable minus cost. Cost comes from ${counted}, counted once.${ignored}`
          : "Receivable is not posted. The cost below is waiting, not a loss."}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        <div><span className="muted">Route</span><strong style={{ display: "block" }}>{detail.route || "—"}</strong></div>
        <div><span className="muted">Driver</span><strong style={{ display: "block" }}>{detail.driver_name}</strong></div>
        <div><span className="muted">Customer</span><strong style={{ display: "block" }}>{detail.customer_name || "—"}</strong></div>
        <div><span className="muted">Supervisor</span><strong style={{ display: "block" }}>{detail.supervisor_name}</strong></div>
      </div>
      <div>
        <strong>Receivable</strong>
        {detail.receivables.length === 0 ? (
          <div className="muted">No customer receivable posted.</div>
        ) : (
          <table className="fleet-table">
            <thead><tr><th>Customer</th><th>State</th><th>Amount</th></tr></thead>
            <tbody>
              {detail.receivables.map((line, index) => (
                <tr key={`${line.customer_name}-${index}`}>
                  <td>{line.customer_name || "—"}</td>
                  <td>{line.state || "—"}</td>
                  <td>{money(line.amount_due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div>
        <strong>{detail.cost_source === "expense_lines" ? "Cost counted: expense lines" : "Cost counted: payment request"}</strong>
        {(detail.cost_source === "expense_lines" ? detail.expense_lines : detail.payment_lines).length === 0 ? (
          <div className="muted">No cost lines.</div>
        ) : detail.cost_source === "expense_lines" ? (
          <table className="fleet-table">
            <thead><tr><th>Type</th><th>Description</th><th>Qty</th><th>Total</th></tr></thead>
            <tbody>
              {detail.expense_lines.map((line, index) => (
                <tr key={`${line.type_name}-${index}`}>
                  <td>{line.type_name}</td>
                  <td>{line.description || "—"}</td>
                  <td>{line.quantity || "—"}</td>
                  <td>{money(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="fleet-table">
            <thead><tr><th>Request</th><th>Item</th><th>Qty</th><th>Total</th></tr></thead>
            <tbody>
              {detail.payment_lines.map((line, index) => (
                <tr key={`${line.request_id}-${index}`}>
                  <td>{line.request_name}</td>
                  <td>{line.item || line.description || "—"}</td>
                  <td>{line.quantity || "—"}</td>
                  <td>{money(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function TripList({
  trips,
  details,
  openTripId,
  onToggleTrip,
}: {
  trips: FinanceTrip[];
  details: Record<number, LoadState<FinanceTripDetail>>;
  openTripId: number | null;
  onToggleTrip: (tripId: number) => void;
}) {
  if (trips.length === 0) return <div className="muted">No trips in this total.</div>;
  return (
    <table className="fleet-table">
      <thead>
        <tr>
          <th></th>
          <th>Trip</th>
          <th>Plate</th>
          <th>Route</th>
          <th>Revenue</th>
          <th>Cost</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {trips.map((trip) => {
          const open = openTripId === trip.trip_id;
          const detail = details[trip.trip_id];
          return (
            <Fragment key={trip.trip_id}>
              <tr className={`payment-clickable-row${open ? " expanded" : ""}`} onClick={() => onToggleTrip(trip.trip_id)}>
                <td>
                  <button
                    type="button"
                    className="payment-row-toggle"
                    aria-label={open ? "Hide trip detail" : "Show trip detail"}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleTrip(trip.trip_id);
                    }}
                  >
                    {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                </td>
                <td>
                  <strong>{trip.trip_name}</strong>
                  <span className="muted" style={{ display: "block" }}>{trip.trip_day} · {trip.driver_name}</span>
                </td>
                <td>{trip.plate_number}</td>
                <td>{trip.route || "—"}</td>
                <td className="green">{trip.receivable_posted ? money(trip.revenue_total) : "—"}</td>
                <td>{money(trip.cost_total)}</td>
                <td className={trip.receivable_posted ? (trip.profit >= 0 ? "green" : "red") : ""}>{resultLabel(trip)}</td>
              </tr>
              {open && (
                <tr>
                  <td colSpan={7} style={{ background: "var(--panel-2)" }}>
                    {detail?.status === "loading" && <div className="muted">Loading trip detail…</div>}
                    {detail?.status === "error" && <div className="login-error">{detail.error}</div>}
                    {detail?.status === "ready" && detail.data && <TripDetailView detail={detail.data} />}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

export default function FinanceSummaryPanel({
  summary,
  period,
  groupBy,
  onPeriodChange,
}: {
  summary: FinanceSummary;
  period: string;
  groupBy: string;
  onPeriodChange: (period: string) => void;
}) {
  const [cards, setCards] = useState<FinanceCards | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [openTripId, setOpenTripId] = useState<number | null>(null);
  const [tripLists, setTripLists] = useState<Record<string, LoadState<FinanceTrip[]>>>({});
  const [details, setDetails] = useState<Record<number, LoadState<FinanceTripDetail>>>({});

  useEffect(() => {
    let cancelled = false;
    fetchJson<FinanceCards>(`${API_BASE}/reports/finance-cards`)
      .then((data) => { if (!cancelled) setCards(data); })
      .catch(() => { if (!cancelled) setCards(null); });
    return () => { cancelled = true; };
  }, []);

  const loadTrips = async (key: string, params: URLSearchParams) => {
    setTripLists((current) => ({ ...current, [key]: { status: "loading" } }));
    try {
      const data = await fetchJson<{ trips: FinanceTrip[] }>(`${API_BASE}/reports/finance-trips?${params.toString()}`);
      setTripLists((current) => ({ ...current, [key]: { status: "ready", data: data.trips } }));
    } catch (error) {
      setTripLists((current) => ({
        ...current,
        [key]: { status: "error", error: error instanceof Error ? error.message : "Could not load trips" },
      }));
    }
  };

  const toggleCard = (card: FinanceCard) => {
    onPeriodChange(card.key);
    if (openCard === card.key) {
      setOpenCard(null);
      setOpenTripId(null);
      return;
    }
    setOpenCard(card.key);
    setOpenLine(null);
    setOpenTripId(null);
    const key = `card:${card.key}`;
    if (!tripLists[key] || tripLists[key].status === "error") {
      loadTrips(key, new URLSearchParams({ window: "card", period: card.key }));
    }
  };

  const lineKey = (row: FinancePeriod) => `${period}:${row.period_start}:${groupBy}:${row.group_label || ""}`;

  const toggleLine = (row: FinancePeriod) => {
    const key = lineKey(row);
    if (openLine === key) {
      setOpenLine(null);
      setOpenTripId(null);
      return;
    }
    setOpenLine(key);
    setOpenCard(null);
    setOpenTripId(null);
    if (!tripLists[key] || tripLists[key].status === "error") {
      loadTrips(key, new URLSearchParams({
        window: "line",
        period,
        period_start: row.period_start,
        group_by: groupBy,
        group_label: row.group_label || "",
      }));
    }
  };

  const toggleTrip = async (tripId: number) => {
    if (openTripId === tripId) {
      setOpenTripId(null);
      return;
    }
    setOpenTripId(tripId);
    if (details[tripId]?.status === "ready") return;
    setDetails((current) => ({ ...current, [tripId]: { status: "loading" } }));
    try {
      const data = await fetchJson<FinanceTripDetail>(`${API_BASE}/reports/finance-trips/${tripId}`);
      setDetails((current) => ({ ...current, [tripId]: { status: "ready", data } }));
    } catch (error) {
      setDetails((current) => ({
        ...current,
        [tripId]: { status: "error", error: error instanceof Error ? error.message : "Could not load trip detail" },
      }));
    }
  };

  const columns = [
    "",
    "Period",
    ...(groupBy !== "all" ? [groupBy === "supervisor" ? "Assigned Supervisor" : "Vehicle"] : []),
    "Trips",
    "Revenue",
    "Cost",
    "Posted Profit",
    "Waiting",
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {summary._warning && <div className="login-error">{summary._warning}</div>}
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        Posted profit only. Waiting receivable is not a loss. Open a card or a line to see the trips. Open a trip to see how the number was calculated.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {(cards?.cards || []).map((card) => {
          const open = openCard === card.key;
          return (
            <button
              key={card.key}
              type="button"
              className="card"
              onClick={() => toggleCard(card)}
              aria-expanded={open}
              style={{
                textAlign: "left",
                cursor: "pointer",
                color: "inherit",
                font: "inherit",
                width: "100%",
                borderColor: open || period === card.key ? "var(--primary)" : undefined,
              }}
            >
              <div className="card-label">{card.label}</div>
              <div className={`card-value ${card.profit >= 0 ? "green" : "red"}`}>{money(card.profit)}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{rangeLabel(card)} · {card.trip_count} trips</div>
              {card.pending_cost > 0 && <div className="muted" style={{ fontSize: 12 }}>Waiting {money(card.pending_cost)}</div>}
            </button>
          );
        })}
      </div>
      {openCard && (
        <div className="panel" style={{ padding: 16 }}>
          {tripLists[`card:${openCard}`]?.status === "loading" && <div className="muted">Loading trips…</div>}
          {tripLists[`card:${openCard}`]?.status === "error" && <div className="login-error">{tripLists[`card:${openCard}`]?.error}</div>}
          {tripLists[`card:${openCard}`]?.status === "ready" && (
            <TripList
              trips={tripLists[`card:${openCard}`].data || []}
              details={details}
              openTripId={openTripId}
              onToggleTrip={toggleTrip}
            />
          )}
        </div>
      )}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            By {period.charAt(0).toUpperCase() + period.slice(1)}
            {groupBy !== "all" ? ` / ${groupBy === "supervisor" ? "Assigned Supervisor" : "Vehicle"}` : ""}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="fleet-table">
            <thead>
              <tr>{columns.map((header) => <th key={header || "expand"}>{header}</th>)}</tr>
            </thead>
            <tbody>
              {summary.periods.map((row) => {
                const key = lineKey(row);
                const open = openLine === key;
                const loaded = tripLists[key];
                return (
                  <Fragment key={key}>
                    <tr className={`payment-clickable-row${open ? " expanded" : ""}`} onClick={() => toggleLine(row)}>
                      <td>
                        <button
                          type="button"
                          className="payment-row-toggle"
                          aria-label={open ? "Hide trips" : "Show trips"}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleLine(row);
                          }}
                        >
                          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      </td>
                      <td>{row.period_start}</td>
                      {groupBy !== "all" && <td>{row.group_label || "Unassigned"}</td>}
                      <td>{row.trip_count}</td>
                      <td className="green">{money(row.revenue_total)}</td>
                      <td className="red">{money(row.expense_total)}</td>
                      <td className={row.profit >= 0 ? "green" : "red"}>{money(row.profit)}</td>
                      <td>{(row.pending_cost || 0) > 0 ? money(row.pending_cost || 0) : "—"}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={columns.length} style={{ background: "var(--panel-2)", padding: 12 }}>
                          {loaded?.status === "loading" && <div className="muted">Loading trips…</div>}
                          {loaded?.status === "error" && <div className="login-error">{loaded.error}</div>}
                          {loaded?.status === "ready" && (
                            <TripList trips={loaded.data || []} details={details} openTripId={openTripId} onToggleTrip={toggleTrip} />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
