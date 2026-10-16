"use client";

import { useMemo, useState } from "react";
import {
  getDailySeries,
  getJourneyDestinations,
  getOrderCount,
  money,
  normalizeState,
  percentOf,
  stateLabel,
} from "@/lib/formatters";
import type { Trip } from "@/types/trip";
import type { DashboardSnapshot } from "@/types/dashboard";

interface AnalyticsStripProps {
  data: DashboardSnapshot;
  trips: Trip[];
  onOpenView: (view: string, status?: string) => void;
}

type MetricMode = "revenue" | "orders" | "profit";

const chartLabels: Record<MetricMode, string> = {
  revenue: "Revenue",
  orders: "Orders",
  profit: "Net Profit",
};

const compactNumber = (value: number) =>
  new Intl.NumberFormat("en-ET", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

function AreaChart({ series, tone }: { series: [string, number][]; tone: MetricMode }) {
  const max = Math.max(1, ...series.map(([, value]) => Math.max(0, value)));
  const points = series.map(([, value], index) => {
    const x = series.length === 1 ? 50 : (index / (series.length - 1)) * 100;
    const y = 82 - percentOf(Math.max(0, value), max) * 0.68;
    return `${x},${y}`;
  });
  const area = `0,92 ${points.join(" ")} 100,92`;

  return (
    <div className={`cockpit-chart ${tone}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`fleet-area-${tone}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.52" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        {[20, 40, 60, 80].map((y) => (
          <line key={y} x1="0" x2="100" y1={y} y2={y} className="cockpit-chart-grid" />
        ))}
        <polygon points={area} fill={`url(#fleet-area-${tone})`} />
        <polyline points={points.join(" ")} fill="none" className="cockpit-chart-line" />
        {points.map((point, index) => {
          const [x, y] = point.split(",");
          const [label, value] = series[index] || ["", 0];
          return (
            <circle key={`${point}-${index}`} cx={x} cy={y} r="1.8" className="cockpit-chart-dot">
              <title>{`${label}: ${value.toLocaleString("en-ET")}`}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}

function TwinLineChart({ primary, secondary }: { primary: [string, number][]; secondary: [string, number][] }) {
  const max = Math.max(1, ...primary.map(([, value]) => value), ...secondary.map(([, value]) => value));
  const toPoints = (series: [string, number][]) =>
    series.map(([, value], index) => {
      const x = series.length === 1 ? 50 : (index / (series.length - 1)) * 100;
      const y = 84 - percentOf(value, max) * 0.68;
      return `${x},${y}`;
    });
  const primaryPoints = toPoints(primary);
  const secondaryPoints = toPoints(secondary);

  return (
    <div className="neon-twin-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {[24, 42, 60, 78].map((y) => (
          <line key={y} x1="0" x2="100" y1={y} y2={y} className="cockpit-chart-grid" />
        ))}
        <polyline points={primaryPoints.join(" ")} fill="none" className="neon-line-cyan" />
        <polyline points={secondaryPoints.join(" ")} fill="none" className="neon-line-pink" />
        {primaryPoints.map((point, index) => {
          const [x, y] = point.split(",");
          const [label, value] = primary[index] || ["", 0];
          return (
            <circle key={`p-${point}-${index}`} cx={x} cy={y} r="1.5" className="neon-dot-cyan">
              <title>{`Revenue ${label}: ${value.toLocaleString("en-ET")}`}</title>
            </circle>
          );
        })}
        {secondaryPoints.map((point, index) => {
          const [x, y] = point.split(",");
          const [label, value] = secondary[index] || ["", 0];
          return (
            <circle key={`s-${point}-${index}`} cx={x} cy={y} r="1.5" className="neon-dot-pink">
              <title>{`Orders ${label}: ${value.toLocaleString("en-ET")}`}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}

function RingGauge({ value, label, tip }: { value: number; label: string; tip?: string }) {
  const radius = 42;
  const circumference = Math.PI * 2 * radius;

  return (
    <div className="cockpit-ring" title={tip || `${label}: ${value}%`} data-tip={tip || `${label}: ${value}%`}>
      <svg viewBox="0 0 110 110" aria-hidden="true">
        <circle cx="55" cy="55" r={radius} className="cockpit-ring-track" />
        <circle
          cx="55"
          cy="55"
          r={radius}
          className="cockpit-ring-value"
          strokeDasharray={`${(Math.max(0, Math.min(100, value)) / 100) * circumference} ${circumference}`}
          transform="rotate(-90 55 55)"
        />
      </svg>
      <div className="cockpit-ring-center">
        <strong>{value}%</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

export default function AnalyticsStrip({ data, trips, onOpenView }: AnalyticsStripProps) {
  const [metricMode, setMetricMode] = useState<MetricMode>("revenue");
  const payment = data.payment_summary ?? {};

  const analytics = useMemo(() => {
    const statusCounts = new Map<string, number>();
    let revenue = 0;
    let expense = 0;
    let paid = Number(payment.customer_paid_total || 0);
    let pending = Number(payment.customer_pending_total || 0);
    let gpsReady = 0;
    let orderCount = 0;
    const routeTotals = new Map<string, { label: string; count: number; revenue: number }>();
    const locationTotals = new Map<string, { label: string; count: number }>();

    trips.forEach((trip) => {
      const state = normalizeState(trip.status || trip.state);
      statusCounts.set(state, (statusCounts.get(state) || 0) + 1);
      revenue += Number(trip.total_revenue || 0);
      expense += Number(trip.total_expense || 0);
      orderCount += getOrderCount(trip);
      if (trip.mayet_latitude != null && trip.mayet_longitude != null) gpsReady += 1;

      const routeLabel = getJourneyDestinations(trip);
      const route = routeTotals.get(routeLabel) || { label: routeLabel, count: 0, revenue: 0 };
      route.count += 1;
      route.revenue += Number(trip.total_revenue || 0);
      routeTotals.set(routeLabel, route);

      const locationLabel =
        trip.current_location ||
        trip.current_location_note ||
        trip.mayet_address ||
        trip.destination ||
        "Pending location";
      const location = locationTotals.get(locationLabel) || { label: locationLabel, count: 0 };
      location.count += 1;
      locationTotals.set(locationLabel, location);
    });

    if (!paid && !pending) {
      paid = trips.reduce((sum, trip) => sum + Number(trip.paid_amount || 0), 0);
      pending = trips.reduce((sum, trip) => sum + Number(trip.pending_payment || 0), 0);
    }

    const active =
      (statusCounts.get("available") || 0) +
      (statusCounts.get("assigned") || 0) +
      (statusCounts.get("dispatched") || 0);
    const collectionRate = paid + pending ? Math.round((paid / (paid + pending)) * 100) : 0;
    const utilization = trips.length ? Math.round((active / trips.length) * 100) : 0;
    const gpsRate = trips.length ? Math.round((gpsReady / trips.length) * 100) : 0;
    const routes = Array.from(routeTotals.values())
      .sort((a, b) => b.revenue - a.revenue || b.count - a.count)
      .slice(0, 5);
    const locations = Array.from(locationTotals.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);

    return {
      active,
      collectionRate,
      expense,
      gpsRate,
      locations,
      orderCount,
      paid,
      pending,
      profit: revenue - expense,
      revenue,
      routes,
      statusCounts,
      utilization,
    };
  }, [payment.customer_paid_total, payment.customer_pending_total, trips]);

  const chartSeries = useMemo(() => {
    if (metricMode === "orders") return getDailySeries(trips, (trip) => getOrderCount(trip));
    if (metricMode === "profit") {
      return getDailySeries(trips, (trip) => Number(trip.total_revenue || 0) - Number(trip.total_expense || 0));
    }
    return getDailySeries(trips, (trip) => Number(trip.total_revenue || 0));
  }, [metricMode, trips]);
  const revenueSeries = useMemo(() => getDailySeries(trips, (trip) => Number(trip.total_revenue || 0)), [trips]);
  const orderSeries = useMemo(() => getDailySeries(trips, (trip) => getOrderCount(trip)), [trips]);

  const chartTotal = chartSeries.reduce((sum, [, value]) => sum + Number(value || 0), 0);
  const maxRouteRevenue = Math.max(1, ...analytics.routes.map((route) => route.revenue));
  const statusItems = useMemo(() => {
    const fromDatabase = Array.isArray(data.journeys_by_status)
      ? data.journeys_by_status
          .map((item) => {
            const rawStatus = String(item.state || item.status || "draft").trim() || "draft";
            return {
              count: Number(item.count || 0),
              filter: normalizeState(rawStatus),
              key: rawStatus,
              label: stateLabel(rawStatus),
            };
          })
          .filter((item) => item.count > 0)
      : [];

    if (fromDatabase.length) {
      return fromDatabase.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    }

    return Array.from(analytics.statusCounts.entries())
      .map(([status, count]) => ({
        count,
        filter: normalizeState(status),
        key: status,
        label: stateLabel(status),
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [analytics.statusCounts, data.journeys_by_status]);

  const recentOps = [...trips]
    .sort((a, b) => String(b.write_date || b.departure_date || "").localeCompare(String(a.write_date || a.departure_date || "")))
    .slice(0, 4);

  return (
    <section className="dashboard-cockpit neon-dashboard" aria-label="Fleet live analytics">
      <div className="neon-infographic-grid">
        <article className="neon-tile neon-line" data-tip={`Revenue ${money(analytics.revenue)} / Orders ${analytics.orderCount}`}>
          <div className="neon-title">Revenue & Orders</div>
          <div className="neon-subtitle">Last dated periods</div>
          <TwinLineChart primary={revenueSeries} secondary={orderSeries} />
          <div className="cockpit-chart-labels">
            {revenueSeries.map(([label, value]) => (
              <span key={label} title={`${label}: ${value.toLocaleString("en-ET")}`}>{label.slice(5)}</span>
            ))}
          </div>
        </article>

        <article className="neon-tile neon-mini-bars" data-tip={`Orders: ${analytics.orderCount}`}>
          <div className="neon-title">Orders</div>
          <div className="neon-subtitle">{trips.length} journey groups</div>
          <div className="neon-vertical-bars">
            {orderSeries.slice(-6).map(([label, value], index) => (
              <i key={`${label}-${index}`} title={`${label}: ${value.toLocaleString("en-ET")}`} style={{ height: `${Math.max(16, percentOf(value, Math.max(1, ...orderSeries.map(([, v]) => v))))}%` }} />
            ))}
          </div>
        </article>

        <article className="neon-tile neon-wave" data-tip={`${chartLabels[metricMode]} total: ${metricMode === "orders" ? chartTotal : money(chartTotal)}`}>
          <div className="neon-wave-head">
            <div>
              <div className="neon-title">{chartLabels[metricMode]} Flow</div>
              <div className="neon-subtitle">{analytics.active} active journeys</div>
            </div>
            <div className="cockpit-segments" aria-label="Chart metric">
              {(["revenue", "orders", "profit"] as MetricMode[]).map((mode) => (
                <button key={mode} type="button" className={metricMode === mode ? "active" : ""} onClick={() => setMetricMode(mode)}>
                  {chartLabels[mode]}
                </button>
              ))}
            </div>
          </div>
          <AreaChart series={chartSeries} tone={metricMode} />
        </article>

        <article className="neon-tile neon-ring-tile">
          <RingGauge value={analytics.utilization} label="Active" tip={`Active journeys: ${analytics.active} of ${trips.length}`} />
          <button type="button" onClick={() => onOpenView("trips", "active")} className="neon-ring-caption" title={`Active journeys: ${analytics.active}`}>
            Active Fleet
          </button>
        </article>

        <article className="neon-tile neon-number-bars">
          <div>
            <div className="neon-title">Revenue</div>
            <strong title={money(analytics.revenue)}>{compactNumber(analytics.revenue)}</strong>
            <i style={{ width: "100%" }} />
          </div>
          <div>
            <div className="neon-title">Net Profit</div>
            <strong title={money(analytics.profit)}>{compactNumber(analytics.profit)}</strong>
            <i style={{ width: `${percentOf(Math.max(0, analytics.profit), Math.max(1, analytics.revenue))}%` }} />
          </div>
        </article>

        <article className="neon-tile neon-ring-tile">
          <RingGauge value={analytics.collectionRate} label="Paid" tip={`Paid ${money(analytics.paid)} / Pending ${money(analytics.pending)}`} />
          <button type="button" onClick={() => onOpenView("payments")} className="neon-ring-caption" title={`Paid ${money(analytics.paid)} / Pending ${money(analytics.pending)}`}>
            Collection
          </button>
        </article>

        <article className="neon-tile neon-number-bars">
          <div>
            <div className="neon-title">Paid</div>
            <strong title={money(analytics.paid)}>{compactNumber(analytics.paid)}</strong>
            <i style={{ width: `${analytics.collectionRate}%` }} />
          </div>
          <div>
            <div className="neon-title">Pending</div>
            <strong title={money(analytics.pending)}>{compactNumber(analytics.pending)}</strong>
            <i style={{ width: `${percentOf(analytics.pending, analytics.paid + analytics.pending || 1)}%` }} />
          </div>
        </article>

        <article className="neon-tile neon-calendar">
          <div className="neon-title">Status Board</div>
          <div className="neon-subtitle">Live database statuses · click any cell to filter</div>
          <div className="neon-week">
            {statusItems.map((status) => (
              <button key={status.key} type="button" onClick={() => onOpenView("trips", status.filter)} title={`${status.label}: ${status.count}`} data-tip={`${status.label}: ${status.count}`}>
                <span className="status-full-name">{status.label}</span>
                <strong>{status.count}</strong>
              </button>
            ))}
          </div>
        </article>

        <article className="neon-tile neon-bars">
          <div className="neon-title">Top Routes</div>
          <div className="cockpit-route-list">
            {analytics.routes.map((route) => (
              <button key={route.label} type="button" onClick={() => onOpenView("trips", "all")} title={`${route.label}: ${money(route.revenue)}`} data-tip={`${route.label}: ${money(route.revenue)}`}>
                <span>{route.label}</span>
                <strong>{money(route.revenue)}</strong>
                <i style={{ width: `${percentOf(route.revenue, maxRouteRevenue)}%` }} />
              </button>
            ))}
          </div>
        </article>

        <article className="neon-tile neon-feed">
          <div className="neon-title">Recent Activity</div>
          <div className="neon-slider-list">
            {recentOps.map((trip) => (
              <a key={trip.id} href={`/detail?journey_id=${encodeURIComponent(String(trip.id))}`} data-tip={`${trip.vehicle_plate || `Trip ${trip.id}`} · ${trip.driver_name || "Unassigned"} · ${stateLabel(trip.status || trip.state)}`}>
                <span>{trip.vehicle_plate || `Trip ${trip.id}`}</span>
                <i style={{ width: `${percentOf(Number(trip.total_revenue || 0), Math.max(1, analytics.revenue))}%` }} />
                <strong>{stateLabel(trip.status || trip.state)}</strong>
              </a>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
