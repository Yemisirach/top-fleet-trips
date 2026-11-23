"use client";

import { useMemo } from "react";
import {
  getJourneyDestinations,
  getOrderCount,
  money,
  normalizeState,
  percentOf,
  stateLabel,
} from "@/lib/formatters";
import type { DailyProfit, PaymentRequest, Trip } from "@/types/trip";
import type { DashboardSnapshot } from "@/types/dashboard";

interface AnalyticsStripProps {
  data: DashboardSnapshot;
  trips: Trip[];
  paymentRequests?: PaymentRequest[];
  dailyTotals?: DailyProfit["totals"] | null;
  period: OverviewPeriod;
  focusDate?: string;
  onOpenView: (view: string, status?: string, extra?: { route?: string; scoped?: boolean }) => void;
}

type MetricMode = "revenue" | "orders";
export type OverviewPeriod = "daily" | "weekly" | "month" | "yearly";

const ADDIS_TIME_ZONE = "Africa/Addis_Ababa";

function tripDate(trip: Trip): Date | null {
  const raw = trip.departure_date || trip.create_date || trip.arrival_date;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function weekKey(date: Date): string {
  const year = date.getUTCFullYear();
  const week = Math.ceil((((date.getTime() - Date.UTC(year, 0, 1)) / 86400000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function filled(keys: string[], buckets: Map<string, number>): [string, number][] {
  return keys.map((key) => [key, buckets.get(key) || 0]);
}

function addisParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ADDIS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return { year: value("year"), month: value("month"), day: value("day") };
}

function addisDayKey(date: Date): string {
  const parts = addisParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addisDateUtc(date: Date): Date {
  const parts = addisParts(date);
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

function addisWeekKey(date: Date): string {
  return weekKey(addisDateUtc(date));
}

function addisMonthKey(date: Date): string {
  const parts = addisParts(date);
  return `${parts.year}-${parts.month}`;
}

export function addisTodayKey(now = new Date()): string {
  return addisDayKey(now);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function overviewFocusDate(value?: string): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const safeDay = Math.min(day, daysInMonth(year, month));
    return new Date(Date.UTC(year, month - 1, safeDay, 12));
  }
  return new Date();
}

export function overviewPeriodLabel(period: OverviewPeriod, focus = new Date()): string {
  const parts = addisParts(focus);
  const monthName = new Intl.DateTimeFormat("en-GB", { timeZone: ADDIS_TIME_ZONE, month: "short" }).format(focus);
  if (period === "yearly") return parts.year;
  if (period === "month") return `${monthName} ${parts.year}`;
  if (period === "weekly") return `Week of ${parts.day} ${monthName} ${parts.year}`;
  return `${parts.day} ${monthName} ${parts.year}`;
}

export function tripInCurrentPeriod(trip: Trip, period: OverviewPeriod, now = new Date()): boolean {
  const date = tripDate(trip);
  if (!date) return false;
  if (period === "yearly") return addisParts(date).year === addisParts(now).year;
  if (period === "month") return addisMonthKey(date) === addisMonthKey(now);
  if (period === "weekly") return addisWeekKey(date) === addisWeekKey(now);
  return addisDayKey(date) === addisDayKey(now);
}

function periodSeries(
  trips: Trip[],
  period: OverviewPeriod,
  valueGetter: (trip: Trip) => number,
  now = new Date(),
): [string, number][] {
  const buckets = new Map<string, number>();
  trips.forEach((trip) => {
    const date = tripDate(trip);
    if (!date) return;
    const key = period === "yearly"
      ? addisParts(date).year
      : period === "month"
        ? addisMonthKey(date)
        : period === "weekly"
          ? addisWeekKey(date)
          : addisDayKey(date);
    buckets.set(key, (buckets.get(key) || 0) + Number(valueGetter(trip) || 0));
  });
  const today = addisDateUtc(now);
  if (period === "daily") {
    return filled(Array.from({ length: 14 }, (_, index) => {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - (13 - index));
      return date.toISOString().slice(0, 10);
    }), buckets);
  }
  if (period === "weekly") {
    return filled(Array.from({ length: 12 }, (_, index) => {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - (11 - index) * 7);
      return weekKey(date);
    }), buckets);
  }
  if (period === "month") {
    return filled(Array.from({ length: 12 }, (_, index) => {
      const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (11 - index), 1));
      return date.toISOString().slice(0, 7);
    }), buckets);
  }
  const currentYear = Number(addisParts(now).year);
  const years = Array.from(buckets.keys()).map(Number).filter((year) => !Number.isNaN(year));
  const start = Math.min(currentYear - 4, years.length ? Math.min(...years) : currentYear);
  const end = Math.max(currentYear, years.length ? Math.max(...years) : currentYear);
  return filled(Array.from({ length: end - start + 1 }, (_, index) => String(start + index)), buckets);
}

function shortPeriodLabel(label: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label.slice(5);
  if (/^\d{4}-W\d{2}$/.test(label)) return label.slice(5);
  if (/^\d{4}-\d{2}$/.test(label)) return label.slice(5);
  return label;
}

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
              <title>{`${label}: ${tone === "orders" ? value.toLocaleString("en-ET") : money(value)}`}</title>
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

function requestExpenseAmount(request: PaymentRequest): number {
  const lines = request.line_items || [];
  if (lines.length) {
    return lines.reduce((sum, line) => sum + Number(line.total ?? (Number(line.amount || 0) * Number(line.quantity || 1))), 0);
  }
  return Number(request.total_amount || 0);
}

export default function AnalyticsStrip({ data, trips, paymentRequests = [], dailyTotals = null, period, focusDate, onOpenView }: AnalyticsStripProps) {
  const payment = data.payment_summary ?? {};
  const focus = overviewFocusDate(focusDate);
  const periodLabel = overviewPeriodLabel(period, focus);
  const chartLabel = period === "weekly" ? "Weekly" : period === "month" ? "Monthly" : period === "yearly" ? "Yearly" : "Daily";

  const analytics = useMemo(() => {
    const statusCounts = new Map<string, number>();
    let revenue = Number(payment.receivable_total || 0);
    let expense = 0;
    let pending = Number(payment.customer_pending_total || 0);
    let gpsReady = 0;
    let orderCount = 0;
    const routeTotals = new Map<string, { label: string; count: number; revenue: number }>();
    const locationTotals = new Map<string, { label: string; count: number }>();

    trips.forEach((trip) => {
      const state = normalizeState(trip.status || trip.state);
      statusCounts.set(state, (statusCounts.get(state) || 0) + 1);
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

    if (!pending) {
      pending = trips.reduce((sum, trip) => sum + Number(trip.pending_payment || 0), 0);
    }

    const active =
      (statusCounts.get("available") || 0) +
      (statusCounts.get("assigned") || 0) +
      (statusCounts.get("dispatched") || 0);
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

      expense,
      gpsRate,
      locations,
      orderCount,
      pending,
      profit: revenue - expense,
      revenue,
      routes,
      statusCounts,
      utilization,
    };
  }, [payment.customer_pending_total, payment.receivable_total, trips]);

  const periodTrips = useMemo(
    () => trips.filter((trip) => tripInCurrentPeriod(trip, period, focus)),
    [focusDate, period, trips],
  );
  const journeyRevenue = periodTrips.reduce((sum, trip) => sum + Number(trip.total_revenue || 0), 0);
  const journeyExpense = periodTrips.reduce((sum, trip) => sum + Number(trip.total_expense || 0), 0);
  const paymentExpense = paymentRequests
    .filter((request) => String(request.state || "").toLowerCase() !== "cancelled")
    .filter((request) => tripInCurrentPeriod({ departure_date: request.date || request.approved_on } as Trip, period, focus))
    .reduce((sum, request) => sum + requestExpenseAmount(request), 0);
  const useDailyReport = period === "daily";
  const periodRevenue = useDailyReport ? Number(dailyTotals?.revenue_total || 0) : journeyRevenue;
  const periodExpense = useDailyReport ? Number(dailyTotals?.cost_total || 0) : (journeyExpense || paymentExpense);
  const periodProfit = useDailyReport ? Number(dailyTotals?.net_profit_total || 0) : periodRevenue - periodExpense;
  const periodRoutes = useMemo(() => {
    const routeTotals = new Map<string, { label: string; count: number; revenue: number }>();
    periodTrips.forEach((trip) => {
      const routeLabel = getJourneyDestinations(trip);
      const route = routeTotals.get(routeLabel) || { label: routeLabel, count: 0, revenue: 0 };
      route.count += 1;
      route.revenue += Number(trip.total_revenue || 0);
      routeTotals.set(routeLabel, route);
    });
    return Array.from(routeTotals.values())
      .sort((a, b) => b.revenue - a.revenue || b.count - a.count)
      .slice(0, 5);
  }, [periodTrips]);
  const bars = useMemo(
    () => periodSeries(trips, period, (trip) => Number(trip.total_revenue || 0), focus),
    [focusDate, period, trips],
  );
  const barTotal = bars.reduce((sum, [, value]) => sum + Number(value || 0), 0);
  const revenueSeries = bars;
  const orderSeries = useMemo(
    () => periodSeries(trips, period, (trip) => getOrderCount(trip), focus),
    [focusDate, period, trips],
  );

  const maxRouteRevenue = Math.max(1, ...periodRoutes.map((route) => route.revenue));
  const statusItems = useMemo(() => {
    const counts = new Map<string, { count: number; filter: string; key: string; label: string }>();
    periodTrips.forEach((trip) => {
      const rawStatus = String(trip.status || trip.state || "draft").trim() || "draft";
      const filter = normalizeState(rawStatus);
      const current = counts.get(filter) || { count: 0, filter, key: filter, label: stateLabel(rawStatus) };
      current.count += 1;
      counts.set(filter, current);
    });
    return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [periodTrips]);

  const recentOps = [...periodTrips]
    .sort((a, b) => String(b.write_date || b.departure_date || "").localeCompare(String(a.write_date || a.departure_date || "")))
    .slice(0, 4);

  return (
    <section className="dashboard-cockpit neon-dashboard" aria-label="Fleet live analytics">
      <div className="neon-infographic-grid">
        <article className="neon-tile neon-line" data-tip={`Revenue ${money(analytics.revenue)} / Orders ${analytics.orderCount}`}>
          <div className="neon-title">Revenue & Orders</div>
          <div className="neon-subtitle">{chartLabel}</div>
          <TwinLineChart primary={revenueSeries} secondary={orderSeries} />
          <div className="cockpit-chart-labels">
            {revenueSeries.map(([label, value]) => (
              <span key={label} title={`${label}: ${value.toLocaleString("en-ET")}`}>{label.slice(5)}</span>
            ))}
          </div>
        </article>

        <article className="neon-tile neon-mini-bars" data-tip={`Orders: ${analytics.orderCount}`}>
          <div className="neon-title">Orders</div>
          <div className="neon-subtitle">{chartLabel}</div>
          <div className="neon-vertical-bars">
            {orderSeries.slice(-6).map(([label, value], index) => (
              <i key={`${label}-${index}`} title={`${label}: ${value.toLocaleString("en-ET")}`} style={{ height: `${Math.max(16, percentOf(value, Math.max(1, ...orderSeries.map(([, v]) => v))))}%` }} />
            ))}
          </div>
        </article>

        <article className="neon-tile neon-wave" data-tip={`Revenue Bars: ${money(barTotal)}`}>
          <div className="neon-wave-head">
            <div>
              <div className="neon-title">Revenue Bars</div>
              <div className="neon-subtitle">{chartLabel} · hover a point for the period total</div>
            </div>
          </div>
          <AreaChart series={bars} tone="revenue" />
          <div className="cockpit-chart-labels">
            {bars.map(([label, value], index) => {
              const step = Math.max(1, Math.ceil(bars.length / 7));
              const visible = index % step === 0 || index === bars.length - 1;
              return (
                <span key={label} title={`${label}: ${money(value)}`} style={{ visibility: visible ? "visible" : "hidden" }}>
                  {shortPeriodLabel(label)}
                </span>
              );
            })}
          </div>
        </article>

        <article className="neon-tile neon-ring-tile">
          <RingGauge value={analytics.utilization} label="Active" tip={`Active journeys: ${analytics.active} of ${trips.length}`} />
          <button type="button" onClick={() => onOpenView("trips", "active")} className="neon-ring-caption" title={`Active journeys: ${analytics.active}`}>
            Active Fleet
          </button>
        </article>

        <article className="neon-tile neon-number-bars">
          <div className="neon-period-span">
            <div className="neon-title">Stored trip amounts</div>
            <div className="neon-subtitle">{periodLabel}</div>
          </div>
          <button type="button" className="neon-jump" onClick={() => onOpenView("finance")}>
            <div className="neon-title">Revenue</div>
            <strong title={money(periodRevenue)}>{compactNumber(periodRevenue)}</strong>
            <i style={{ width: "100%" }} />
          </button>
          <button type="button" className="neon-jump" onClick={() => onOpenView("payments")}>
            <div className="neon-title">Total Expense</div>
            <strong title={money(periodExpense)}>{compactNumber(periodExpense)}</strong>
            <i style={{ width: `${percentOf(periodExpense, Math.max(1, periodRevenue))}%` }} />
          </button>
          <button type="button" className="neon-jump" onClick={() => onOpenView("reports")}>
            <div className="neon-title">Net Profit</div>
            <strong title={money(periodProfit)}>{compactNumber(periodProfit)}</strong>
            <i style={{ width: `${percentOf(Math.abs(periodProfit), Math.max(1, periodRevenue))}%` }} />
          </button>
        </article>

        <article className="neon-tile neon-calendar">
          <div className="neon-title">Status Board</div>
          <div className="neon-subtitle">{periodLabel} · click a status to open those journeys</div>
          <div className="neon-week">
            {statusItems.length === 0 && <div className="neon-subtitle">No journeys for {periodLabel}.</div>}
            {statusItems.map((status) => (
              <button key={status.key} type="button" onClick={() => onOpenView("trips", status.filter, { scoped: true })} title={`${status.label}: ${status.count}`} data-tip={`${status.label}: ${status.count}`}>
                <span className="status-full-name">{status.label}</span>
                <strong>{status.count}</strong>
              </button>
            ))}
          </div>
        </article>

        <article className="neon-tile neon-bars">
          <div className="neon-title">Top Routes</div>
          <div className="neon-subtitle">{periodLabel}</div>
          <div className="cockpit-route-list">
            {periodRoutes.map((route) => (
              <button key={route.label} type="button" onClick={() => onOpenView("trips", "all", { scoped: true, route: route.label })} title={`${route.label}: ${money(route.revenue)}`} data-tip={`${route.label}: ${money(route.revenue)}`}>
                <span>{route.label}</span>
                <strong>{money(route.revenue)}</strong>
                <i style={{ width: `${percentOf(route.revenue, maxRouteRevenue)}%` }} />
              </button>
            ))}
          </div>
        </article>

        <article className="neon-tile neon-feed">
          <div className="neon-title">Recent Activity</div>
          <div className="neon-subtitle">{periodLabel}</div>
          <div className="neon-slider-list">
            {recentOps.map((trip) => (
              <a key={trip.id} href={`/detail?journey_id=${encodeURIComponent(String(trip.id))}`} data-tip={`${trip.vehicle_plate || `Trip ${trip.id}`} · ${trip.driver_name || "Unassigned"} · ${stateLabel(trip.status || trip.state)}`}>
                <span>{trip.vehicle_plate || `Trip ${trip.id}`}</span>
                <i style={{ width: `${percentOf(Number(trip.total_revenue || 0), Math.max(1, periodRevenue))}%` }} />
                <strong>{stateLabel(trip.status || trip.state)}</strong>
              </a>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
