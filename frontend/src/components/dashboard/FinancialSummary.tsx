"use client";
import { money, normalizeState, paymentLabel, getOrderCount } from "@/lib/formatters";
import type { Trip } from "@/types/trip";
import type { DashboardSnapshot } from "@/types/dashboard";

interface FinancialSummaryProps {
  data: DashboardSnapshot;
  trips: Trip[];
}

export default function FinancialSummary({ data, trips }: FinancialSummaryProps) {
  const payment = data.payment_summary ?? {};
  const revenue =
    trips.reduce((s, t) => s + Number(t.total_revenue || 0), 0) ||
    Number(payment.receivable_total || 0);
  const expense =
    trips.reduce((s, t) => s + Number(t.total_expense || 0), 0) ||
    Number(payment.expense_total || 0);
  const profit = revenue - expense;

  const rows: [string, string, string][] = [
    ["Confirmed Receivables", money(revenue), "green"],
    ["Approved Expenses", money(expense), "red"],
    ["Customer Paid", money(payment.customer_paid_total ?? 0), "green"],
    ["Customer Pending", money(payment.customer_pending_total ?? 0), "red"],
    ["Net Profit", money(profit), profit >= 0 ? "green" : "red"],
    [
      "Profit Margin",
      `${revenue ? Math.round((profit / revenue) * 100) : 0}%`,
      profit >= 0 ? "green" : "red",
    ],
  ];

  // Driver activity
  const driverMap: Record<
    string,
    { driver: string; vehicles: Set<string>; trips: number; dispatched: number; revenue: number }
  > = {};
  trips.forEach((t) => {
    const driver = t.driver_name || "Unassigned";
    if (!driverMap[driver])
      driverMap[driver] = { driver, vehicles: new Set(), trips: 0, dispatched: 0, revenue: 0 };
    driverMap[driver].vehicles.add(t.vehicle_plate || "N/A");
    driverMap[driver].trips++;
    driverMap[driver].revenue += Number(t.total_revenue || 0);
    if (normalizeState(t.status) === "dispatched") driverMap[driver].dispatched++;
  });
  const driverRows = Object.values(driverMap)
    .sort((a, b) => b.trips - a.trips)
    .slice(0, 8);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Financial summary */}
      <div className="panel">
        <div className="panel-header"><div className="panel-title">Financial Summary</div></div>
        <div className="panel-body">
          <div id="financial-summary">
            {rows.map(([label, value, tone]) => (
              <div className="summary-row" key={label}>
                <span className="muted">{label}</span>
                <strong className={tone}>{value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Driver activity */}
      {/* <div className="panel">
        <div className="panel-header"><div className="panel-title">Driver Activity</div></div>
        <div className="panel-body" style={{ padding: 0 }}>
          <div style={{ overflowX: "auto" }}>
            <table className="fleet-table" id="driver-activity-table">
              <thead>
                <tr>
                  {["Driver", "Vehicles", "Trips", "Dispatched", "Revenue"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {driverRows.map((row) => (
                  <tr key={row.driver}>
                    <td>{row.driver}</td>
                    <td>{Array.from(row.vehicles).slice(0, 3).join(", ")}</td>
                    <td>{row.trips}</td>
                    <td>{row.dispatched}</td>
                    <td className="green">{money(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div> */}
    </div>
  );
}
