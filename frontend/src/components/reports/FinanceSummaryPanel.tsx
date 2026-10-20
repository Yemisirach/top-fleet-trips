"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fetchCachedJson, fetchJson, API_BASE } from "@/lib/api";
import { money } from "@/lib/formatters";
import type { FinanceCards, FinanceCard, FinancePeriod, FinanceSummary, FinanceTrip, FinanceTripDetail } from "@/types/trip";

type LoadState<T> = { status: "loading" | "ready" | "error"; data?: T; error?: string };

const rangeLabel = (card: FinanceCard) =>
  card.period_start === card.period_end ? card.period_start : `${card.period_start} to ${card.period_end}`;

const signedClass = (value: number) => (value > 0 ? "green" : value < 0 ? "red" : "");

const periodTitle = (period: string) => (
  period === "daily" ? "Daily" : period === "weekly" ? "Weekly" : period === "yearly" ? "Yearly" : "Monthly"
);

const isoDate = (value: Date) => {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
};

const periodRange = (period: string, anchor: string) => {
  const [yearText, monthText, dayText] = anchor.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (period === "yearly") return { from: `${year}-01-01`, to: `${year}-12-31` };
  if (period === "monthly") {
    const end = new Date(year, month, 0).getDate();
    return { from: `${yearText}-${monthText}-01`, to: `${yearText}-${monthText}-${String(end).padStart(2, "0")}` };
  }
  if (period === "weekly") {
    const date = new Date(year, month - 1, day);
    const mondayOffset = (date.getDay() + 6) % 7;
    const start = new Date(date);
    start.setDate(date.getDate() - mondayOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: isoDate(start), to: isoDate(end) };
  }
  return { from: anchor, to: anchor };
};

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
  pinPlate = false,
}: {
  trips: FinanceTrip[];
  details: Record<number, LoadState<FinanceTripDetail>>;
  openTripId: number | null;
  onToggleTrip: (tripId: number) => void;
  pinPlate?: boolean;
}) {
  if (trips.length === 0) return <div className="finance-empty">No trips in this total.</div>;
  const plateClass = pinPlate ? "finance-identity finance-plate" : "";
  return (
    <div className={pinPlate ? "finance-table-wrap" : undefined}>
    <table className="finance-table finance-trip-table">
      <thead>
        <tr>
          <th className={pinPlate ? "finance-pin" : ""}></th>
          {pinPlate && <th className={plateClass}>Plate</th>}
          <th>Trip</th>
          {!pinPlate && <th>Plate</th>}
          <th>Route</th>
          <th className="num">Revenue</th>
          <th className="num">Cost</th>
          <th className="num">Result</th>
        </tr>
      </thead>
      <tbody>
        {trips.map((trip) => {
          const open = openTripId === trip.trip_id;
          const detail = details[trip.trip_id];
          return (
            <Fragment key={trip.trip_id}>
              <tr className={open ? "selected" : ""} onClick={() => onToggleTrip(trip.trip_id)}>
                <td className={`${pinPlate ? "finance-pin " : ""}finance-chevron`}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                {pinPlate && <td className={plateClass}><strong>{trip.plate_number}</strong></td>}
                <td>
                  <strong>{trip.trip_name}</strong>
                  <span className="finance-sub">{trip.trip_day} · {trip.driver_name}</span>
                </td>
                {!pinPlate && <td>{trip.plate_number}</td>}
                <td>{trip.route || "—"}</td>
                <td className="num green">{trip.receivable_posted ? money(trip.revenue_total) : "—"}</td>
                <td className="num">{money(trip.cost_total)}</td>
                <td className={`num ${trip.receivable_posted ? signedClass(trip.profit) : ""}`}>
                  {trip.receivable_posted ? money(trip.profit) : "Waiting"}
                </td>
              </tr>
              {open && (
                <tr className="finance-detail-row">
                  <td colSpan={7}>
                    {detail?.status === "loading" && <div className="muted">Loading how this trip was calculated…</div>}
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
    </div>
  );
}

export default function FinanceSummaryPanel() {
  const [period, setPeriod] = useState("daily");
  const [anchorDate, setAnchorDate] = useState("");
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
    const params = anchorDate ? `?as_of=${anchorDate}` : "";
    fetchJson<FinanceCards>(`${API_BASE}/reports/finance-cards${params}`)
      .then((data) => {
        if (cancelled) return;
        setCards(data);
        if (!anchorDate && data.as_of) setAnchorDate(data.as_of);
      })
      .catch(() => { if (!cancelled) setCards(null); });
    return () => { cancelled = true; };
  }, [anchorDate]);

  useEffect(() => {
    let cancelled = false;
    setSummaryError("");
    fetchCachedJson<FinanceSummary>(
      `${API_BASE}/reports/finance-summary?period=${period}&group_by=${groupBy}${anchorDate ? `&from_date=${periodRange(period, anchorDate).from}&to_date=${periodRange(period, anchorDate).to}` : ""}`,
      undefined,
      { ttlMs: 120_000, cacheKey: `reports:finance-summary-v6:${period}:${groupBy}:${anchorDate}`, forceRefresh: true },
    )
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch((error) => {
        if (!cancelled) setSummaryError(error instanceof Error ? error.message : "Could not load finance summary");
      });
    return () => { cancelled = true; };
  }, [period, groupBy, anchorDate]);

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
      const params = new URLSearchParams({ window: "card", period: card.key });
      if (anchorDate) params.set("as_of", anchorDate);
      loadTrips(key, params);
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
        ...(anchorDate ? { as_of: anchorDate } : {}),
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
  const groupHeading = groupBy === "supervisor" ? "Assigned supervisor" : groupBy === "vehicle" ? "Plate" : "";
  const identityClass = groupBy === "vehicle" ? "finance-identity finance-plate" : "finance-identity";
  const sectionTitle = groupHeading ? `${periodTitle(period)} by ${groupHeading.toLowerCase()}` : `${periodTitle(period)} totals`;
  const groupedPeriods = (summary?.periods || []).reduce<Array<{ date: string; rows: FinancePeriod[] }>>((groups, row) => {
    const last = groups[groups.length - 1];
    if (!last || last.date !== row.period_start) groups.push({ date: row.period_start, rows: [row] });
    else last.rows.push(row);
    return groups;
  }, []);

  return (
    <div className="finance-page">
      <div className="finance-toolbar">
        <select className="fleet-input" value={period} onChange={(event) => { setPeriod(event.target.value); setOpenLine(null); setOpenCard(null); setOpenTripId(null); setTripLists({}); }}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
        {period === "yearly" ? (
          <input
            className="fleet-input"
            type="number"
            min={2020}
            max={2100}
            aria-label="Year"
            value={anchorDate.slice(0, 4)}
            onChange={(event) => {
              const year = event.target.value.slice(0, 4);
              if (year.length === 4) setAnchorDate(`${year}-01-01`);
              setOpenLine(null);
              setOpenCard(null);
              setOpenTripId(null);
              setTripLists({});
            }}
          />
        ) : (
          <input
            className="fleet-input"
            type={period === "monthly" ? "month" : "date"}
            aria-label={period === "monthly" ? "Month" : "Date"}
            value={period === "monthly" ? anchorDate.slice(0, 7) : anchorDate}
            onChange={(event) => {
              const value = event.target.value;
              setAnchorDate(period === "monthly" && value ? `${value}-01` : value);
              setOpenLine(null);
              setOpenCard(null);
              setOpenTripId(null);
              setTripLists({});
            }}
          />
        )}
        <select className="fleet-input" value={groupBy} onChange={(event) => { setGroupBy(event.target.value); setOpenLine(null); setOpenTripId(null); }}>
          <option value="all">All</option>
          <option value="supervisor">Assigned Supervisor</option>
          <option value="vehicle">Vehicle</option>
        </select>
        <p className="finance-help">Pick a day, month, or year. Click a card or a row to open the trips.</p>
      </div>
      {(summary?._warning || summaryError) && <div className="login-error">{summary?._warning || summaryError}</div>}
      <div className="finance-cards">
        {(cards?.cards || []).map((card) => {
          const open = openCard === card.key;
          const active = open || period === card.key;
          return (
            <button key={card.key} type="button" className={`finance-card${active ? " selected" : ""}${open ? " open" : ""}`} onClick={() => toggleCard(card)} aria-expanded={open}>
              <div className="finance-card-top">
                <span>{card.label}</span>
                {open && <em>Open</em>}
              </div>
              <strong className={signedClass(card.profit)}>{money(card.profit)}</strong>
              <small>{rangeLabel(card)} · {card.trip_count} trips</small>
              <small>{card.pending_cost > 0 ? `Waiting ${money(card.pending_cost)}` : "No waiting receivable"}</small>
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
            <TripList trips={cardTrips.data || []} details={details} openTripId={openTripId} onToggleTrip={toggleTrip} pinPlate={groupBy === "vehicle"} />
          )}
        </section>
      )}
      <section className="panel finance-sheet">
        <div className="panel-header">
          <div>
            <div className="panel-title">{sectionTitle}</div>
            <div className="finance-sheet-note">Posted profit only. Waiting is not a loss.</div>
          </div>
        </div>
        {!summary && !summaryError && <div className="muted" style={{ padding: 16 }}>Loading periods…</div>}
        {summary && (
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead>
                <tr>
                  <th className="finance-pin"></th>
                  <th className={identityClass}>{groupHeading || "Period"}</th>
                  <th className="num">Trips</th>
                  <th className="num">Revenue</th>
                  <th className="num">Cost</th>
                  <th className="num">Posted profit</th>
                  <th className="num">Waiting</th>
                </tr>
              </thead>
              <tbody>
                {groupedPeriods.map((group) => (
                  <Fragment key={group.date}>
                    {groupBy !== "all" && (
                      <tr className="finance-date-band">
                        <td className="finance-pin"></td>
                        <td className={identityClass}>{group.date}</td>
                        <td colSpan={5}></td>
                      </tr>
                    )}
                    {group.rows.map((row) => {
                      const key = lineKey(row);
                      const open = openLine === key;
                      const loaded = tripLists[key];
                      return (
                        <Fragment key={key}>
                          <tr className={open ? "selected" : ""} onClick={() => toggleLine(row)}>
                            <td className="finance-pin finance-chevron">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                            <td className={identityClass}>
                              <strong>{groupBy === "all" ? row.period_start : (row.group_label || "Unassigned")}</strong>
                            </td>
                            <td className="num">{row.trip_count}</td>
                            <td className={`num ${row.revenue_total ? "green" : ""}`}>{money(row.revenue_total)}</td>
                            <td className={`num ${row.expense_total ? "red" : ""}`}>{money(row.expense_total)}</td>
                            <td className={`num ${signedClass(row.profit)}`}>{money(row.profit)}</td>
                            <td className="num">{(row.pending_cost || 0) > 0 ? money(row.pending_cost || 0) : "—"}</td>
                          </tr>
                          {open && (
                            <tr className="finance-detail-row">
                              <td colSpan={7}>
                                {loaded?.status === "loading" && <div className="muted">Loading trips…</div>}
                                {loaded?.status === "error" && <div className="login-error">{loaded.error}</div>}
                                {loaded?.status === "ready" && (
                                  <TripList trips={loaded.data || []} details={details} openTripId={openTripId} onToggleTrip={toggleTrip} pinPlate={groupBy === "vehicle"} />
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
