"use client";
import {
  money,
  normalizeState,
  stateLabel,
  paymentLabel,
  getOrderCount,
} from "@/lib/formatters";
import type { Trip } from "@/types/trip";

interface TripTableProps {
  trips: Trip[];
}

export default function TripTable({ trips }: TripTableProps) {
  if (!trips.length) {
    return <div className="empty">No trips match this view.</div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="fleet-table" id="recent-trip-table">
        <thead>
          <tr>
            {["Vehicle", "Customer", "Driver", "Route", "Mayet", "Payment", "Revenue", "Expense", "Profit", "Orders", "State"].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trips.slice(0, 10).map((t) => {
            const destinations = Array.isArray(t.destinations)
              ? t.destinations.join(", ")
              : "Pending";
            return (
              <tr 
                key={t.id} 
                onClick={() => window.location.href = `/detail?journey_id=${t.id}`}
                style={{ cursor: "pointer" }}
                className="hoverable-row"
              >
                <td>{t.vehicle_plate || String(t.id)}</td>
                <td>{t.customer_name || "N/A"}</td>
                <td>{t.driver_name || "Unassigned"}</td>
                <td>{destinations || t.origin || "Pending"}</td>
                <td>{t.mayet_status || "No cache"}</td>
                <td>{paymentLabel(t)}</td>
                <td className="green">{money(t.total_revenue)}</td>
                <td className="red">{money(t.total_expense)}</td>
                <td className={Number(t.total_revenue || 0) - Number(t.total_expense || 0) >= 0 ? "green" : "red"}>
                  {money(Number(t.total_revenue || 0) - Number(t.total_expense || 0))}
                </td>
                <td>{getOrderCount(t)}</td>
                <td>{stateLabel(t.status)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
