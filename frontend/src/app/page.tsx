"use client";
import { Fragment, useEffect, useState, useMemo, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Map, PanelRightOpen } from "lucide-react";
import Sidebar, { type SidebarView } from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";
import AnalyticsStrip from "@/components/dashboard/AnalyticsStrip";
import TripCard from "@/components/dashboard/TripCard";
import TripTable from "@/components/dashboard/TripTable";
import { useDashboard } from "@/hooks/useDashboard";
import { useTheme } from "@/hooks/useTheme";
import { buildJourneyRoute, buildMayetUrl, displayLocation, mayetSearchTerm, money, normalizeState, stateLabel, paymentLabel, tripDisplayName } from "@/lib/formatters";
import { copyTextToClipboard } from "@/lib/clipboard";
import { fetchJson, API_BASE } from "@/lib/api";
import type { Trip } from "@/types/trip";

const DashboardMap = dynamic(
  () => import("@/components/dashboard/DashboardMap"),
  { ssr: false }
);

function CompactLocation({ value }: { value: string }) {
  const text = String(value || "").trim();
  if (!text) return <span className="muted">–</span>;
  const words = text.split(/\s+/);
  if (words.length <= 2 && text.length <= 24) return <span>{text}</span>;
  return (
    <details className="gps-note-compact">
      <summary>{words.slice(0, 2).join(" ")}...</summary>
      <div>{text}</div>
    </details>
  );
}

function tripLineLabel(item?: string, description?: string) {
  const itemText = String(item || "").trim();
  const descriptionText = String(description || "").trim();
  const raw = /^line\s+\d+$/i.test(itemText)
    ? descriptionText
    : itemText || descriptionText || "Item";
  return raw
    .replace(/^cancelled\s+request:\s*/i, "")
    .replace(/\s*-\s*(cancelled|canceled|posted|done)\b/gi, "")
    .trim() || "Item";
}

const VIEW_META: Record<SidebarView, [string, string]> = {
  overview: ["Overview", "Fleet summary and recent activity"],
  trips: ["Journeys", "Grouped routes and trips"],
  supervisors: ["Supervisors", "Driver and vehicle scope"],
  payments: ["Payments", "Revenue and expense overview"],
  locations: ["Locations", "Current vehicle locations"],
  map: ["Map", "Live map"],
  planner: ["Overview", "Fleet summary and recent activity"],
  reports: ["Reports", "Financial and operational reports"],
  finance: ["Finance Summary", "Daily, weekly, and monthly posted profit"],
};

function getInitialDashboardState(): { view: SidebarView; status: string } {
  if (typeof window === "undefined") return { view: "overview", status: "all" };
  const params = new URLSearchParams(window.location.search);
  const nextView = params.get("view") as SidebarView | null;
  return {
    view: nextView && VIEW_META[nextView] && nextView !== "planner" ? nextView : "overview",
    status: params.get("status") || "all",
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const { theme, toggle: toggleTheme } = useTheme();
  const { data, allTrips, loading, load } = useDashboard();
  const [view, setView] = useState<SidebarView>(() => getInitialDashboardState().view);
  const [statusFilter, setStatusFilter] = useState(() => getInitialDashboardState().status);
  const [searchValue, setSearchValue] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [expandedRawTripId, setExpandedRawTripId] = useState<string | null>(null);

  // Auth check
  useEffect(() => {
    fetchJson(`${API_BASE}/auth/me`).catch(() => router.push("/login"));
  }, [router]);

  useEffect(() => {
    load();
  }, []);

  // Filtered trips
  const filteredTrips = useMemo(() => {
    const q = searchValue.toLowerCase().trim();
    let result = allTrips;
    if (q) {
      result = result.filter((t) => {
        const destinations = Array.isArray(t.destinations) ? t.destinations.join(" ") : "";
        const legs = Array.isArray(t.trips)
          ? t.trips.map((l) => `${l.origin || ""} ${l.destination || ""} ${l.status || ""}`).join(" ")
          : "";
        const haystack = [
          t.id, t.vehicle_plate, t.vehicle_brand, t.driver_name, t.origin,
          destinations, stateLabel(t.status), t.status, t.customer_name,
          t.total_revenue, t.total_expense, t.paid_amount, t.pending_payment,
          t.current_location, t.current_location_note, paymentLabel(t), legs,
        ].join(" ").toLowerCase();
        return haystack.includes(q);
      });
    }
    if (statusFilter !== "all") {
      result = result.filter((t) => {
        const s = normalizeState(t.status);
        const isActive = ["available", "assigned", "dispatched"].includes(s);
        return s === statusFilter || (statusFilter === "active" && isActive);
      });
    }
    return result;
  }, [allTrips, searchValue, statusFilter]);

  const rawTripRows = useMemo(() => data.all_trip_rows ?? [], [data.all_trip_rows]);
  const filteredRawTripRows = useMemo(() => {
    const q = searchValue.toLowerCase().trim();
    if (!q) return rawTripRows;
    return rawTripRows.filter((t) =>
      [
        t.id,
        t.name,
        t.vehicle_plate,
        t.vehicle_id,
        t.driver_name,
        t.origin,
        t.destination,
        t.current_location,
        t.current_location_note,
        t.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rawTripRows, searchValue]);

  const supervisorRows = useMemo(() => {
    return Object.values(
      filteredTrips.reduce<Record<string, { name: string; vehicles: Set<string>; trips: number; active: number; revenue: number; expense: number }>>(
        (acc, t) => {
          const name = t.supervisor_name || t.driver_name || "";
          if (!name && t.is_vehicle_location_only) return acc;
          const rowName = name || "Unassigned supervisor";
          if (!acc[rowName]) {
            acc[rowName] = { name: rowName, vehicles: new Set(), trips: 0, active: 0, revenue: 0, expense: 0 };
          }
          acc[rowName].vehicles.add(t.vehicle_plate || "N/A");
          acc[rowName].trips++;
          acc[rowName].revenue += Number(t.total_revenue || 0);
          acc[rowName].expense += Number(t.total_expense || 0);
          if (["available", "assigned", "dispatched"].includes(normalizeState(t.status))) {
            acc[rowName].active++;
          }
          return acc;
        },
        {}
      )
    ).sort((a, b) => b.active - a.active || b.trips - a.trips || a.name.localeCompare(b.name));
  }, [filteredTrips]);

  const locationDetailRows = useMemo(() => {
    return (data.vehicle_locations || [])
      .map((row) => {
        const trip = {
          id: row.trip_id || `vehicle:${row.vehicle_id || row.vehicle_plate}`,
          vehicle_id: row.vehicle_id ? String(row.vehicle_id) : undefined,
          vehicle_plate: row.vehicle_plate,
          vehicle_brand: row.vehicle_brand,
          driver_name: row.driver_name,
          supervisor_name: row.supervisor_name,
          destination: row.destination_name,
          current_location: row.current_location_name,
          current_location_note: row.current_location_note,
          status: row.state || "available",
          state: row.state || "available",
          departure_date: row.departure_date,
          arrival_date: row.arrival_date,
          write_date: row.arrival_date || row.departure_date,
          mayet_url: undefined,
        };
        const destinations = row.destination_name || "Destination not set";
        const dbLocation =
          row.current_location_name ||
          row.current_location_note ||
          row.destination_name ||
          "Pending";
        return {
          trip,
          destinations,
          dbLocation,
        };
      })
      .sort((a, b) => {
        const aActive = ["available", "assigned", "dispatched"].includes(normalizeState(a.trip.status));
        const bActive = ["available", "assigned", "dispatched"].includes(normalizeState(b.trip.status));
        if (aActive !== bActive) return aActive ? -1 : 1;
        return String(a.trip.vehicle_plate || "").localeCompare(String(b.trip.vehicle_plate || ""));
      });
  }, [data.vehicle_locations]);

  const formatDateTime = (value?: string) => {
    if (!value) return "Not set";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleViewChange = useCallback((v: SidebarView, status?: string) => {
    if (v === "overview") { router.push("/"); setView("overview"); setStatusFilter("all"); setMobileSidebarOpen(false); return; }
    if (v === "finance" || v === ("finance" as string)) { router.push("/finance"); return; }
    if (v === "reports" || v === ("reports" as string)) { router.push("/reports"); return; }
    if (v === "payments" || v === ("payments" as string)) { router.push("/payments"); return; }
    if (v === "map" || v === ("map" as string)) { router.push("/map"); return; }
    if (v === "trips" || v === "supervisors" || v === "locations") router.push(`/?view=${v}`);
    setView(v);
    setStatusFilter(status || "all");
    setMobileSidebarOpen(false);
  }, [router]);

  const handleOpenView = useCallback((v: string, status?: string) => {
    if (v === "overview") { router.push("/"); setView("overview"); setStatusFilter("all"); return; }
    if (v === "finance") { router.push("/finance"); return; }
    if (v === "reports") { router.push("/reports"); return; }
    if (v === "map") { router.push("/map"); return; }
    if (v === "payments") { router.push("/payments"); return; }
    if (v === "trips" || v === "supervisors" || v === "locations") router.push(`/?view=${v}`);
    setView(v as SidebarView);
    setStatusFilter(status || "all");
  }, [router]);

  const [title, subtitle] = VIEW_META[view];
  const vehicleConflicts = data.vehicle_conflicts ?? [];

  return (
    <div className="app-shell">
      {/* Mobile overlay */}
      <div
        className={`overlay${mobileSidebarOpen ? " open" : ""}`}
        id="overlay"
        onClick={() => setMobileSidebarOpen(false)}
      />

      {/* Sidebar */}
      <Sidebar currentView={view} onViewChange={handleViewChange} mobileOpen={mobileSidebarOpen} />

      {/* Main */}
      <div className="app-main" id="main">
        <Topbar
          title={title}
          subtitle={subtitle}
          modeLabel={data._stale_live_cache ? "Cached Odoo" : undefined}
          modeWarning={data._stale_live_cache ? undefined : data._warning}
          theme={theme}
          onThemeToggle={toggleTheme}
          onMenuClick={() => setMobileSidebarOpen((o) => !o)}
          searchValue={searchValue}
          onSearchChange={setSearchValue}
        />

        <div
          className={`main-content fleet-page ${
            view === "overview" ? (theme === "dark" ? "dashboard-dark-page" : "dashboard-light-page") : ""
          }`}
          style={{ display: "grid", gap: 24 }}
        >
          {loading && (
            <div className="empty" style={{ padding: "48px 0", fontSize: 16 }}>
              Loading dashboard…
            </div>
          )}

          {/* ── Overview ── */}
          {view === "overview" && !loading && (
            <>
              <AnalyticsStrip data={data} trips={filteredTrips} onOpenView={handleOpenView} />

              {/* Recent trip table + financial summary */}
              <div className="grid grid-cols-1 lg:grid-cols-[3fr,1fr] gap-4">
                <div className="panel">
                  <div className="panel-header">
                    <div className="panel-title">Recent Journeys</div>
                  </div>
                  <div className="journey-table-panel-body overflow-x-auto">
                    <TripTable trips={filteredTrips} limit={10} />
                  </div>
                </div>
              </div>

              <div className="panel dashboard-location-panel">
                <div className="panel-header dashboard-location-header">
                  <div>
                    <div className="panel-title">DB Current Locations</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                      {locationDetailRows.length} journeys with DB current location, destination, last update, and detail links
                    </div>
                  </div>
                </div>
                <div className="dashboard-location-table-wrap dashboard-location-table-scroll">
                  <table className="fleet-table dashboard-location-table">
                    <thead>
                      <tr>
                        {["Vehicle", "Driver", "DB Current", "Destination", "Last Update", "State", "Actions"].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {locationDetailRows.map(({ trip, destinations, dbLocation }) => {
                        const plate = trip.vehicle_plate || String(trip.vehicle_id || trip.id);
                        const tripId = String(trip.id);
                        const mayetSearch = mayetSearchTerm(plate);
                        return (
                          <tr key={`${trip.id}-${plate}`}>
                            <td><strong>{plate}</strong></td>
                            <td>{trip.driver_name || "Unassigned driver"}</td>
                            <td>{dbLocation}</td>
                            <td>{destinations}</td>
                            <td>{formatDateTime(trip.write_date || trip.departure_date)}</td>
                            <td><span className={`pill ${normalizeState(trip.status)}`}>{stateLabel(trip.status)}</span></td>
                            <td>
                              <div className="dashboard-location-table-actions">
                                <a className="fleet-btn" href={`/map?journey_id=${encodeURIComponent(tripId)}&vehicle=${encodeURIComponent(plate)}`}>
                                  Map
                                </a>
                                <a className="fleet-btn" href={`/detail?journey_id=${encodeURIComponent(tripId)}`}>
                                  Detail
                                </a>
                                <a
                                  className="fleet-btn fleet-btn-secondary"
                                  href={buildMayetUrl(trip.mayet_url, plate, tripId)}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={() => mayetSearch && void copyTextToClipboard(mayetSearch)}
                                  title={`Copies ${mayetSearch} before opening Mayet`}
                                >
                                  Mayet
                                </a>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {locationDetailRows.length === 0 && (
                        <tr>
                          <td colSpan={9} className="empty">No journey location details found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {vehicleConflicts.length > 0 && (
                <div className="panel driver-conflict-panel">
                  <div className="panel-header">
                    <div>
                      <div className="panel-title">Vehicle Assignment Conflicts</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                        Active Odoo trips where one vehicle appears with more than one driver.
                      </div>
                    </div>
                    <span className="pill cancelled">{vehicleConflicts.length} conflicts</span>
                  </div>
                  <div className="panel-body driver-conflict-list">
                    {vehicleConflicts.slice(0, 6).map((conflict) => (
                      <div key={conflict.vehicle_plate} className="driver-conflict-row">
                        <div>
                          <strong>{conflict.vehicle_plate}</strong>
                          <span>{conflict.driver_count} drivers active now</span>
                        </div>
                        <div className="driver-conflict-vehicles">
                          {conflict.drivers.map((driver) => (
                            <button
                              key={driver}
                              type="button"
                              className="fleet-btn"
                              onClick={() => setSearchValue(driver)}
                            >
                              {driver}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </>
          )}

          {/* ── Supervisors ── */}
          {view === "supervisors" && !loading && (
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title">Supervisors</div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="fleet-table" id="supervisor-table">
                  <thead>
                    <tr>
                      {["Supervisor", "Vehicles", "Trips", "Active Scope", "Revenue", "Expense", "Net"].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {supervisorRows.map((row) => {
                      const net = row.revenue - row.expense;
                      return (
                        <tr key={row.name}>
                          <td>{row.name}</td>
                          <td>{Array.from(row.vehicles).join(", ")}</td>
                          <td>{row.trips}</td>
                          <td>
                            {row.active > 0 ? (
                              <span className="pill green">{row.active} Active</span>
                            ) : (
                              <span className="pill muted">Idle</span>
                            )}
                          </td>
                          <td className="green">{money(row.revenue)}</td>
                          <td className="red">{money(row.expense)}</td>
                          <td className={net >= 0 ? "green" : "red"}>{money(net)}</td>
                        </tr>
                      );
                    })}
                    {supervisorRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="empty">No supervisors match this view.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Trips ── */}
          {view === "trips" && !loading && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <h2 id="trips-title" style={{ fontWeight: 900, fontSize: 18, margin: 0 }}>
                  {statusFilter === "trip_rows" ? "All Trips" : statusFilter === "active" ? "Active Journeys" : "Journeys"}
                </h2>
                <span id="search-meta" className="muted" style={{ fontSize: 13 }}>
                  {statusFilter === "trip_rows"
                    ? `${filteredRawTripRows.length} of ${rawTripRows.length} shown`
                    : `${filteredTrips.length} of ${allTrips.length} shown`}
                </span>
                <select
                  id="status-select"
                  className="fleet-input"
                  style={{ width: "auto", minHeight: 36 }}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All</option>
                  <option value="trip_rows">All Trips</option>
                  <option value="active">Active</option>
                  {Array.from(new Set(allTrips.map(t => normalizeState(t.status)).filter(Boolean))).sort().map(s => (
                    <option key={s} value={s}>{stateLabel(s)}</option>
                  ))}
                </select>
              </div>
              {statusFilter === "trip_rows" ? (
                <div className="panel raw-trip-table-panel" id="trip-list">
                  <div style={{ overflowX: "auto" }}>
                    <table className="fleet-table raw-trip-table">
                      <thead>
                        <tr>
                          {["ID", "Trip", "Vehicle", "Driver", "Origin", "Destination", "Date", "State", "Revenue", "Expense"].map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRawTripRows.map((trip) => {
                          const tripId = String(trip.id);
                          const isExpanded = expandedRawTripId === tripId;
                          const plate = trip.vehicle_plate || trip.vehicle_id || "N/A";
                          const revenue = Number(trip.total_revenue || 0);
                          const expense = Number(trip.total_expense || 0);
                          const net = revenue - expense;
                          const route = buildJourneyRoute(trip);
                          const lineItems = Array.isArray(trip.payment_request_lines) ? trip.payment_request_lines : [];
                          const displayLines = lineItems.length
                            ? lineItems
                            : expense > 0
                              ? [{ item: "Recorded expense", quantity: 1, amount: expense, total: expense }]
                              : [];
                          return (
                            <Fragment key={tripId}>
                              <tr
                                aria-expanded={isExpanded}
                                className="hoverable-row"
                                style={{ cursor: "pointer" }}
                                onClick={() => setExpandedRawTripId((current) => (current === tripId ? null : tripId))}
                                title="Click to expand trip details"
                              >
                                <td>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <button
                                      type="button"
                                      aria-label={isExpanded ? "Collapse trip" : "Expand trip"}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setExpandedRawTripId((current) => (current === tripId ? null : tripId));
                                      }}
                                      style={{
                                        width: 28,
                                        height: 28,
                                        borderRadius: 8,
                                        border: "1px solid var(--line)",
                                        background: "var(--panel-2)",
                                        color: "var(--text)",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        flex: "0 0 auto",
                                      }}
                                    >
                                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    </button>
                                    <span>{trip.id}</span>
                                  </div>
                                </td>
                                <td>{tripDisplayName(trip)}</td>
                                <td>{plate}</td>
                                <td>{trip.driver_name || "Unassigned"}</td>
                                <td>{trip.origin || "N/A"}</td>
                                <td>{displayLocation(trip.destination, "N/A")}</td>
                                <td>{formatDateTime(trip.departure_date || trip.create_date)}</td>
                                <td><span className={`pill ${normalizeState(trip.status)}`}>{stateLabel(trip.status)}</span></td>
                                <td className="green">{money(trip.total_revenue)}</td>
                                <td className="red">{money(trip.total_expense)}</td>
                              </tr>
                              {isExpanded && (
                                <tr className="journey-expanded-row">
                                  <td className="journey-expanded-cell" colSpan={10} style={{ padding: 0, borderBottom: "1px solid var(--line)" }}>
                                    <div
                                      className="journey-expanded-detail"
                                      style={{
                                        padding: 14,
                                        background: "var(--panel-2)",
                                        borderTop: "1px solid var(--line)",
                                        display: "grid",
                                        gap: 12,
                                      }}
                                    >
                                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                                        <div>
                                          <div style={{ fontWeight: 900, fontSize: 15 }}>{route}</div>
                                          <div className="journey-expanded-summary-line" style={{ marginTop: 5 }}>
                                            <span>{tripDisplayName(trip)}</span>
                                            <span>{plate}</span>
                                            <span>{trip.driver_name || "Unassigned driver"}</span>
                                            <span>{stateLabel(trip.status)}</span>
                                          </div>
                                        </div>
                                        <div className="journey-expanded-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                          <a className="btn" href={`/detail?journey_id=${encodeURIComponent(tripId)}`}>
                                            <PanelRightOpen size={16} /> Detail
                                          </a>
                                          <a className="btn" href={`/map?journey_id=${encodeURIComponent(tripId)}&vehicle=${encodeURIComponent(String(plate))}`}>
                                            <Map size={16} /> Map
                                          </a>
                                        </div>
                                      </div>
                                      <div
                                        style={{
                                          display: "grid",
                                          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                                          gap: 10,
                                        }}
                                      >
                                        {[
                                          ["Departure", formatDateTime(trip.departure_date), ""],
                                          ["Arrival", formatDateTime(trip.arrival_date), ""],
                                          ["Revenue", money(revenue), "green"],
                                          ["Expense", money(expense), "red"],
                                          ["Profit", money(net), net >= 0 ? "green" : "red"],
                                        ].map(([label, value, tone]) => (
                                          <div key={label} className="card" style={{ padding: "9px 10px", background: "var(--panel)" }}>
                                            <div className="card-label">{label}</div>
                                            <div className={`card-value ${tone}`} style={{ fontSize: 15, overflowWrap: "anywhere" }}>{value}</div>
                                          </div>
                                        ))}
                                      </div>
                                      <div
                                        style={{
                                          display: "flex",
                                          gap: 10,
                                          flexWrap: "wrap",
                                          color: "var(--muted)",
                                          fontSize: 12,
                                        }}
                                      >
                                        <span>Route: <strong style={{ color: "var(--text)" }}>{route}</strong></span>
                                        <span>DB current: <strong style={{ color: "var(--text)" }}>{trip.current_location || trip.current_location_note || "N/A"}</strong></span>
                                        <span>Payment requests: <strong style={{ color: "var(--text)" }}>{trip.payment_request_count || 0}</strong></span>
                                        {revenue === 0 && expense === 0 && (
                                          <span>No finance recorded on this trip yet</span>
                                        )}
                                      </div>
                                      <div style={{ overflowX: "auto" }}>
                                        <table className="fleet-table raw-trip-leg-table" style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                                          <thead>
                                            <tr>
                                              {["No", "Item / Asked For", "Qty", "Asked Price", "Line Total", "Remark"].map((header) => (
                                                <th key={header}>{header}</th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {displayLines.length ? (
                                              displayLines.map((line, index) => {
                                                const quantity = Number(line.quantity || 1);
                                                const amount = Number(line.amount || 0);
                                                const total = Number(line.total ?? amount * quantity);
                                                return (
                                                  <tr key={`${tripId}-line-${index}`}>
                                                    <td>{index + 1}</td>
                                                    <td><strong>{tripLineLabel(line.item, line.description)}</strong></td>
                                                    <td>{quantity || 1}</td>
                                                    <td>{money(amount)}</td>
                                                    <td className={total >= 0 ? "green" : "red"}>{money(total)}</td>
                                                    <td>{line.request_state ? stateLabel(line.request_state) : "Trip expense"}</td>
                                                  </tr>
                                                );
                                              })
                                            ) : (
                                              <tr>
                                                <td colSpan={6} className="empty">No expense/request line items found for this trip.</td>
                                              </tr>
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                        {filteredRawTripRows.length === 0 && (
                          <tr>
                            <td colSpan={10} className="empty">No trips match this filter.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="panel" id="trip-list">
                  <TripTable trips={filteredTrips} />
                </div>
              )}
            </div>
          )}

          {/* ── Payments ── */}
          {/* {view === "payments" && !loading && (
            <div style={{ display: "grid", gap: 16 }}>
              <div
                id="payment-grid"
                style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 12 }}
              >
                {(
                  [
                    ["Confirmed Receivables", money(filteredTrips.reduce((s, t) => s + Number(t.total_revenue || 0), 0)), "green"],
                    ["Customer Paid", money(data.payment_summary?.customer_paid_total ?? 0), "green"],
                    ["Customer Pending", money(data.payment_summary?.customer_pending_total ?? 0), "red"],
                    ["Vendor Paid", money(data.payment_summary?.vendor_paid_total ?? 0), "green"],
                    ["Vendor Pending", money(data.payment_summary?.vendor_pending_total ?? 0), "amber"],
                  ] as [string, string, string][]
                ).map(([label, value, tone]) => (
                  <div className="card" key={label}>
                    <div className="card-label">{label}</div>
                    <div className={`card-value ${tone}`}>{value}</div>
                  </div>
                ))}
              </div>
              <div className="panel">
                <div className="panel-header"><div className="panel-title">Payment Details</div></div>
                <div style={{ overflowX: "auto" }}>
                  <table className="fleet-table" id="payment-table">
                    <thead>
                      <tr>
                        {["Trip", "Customer", "Status", "Trips", "Receivable", "Paid", "Pending", "Vendor Pending", "Profit"].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTrips.map((t) => (
                        <tr key={t.id}>
                          <td>{t.vehicle_plate || String(t.id)}</td>
                          <td>{t.customer_name || t.driver_name || "Customer not set"}</td>
                          <td>{paymentLabel(t)}</td>
                          <td>{Number(t.trip_count || (Array.isArray(t.trips) ? t.trips.length : 0) || t.order_count || 1)}</td>
                          <td className="green">{money(t.total_revenue)}</td>
                          <td className="green">{money(t.paid_amount)}</td>
                          <td className="amber">{money(t.pending_payment)}</td>
                          <td className="amber">{money(t.pending_expense_payment)}</td>
                          <td className={Number(t.total_revenue || 0) - Number(t.total_expense || 0) >= 0 ? "green" : "red"}>
                            {money(Number(t.total_revenue || 0) - Number(t.total_expense || 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )} */}

          {/* ── Locations ── */}
          {view === "locations" && !loading && (
            <div className="panel">
              <div className="panel-header"><div className="panel-title">Current Locations</div></div>
              <div style={{ overflowX: "auto" }}>
                <table className="fleet-table" id="location-table">
                  <thead>
                    <tr>
                      {["Location", "Trips", "Active", "Vehicles"].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(
                      filteredTrips.reduce<Record<string, { location: string; count: number; vehicles: Set<string>; active: number }>>(
                        (acc, t) => {
                          const loc =
                            (t.destinations && t.destinations[0]) ||
                            t.current_location ||
                            "Pending";
                          if (!acc[loc]) acc[loc] = { location: loc, count: 0, vehicles: new Set(), active: 0 };
                          acc[loc].count++;
                          acc[loc].vehicles.add(t.vehicle_plate || "N/A");
                          if (["available", "assigned", "dispatched"].includes(normalizeState(t.status))) acc[loc].active++;
                          return acc;
                        }, {}
                      )
                    ).map((row) => (
                      <tr key={row.location}>
                        <td>{row.location}</td>
                        <td>{row.count}</td>
                        <td>{row.active}</td>
                        <td>{Array.from(row.vehicles).slice(0, 4).join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
