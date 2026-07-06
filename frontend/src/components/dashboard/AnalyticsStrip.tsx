"use client";
import {
  money,
  normalizeState,
  stateLabel,
  getDailySeries,
  percentOf,
  getOrderCount,
} from "@/lib/formatters";
import type { Trip } from "@/types/trip";
import type { DashboardSnapshot } from "@/types/dashboard";

interface AnalyticsStripProps {
  data: DashboardSnapshot;
  trips: Trip[];
  onOpenView: (view: string, status?: string) => void;
}

function Sparkline({
  series,
  tone = "",
}: {
  series: [string, number][];
  tone?: string;
}) {
  const max = Math.max(1, ...series.map(([, v]) => v));
  return (
    <div className="sparkline">
      {series.map(([, v], i) => (
        <span
          key={i}
          className={`spark-bar ${tone}`}
          style={{ height: `${Math.max(8, percentOf(v, max))}%` }}
        />
      ))}
    </div>
  );
}

export default function AnalyticsStrip({
  data,
  trips,
  onOpenView,
}: AnalyticsStripProps) {
  const payment = data.payment_summary ?? {};
  const revenue =
    trips.reduce((s, t) => s + Number(t.total_revenue || 0), 0) ||
    Number(payment.receivable_total || 0);
  const paid = Number(payment.customer_paid_total || 0);
  const pending = Number(payment.customer_pending_total || 0);
  const active = trips.filter((t) =>
    ["available", "assigned", "dispatched"].includes(normalizeState(t.status))
  ).length;
  const dispatched = trips.filter(
    (t) => normalizeState(t.status) === "dispatched"
  ).length;
  const orderCount = trips.reduce((s, t) => s + getOrderCount(t), 0);

  const tripSeries = getDailySeries(trips, () => 1);
  const revenueSeries = getDailySeries(trips, (t) => Number(t.total_revenue || 0));
  const orderSeries = getDailySeries(trips, (t) => getOrderCount(t));

  const activeRate = trips.length ? Math.round((active / trips.length) * 100) : 0;
  const collectionRate =
    paid + pending ? Math.round((paid / (paid + pending)) * 100) : 0;
  const startLabel = tripSeries[0]?.[0] ?? "No date";
  const endLabel = tripSeries[tripSeries.length - 1]?.[0] ?? "No date";

  const cards: [
    string,
    string | number,
    string,
    [string, number][],
    string,
    string,
    string
  ][] = [
    ["Journey Activity", trips.length, `${activeRate}% active`, tripSeries, "", "trips", "available"],
    ["Revenue Trend", money(revenue), `${collectionRate}% collected`, revenueSeries, "green", "payments", ""],
    ["Vehicle Orders", orderCount, "last 7 journey days", orderSeries, "amber", "trips", "all"],
    ["Dispatched Now", dispatched, `${active} active journeys`, tripSeries, "", "trips", "dispatched"],
  ];

  return (
    <div
      id="analytics-strip"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: 12,
      }}
    >
      {cards.map(([label, value, delta, series, tone, view, status]) => (
        <article
          key={label}
          className="card trend-card"
          style={{ cursor: "pointer" }}
          data-open-view={view}
          onClick={() => onOpenView(view, status || undefined)}
        >
          <div className="trend-head">
            <div>
              <div className="trend-label">{label}</div>
              <div className="trend-value">{String(value)}</div>
            </div>
            <span className="trend-delta">{delta}</span>
          </div>
          <Sparkline series={series} tone={tone} />
          <div className="spark-meta">
            <span>{startLabel}</span>
            <span>{endLabel}</span>
          </div>
        </article>
      ))}
    </div>
  );
}
