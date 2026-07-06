"use client";
import { Truck, Users, CreditCard, DollarSign, CircleDot } from "lucide-react";
import { money, normalizeState } from "@/lib/formatters";
import type { Trip } from "@/types/trip";
import type { DashboardSnapshot } from "@/types/dashboard";

const METRIC_ICONS: Record<string, React.ReactNode> = {
  Vehicles: <Users size={18} />,
  Journeys: <Truck size={18} />,
  "Active Journeys": <Truck size={18} />,
  "Vehicle Orders": <CircleDot size={18} />,
  "Customer Paid": <DollarSign size={18} />,
  "Customer Pending": <CreditCard size={18} />,
};

interface StatsGridProps {
  data: DashboardSnapshot;
  allTrips: Trip[];
  onOpenView: (view: string, status?: string) => void;
}

export default function StatsGrid({ data, allTrips, onOpenView }: StatsGridProps) {
  const summary = data.summary ?? {};
  const payment = data.payment_summary ?? {};
  const active = allTrips.filter((t) =>
    ["available", "assigned", "dispatched"].includes(normalizeState(t.status))
  ).length;
  const orderCount = allTrips.reduce((sum, t) => {
    const legs = Array.isArray(t.trips) ? t.trips.length : 0;
    return sum + Number(t.order_count || t.order_receivable_count || legs || 1);
  }, 0);

  const cards: [string, string | number, string, string, string?][] = [
    ["Journeys", summary.total_journeys ?? allTrips.length, "", "trips", "all"],
    ["Active Journeys", data.active_journey_count ?? active, "blue", "trips", "active"],
    ["Vehicle Orders", orderCount, "", "trips", "all"],
    ["Customer Paid", money(payment.customer_paid_total ?? 0), "green", "payments"],
    ["Customer Pending", money(payment.customer_pending_total ?? 0), "red", "payments"],
  ];

  return (
    <div
      id="stats-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 12,
      }}
    >
      {cards.map(([label, value, tone, view, status], i) => (
        <button
          key={label}
          type="button"
          className="metric-card"
          data-open-view={view}
          data-status={status}
          style={{ animationDelay: `${i * 0.05}s` }}
          onClick={() => onOpenView(view, status)}
        >
          <div className="card-top">
            <div className="card-label">{label}</div>
            <span className="card-icon">
              {METRIC_ICONS[label] ?? <CircleDot size={18} />}
            </span>
          </div>
          <div className={`card-value ${tone}`}>{String(value)}</div>
        </button>
      ))}
    </div>
  );
}
