"use client";

import { useEffect, useState } from "react";
import { fetchCachedJson, formatSyncTime, readCachedJson } from "@/lib/api";
import { addisTodayKey } from "@/components/dashboard/AnalyticsStrip";

type CostItem = { item?: string; description?: string; quantity?: number; amount?: number; total?: number };
type Report = {
  report_date: string; synced_at: string; saved: boolean; warning?: string;
  cost: number; revenue: number;
  vehicles: { vehicle_id: number; plate?: string; cost: number; revenue: number;
    trips: { id: number; reference?: string; cost_source: string; cost: number; revenue: number;
      unconfirmed_revenue: number; cost_items: CostItem[] }[] }[];
};
const money = (amount: number) => amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SupervisorDailyReport() {
  const [date, setDate] = useState(addisTodayKey);
  const [report, setReport] = useState<Report | null>(null);
  const [note, setNote] = useState("Loading saved report…");

  useEffect(() => {
    let cancelled = false;
    const key = `supervisor:daily:${date}`;
    const apply = (data: Report, saved: boolean) => {
      if (cancelled || data.report_date !== date) return;
      setReport(data);
      setNote(data.warning || `${saved || data.saved ? "Saved Odoo data" : "Synced from Odoo"} · ${formatSyncTime(data.synced_at)}`);
    };
    const cached = readCachedJson<Report>(key);
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ cacheKey: string; data: Report }>).detail;
      if (detail?.cacheKey === key) apply(detail.data, false);
    };
    window.addEventListener("fleet-cache-updated", onUpdate);
    void fetchCachedJson<Report>(`/api/supervisor/daily-report?report_date=${date}`, undefined, { cacheKey: key })
      .then((data) => apply(data, true))
      .catch(() => { if (!cancelled && !cached) setNote("No synced data for this date. Connect and use Sync to load Odoo data."); });
    return () => { cancelled = true; window.removeEventListener("fleet-cache-updated", onUpdate); };
  }, [date]);

  const selectDate = (next: string) => {
    if (!next || next === date) return;
    setReport(null);
    setNote("Loading saved report…");
    setDate(next);
  };

  return <section className="panel" aria-label="Assigned vehicle daily report">
    <div className="panel-body">
      <h2>My vehicles · daily costs and revenue</h2>
      <label>Report date <input type="date" value={date} onChange={(event) => { selectDate(event.target.value); }} /></label>
      <button className="btn" onClick={() => selectDate(addisTodayKey())}>Today</button>
      <p className="muted" role="status">{note}</p>
      <p className="muted">By trip departure date, or creation date when departure is missing. Revenue is the trip’s recorded receivables, including unconfirmed amounts; it is not necessarily cash collected. Costs use trip expense lines, or payment request lines when no trip expenses exist.</p>
      {report && <>
        <p><strong>Total costs: {money(report.cost)} · Revenue: {money(report.revenue)} · Difference: {money(report.revenue - report.cost)}</strong></p>
        {report.vehicles.length === 0 && <p>No trips for your assigned vehicles on this date in the synced Odoo data.</p>}
        {report.vehicles.map((vehicle) => <details key={vehicle.vehicle_id} open>
          <summary><strong>{vehicle.plate || `Vehicle ${vehicle.vehicle_id}`}</strong> · Costs {money(vehicle.cost)} · Revenue {money(vehicle.revenue)}</summary>
          {vehicle.trips.map((trip) => <div key={trip.id} style={{ margin: "12px 0", overflowX: "auto" }}>
            <p>{trip.reference || `Trip ${trip.id}`} · Revenue {money(trip.revenue)} · Unconfirmed {money(trip.unconfirmed_revenue)} · Cost source: {trip.cost_source === "trip_expense_line" ? "trip expenses" : "payment requests"}</p>
            <table className="fleet-table"><thead><tr><th>Cost item</th><th>Description</th><th>Quantity</th><th>Unit amount</th><th>Total</th></tr></thead>
              <tbody>{trip.cost_items.map((line, index) => <tr key={index}>
                <td>{line.item || "Not recorded"}</td><td>{line.description || "—"}</td><td>{line.quantity ?? "—"}</td><td>{line.amount == null ? "—" : money(Number(line.amount))}</td><td>{money(Number(line.total || 0))}</td>
              </tr>)}{trip.cost_items.length === 0 && <tr><td colSpan={5}>No recorded cost items.</td></tr>}</tbody>
            </table>
          </div>)}
        </details>)}
      </>}
    </div>
  </section>;
}
