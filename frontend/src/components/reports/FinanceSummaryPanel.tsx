"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fetchCachedJson, fetchJson, API_BASE } from "@/lib/api";
import { money } from "@/lib/formatters";
import type { FinanceCards, FinanceCard, FinancePeriod, FinanceSummary, FinanceTrip, FinanceTripDetail } from "@/types/trip";

type LoadState<T> = { status: "loading" | "ready" | "error"; data?: T; error?: string };

const rangeLabel = (card: FinanceCard) =>
  card.period_start === card.period_end ? card.period_start : `${card.period_start} to ${card.period_end}`;

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="finance-metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function TripDetailView({ detail }: { detail: FinanceTripDetail }) {
  const counted = detail.cost_source === "expense_lines" ? "trip expense lines" : "the trip payment request";
  const ignored = detail.cost_source === "expense_lines" && detail.request_total > 0
    ? " The payment request is the same cost, so it is not added again."
    : "";
  const lines = detail.cost_source === "expense_lines" ? detail.expense_lines : detail.payment_lines;
  return (
    <div className="finance-detail">
      <div className="finance-note">
        {detail.receivable_posted
          ? `Posted profit is customer receivable minus cost. Cost comes from ${counted}, counted once.${ignored}`
          : "Receivable is not posted. The cost below is waiting, not a loss."}
      </div>
      <div className="finance-facts">
        <div className="finance-fact finance-fact-wide">
          <span>Route</span>
          <strong>{detail.route || "—"}</strong>
        </div>
        <div className="finance-fact"><span>Driver</span><strong>{detail.driver_name}</strong></div>
        <div className="finance-fact"><span>Customer</span><strong>{detail.customer_name || "—"}</strong></div>
        <div className="finance-fact"><span>Supervisor</span><strong>{detail.supervisor_name}</strong></div>
      </div>
      <div className="finance-split">
        <section>
          <h3>Receivable</h3>
          {detail.receivables.length === 0 ? (
            <div className="muted">No customer receivable posted.</div>
          ) : (
            <table className="fleet-table finance-mini-table">
              <thead><tr><th>Customer</th><th>State</th><th>Amount</th></tr></thead>
              <tbody>
                {detail.receivables.map((line, index) => (
                  <tr key={`${line.customer_name}-${index}`}>
                    <td>{line.customer_name || "—"}</td>
                    <td>{line.state || "—"}</td>
                    <td className="num">{money(line.amount_due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section>
          <h3>{detail.cost_source === "expense_lines" ? "Cost counted: expense lines" : "Cost counted: payment request"}</h3>
          {lines.length === 0 ? (
            <div className="muted">No cost lines.</div>
          ) : (
            <table className="fleet-table finance-mini-table">
              <thead><tr><th>Item</th><th>Qty</th><th>Total</th></tr></thead>
              <tbody>
                {detail.cost_source === "expense_lines"
                  ? detail.expense_lines.map((line, index) => (
                    <tr key={`${line.type_name}-${index}`}>
                      <td>{line.type_name}{line.description ? ` · ${line.description}` : ""}</td>
                      <td className="num">{line.quantity || "—"}</td>
                      <td className="num">{money(line.total)}</td>
                    </tr>
                  ))
                  : detail.payment_lines.map((line, index) => (
                    <tr key={`${line.request_id}-${index}`}>
                      <td>{line.item || line.description || line.request_name}</td>
                      <td className="num">{line.quantity || "—"}</td>
                      <td className="num">{money(line.total)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </section>
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
    <div className="finance-trip-list">
      {trips.map((trip) => {
        const open = openTripId === trip.trip_id;
        const detail = details[trip.trip_id];
        return (
          <article key={trip.trip_id} className={`finance-trip${open ? " selected" : ""}`}>
            <button type="button" className="finance-trip-main" onClick={() => onToggleTrip(trip.trip_id)} aria-expanded={open}>
              <span className="finance-chevron" aria-hidden="true">
                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </span>
              <span className="finance-trip-name">
                <strong>{trip.trip_name}</strong>
                <span>{trip.trip_day} · {trip.driver_name}</span>
              </span>
              <span className="finance-trip-meta">{trip.plate_number}</span>
              <span className="finance-trip-route">{trip.route || "—"}</span>
              <Metric label="Revenue" value={trip.receivable_posted ? money(trip.revenue_total) : "—"} tone="green" />
              <Metric label="Cost" value={money(trip.cost_total)} />
              <Metric
                label="Result"
                value={trip.receivable_posted ? money(trip.profit) : "Waiting"}
                tone={trip.receivable_posted ? (trip.profit >= 0 ? "green" : "red") : ""}
              />
            </button>
            {open && (
              <div className="finance-child">
                {detail?.status === "loading" && <div className="muted">Loading how this trip was calculated…</div>}
                {detail?.status === "error" && <div className="login-error">{detail.error}</div>}
                {detail?.status === "ready" && detail.data && <TripDetailView detail={detail.data} />}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

export default function FinanceSummaryPanel() {
  const [period, setPeriod] = useState("daily");
  const [groupBy, setGroupBy] = useState("all");
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [summaryError, setSummaryError] = useState("");
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

  useEffect(() => {
    let cancelled = false;
    setSummaryError("");
    fetchCachedJson<FinanceSummary>(
      `${API_BASE}/reports/finance-summary?period=${period}&group_by=${groupBy}`,
      undefined,
      { ttlMs: 120_000, cacheKey: `reports:finance-summary-v5:${period}:${groupBy}`, forceRefresh: true },
    )
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch((error) => {
        if (!cancelled) setSummaryError(error instanceof Error ? error.message : "Could not load finance summary");
      });
    return () => { cancelled = true; };
  }, [period, groupBy]);

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
    setPeriod(card.key);
    setOpenTripId(null);
    setOpenLine(null);
    if (openCard === card.key) {
      setOpenCard(null);
      return;
    }
    setOpenCard(card.key);
    const key = `card:${card.key}`;
    if (!tripLists[key] || tripLists[key].status === "error") {
      loadTrips(key, new URLSearchParams({ window: "card", period: card.key }));
    }
  };

  const lineKey = (row: FinancePeriod) => `${period}:${row.period_start}:${groupBy}:${row.group_label || ""}`;

  const toggleLine = (row: FinancePeriod) => {
    const key = lineKey(row);
    setOpenTripId(null);
    setOpenCard(null);
    if (openLine === key) {
      setOpenLine(null);
      return;
    }
    setOpenLine(key);
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

  const cardTrips = openCard ? tripLists[`card:${openCard}`] : undefined;

  return (
    <div className="finance-page">
      <div className="finance-toolbar">
        <select className="fleet-input" value={period} onChange={(event) => { setPeriod(event.target.value); setOpenLine(null); setOpenCard(null); setOpenTripId(null); }}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <select className="fleet-input" value={groupBy} onChange={(event) => { setGroupBy(event.target.value); setOpenLine(null); setOpenTripId(null); }}>
          <option value="all">All</option>
          <option value="supervisor">Assigned Supervisor</option>
          <option value="vehicle">Vehicle</option>
        </select>
      </div>
      <p className="finance-help">
        The bar marks the selected card or line. Trips open underneath it. Open a trip to see the receivable and the cost that made the number.
      </p>
      {(summary?._warning || summaryError) && <div className="login-error">{summary?._warning || summaryError}</div>}
      <div className="finance-cards">
        {(cards?.cards || []).map((card) => {
          const open = openCard === card.key;
          return (
            <button key={card.key} type="button" className={`card finance-card${open ? " selected" : ""}`} onClick={() => toggleCard(card)} aria-expanded={open}>
              <div className="finance-card-top">
                <div className="card-label">{card.label}</div>
                {open && <span className="finance-selected-chip">Selected</span>}
              </div>
              <div className={`card-value ${card.profit >= 0 ? "green" : "red"}`}>{money(card.profit)}</div>
              <div className="muted finance-card-sub">{rangeLabel(card)} · {card.trip_count} trips</div>
              {card.pending_cost > 0 && <div className="muted finance-card-sub">Waiting {money(card.pending_cost)}</div>}
            </button>
          );
        })}
      </div>
      {openCard && (
        <section className="finance-child finance-card-child" aria-label="Trips in selected card">
          <div className="finance-child-label">Trips in selected {openCard} total</div>
          {cardTrips?.status === "loading" && <div className="muted">Loading trips…</div>}
          {cardTrips?.status === "error" && <div className="login-error">{cardTrips.error}</div>}
          {cardTrips?.status === "ready" && (
            <TripList trips={cardTrips.data || []} details={details} openTripId={openTripId} onToggleTrip={toggleTrip} />
          )}
        </section>
      )}
      <section className="panel finance-lines">
        <div className="panel-header">
          <div className="panel-title">
            By {period.charAt(0).toUpperCase() + period.slice(1)}
            {groupBy !== "all" ? ` / ${groupBy === "supervisor" ? "Assigned Supervisor" : "Vehicle"}` : ""}
          </div>
        </div>
        {!summary && !summaryError && <div className="muted" style={{ padding: 16 }}>Loading periods…</div>}
        {summary?.periods.map((row) => {
          const key = lineKey(row);
          const open = openLine === key;
          const loaded = tripLists[key];
          return (
            <div key={key} className={`finance-line-wrap${open ? " selected" : ""}`}>
              <button type="button" className="finance-line" onClick={() => toggleLine(row)} aria-expanded={open}>
                <span className="finance-chevron" aria-hidden="true">
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
                <span className="finance-line-title">
                  <strong>{row.period_start}</strong>
                  {groupBy !== "all" && <span>{row.group_label || "Unassigned"}</span>}
                  {open && <em>Selected</em>}
                </span>
                <span className="finance-line-metrics">
                  <Metric label="Trips" value={String(row.trip_count)} />
                  <Metric label="Revenue" value={money(row.revenue_total)} tone="green" />
                  <Metric label="Cost" value={money(row.expense_total)} tone="red" />
                  <Metric label="Posted profit" value={money(row.profit)} tone={row.profit >= 0 ? "green" : "red"} />
                  <Metric label="Waiting" value={(row.pending_cost || 0) > 0 ? money(row.pending_cost || 0) : "—"} />
                </span>
              </button>
              {open && (
                <div className="finance-child">
                  <div className="finance-child-label">Trips in this line</div>
                  {loaded?.status === "loading" && <div className="muted">Loading trips…</div>}
                  {loaded?.status === "error" && <div className="login-error">{loaded.error}</div>}
                  {loaded?.status === "ready" && (
                    <TripList trips={loaded.data || []} details={details} openTripId={openTripId} onToggleTrip={toggleTrip} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
