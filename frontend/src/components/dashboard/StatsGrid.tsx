"use client";
import { Truck, Users, CreditCard, DollarSign, CircleDot } from "lucide-react";
import { money } from "@/lib/formatters";
import type { Trip } from "@/types/trip";
import type { DashboardSnapshot } from "@/types/dashboard";

const METRIC_ICONS: Record<string, React.ReactNode> = {
  Vehicles: <Users size={18} />,
  Journeys: <Truck size={18} />,
  Trips: <CircleDot size={18} />,
  "Vehicle Conflicts": <Truck size={18} />,
  "Customer Paid": <DollarSign size={18} />,
  "Customer Pending": <CreditCard size={18} />,
};

interface StatsGridProps {
  data: DashboardSnapshot;
  allTrips: Trip[];
  onOpenView: (view: string, status?: string) => void;
}

export default function StatsGrid({ data, allTrips, onOpenView }: StatsGridProps) {
  const payment = data.payment_summary ?? {};
  const orderCount = allTrips.reduce((sum, t) => {
    const legs = Array.isArray(t.trips) ? t.trips.length : 0;
    return sum + Number(t.trip_count || legs || t.order_count || t.order_receivable_count || 1);
  }, 0);

  const cards: [string, string | number, string, string, string?][] = [
    ["Trips", data.summary?.total_journeys ?? orderCount, "", "trips", "trip_rows"],
    ["Journeys", allTrips.length, "", "trips", "all"],
    ["Vehicle Conflicts", data.vehicle_conflict_count ?? 0, data.vehicle_conflict_count ? "red" : "", "overview"],
    ["Customer Paid", money(payment.customer_paid_total ?? 0), "green", "payments"],
    ["Customer Pending", money(payment.customer_pending_total ?? 0), "red", "payments"],
  ];

  return (
    <div id="stats-grid" className="flex gap-2 overflow-x-auto pb-1">
      {cards.map(([label, value, tone, view, status]) => (
        <button
          key={label}
          type="button"
          onClick={() => onOpenView(view, status)}
          className="flex items-center gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 shadow-sm hover:bg-gray-50 active:bg-gray-100 transition-all"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-gray-600">
            {METRIC_ICONS[label] ?? <CircleDot size={14} />}
          </div>
          <div className="flex flex-col items-start -space-y-0.5">
            <span className="text-[10px] font-medium text-gray-500">{label}</span>
            <span className={`text-base font-semibold tabular-nums leading-none ${tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-rose-600' : 'text-gray-900'}`}>
              {String(value)}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
