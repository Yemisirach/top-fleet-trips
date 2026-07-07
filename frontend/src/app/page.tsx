"use client";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Sidebar, { type SidebarView } from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";
import StatsGrid from "@/components/dashboard/StatsGrid";
import AnalyticsStrip from "@/components/dashboard/AnalyticsStrip";
import WorkflowGraph from "@/components/dashboard/WorkflowGraph";
import TripCard from "@/components/dashboard/TripCard";
import TripTable from "@/components/dashboard/TripTable";
import FinancialSummary from "@/components/dashboard/FinancialSummary";
import { useDashboard } from "@/hooks/useDashboard";
import { useTheme } from "@/hooks/useTheme";
import { normalizeState, stateLabel, paymentLabel, money } from "@/lib/formatters";
import { fetchJson, API_BASE } from "@/lib/api";
import type { DashboardMode } from "@/types/dashboard";
import type { Trip } from "@/types/trip";

const DashboardMap = dynamic(
  () => import("@/components/dashboard/DashboardMap"),
  { ssr: false }
);
const VIEW_META: Record<SidebarView, [string, string]> = {
  overview: ["Overview", "Fleet summary and recent activity"],
  trips: ["Journeys", "All trip records"],
  payments: ["Payments", "Revenue and expense overview"],
  locations: ["Locations", "Current vehicle locations"],
  graphs: ["Analytics", "Journey pipeline and trends"],
  map: ["Map", "Live map"],
  reports: ["Reports", "Financial and operational reports"],
};

export default function DashboardPage() {
  const router = useRouter();
  const { theme, toggle: toggleTheme } = useTheme();
  const { data, allTrips, loading, mode, load, changeMode } = useDashboard();
  const [view, setView] = useState<SidebarView>("overview");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchValue, setSearchValue] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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
          t.mayet_status, paymentLabel(t), legs,
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

  const handleViewChange = useCallback((v: SidebarView, status?: string) => {
    if (v === "reports" || v === ("reports" as string)) { router.push("/reports"); return; }
    if (v === "map" || v === ("map" as string)) { router.push("/map"); return; }
    setView(v);
    if (status) setStatusFilter(status);
    setMobileSidebarOpen(false);
  }, [router]);

  const handleOpenView = useCallback((v: string, status?: string) => {
    if (v === "reports") { router.push("/reports"); return; }
    if (v === "map") { router.push("/map"); return; }
    if (v === "payments") { router.push("/reports#payment-requests"); return; }
    setView(v as SidebarView);
    if (status) setStatusFilter(status);
  }, [router]);

  const [title, subtitle] = VIEW_META[view];

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
          mode={mode}
          modeBadge={data._mode || mode}
          modeWarning={data._warning}
          theme={theme}
          onThemeToggle={toggleTheme}
          onModeChange={(m: DashboardMode) => changeMode(m)}
          onMenuClick={() => setMobileSidebarOpen((o) => !o)}
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          onSearchChip={(v) => setSearchValue(v)}
        />

        <div className="main-content fleet-page" style={{ display: "grid", gap: 24 }}>
          {loading && (
            <div className="empty" style={{ padding: "48px 0", fontSize: 16 }}>
              Loading dashboard…
            </div>
          )}

          {/* ── Overview ── */}
          {view === "overview" && !loading && (
            <>
              <StatsGrid data={data} allTrips={filteredTrips} onOpenView={handleOpenView} />
              <AnalyticsStrip data={data} trips={filteredTrips} onOpenView={handleOpenView} />

              {/* Recent trip table + financial summary */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                <div className="panel" style={{ flex: "1 1 65%", minWidth: 480 }}>
                  <div className="panel-header">
                    <div className="panel-title">Recent Trips</div>
                  </div>
                  <div style={{ padding: "0 0 8px" }}>
                    <TripTable trips={filteredTrips} />
                  </div>
                </div>
                <div style={{ flex: "1 1 30%", minWidth: 320 }}>
                  <FinancialSummary data={data} trips={filteredTrips} />
                </div>
              </div>

              {/* Active trips mini-cards */}
              <div className="panel">
                <div className="panel-header">
                  <div className="panel-title">Active Journeys</div>
                </div>
                <div className="panel-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
                  {filteredTrips
                    .filter((t) =>
                      ["available", "assigned", "dispatched"].includes(normalizeState(t.status))
                    )
                    .slice(0, 6)
                    .map((t) => (
                      <TripCard key={t.id} trip={t} targetId="dashboard-active" />
                    ))}
                  {filteredTrips.filter((t) =>
                    ["available", "assigned", "dispatched"].includes(normalizeState(t.status))
                  ).length === 0 && <div className="empty">No active journeys.</div>}
                </div>
              </div>

              {/* Driver Activity (Supervisors) */}
              <div className="panel">
                <div className="panel-header"><div className="panel-title">Driver Activity</div></div>
                <div style={{ overflowX: "auto" }}>
                  <table className="fleet-table" id="supervisor-table-overview">
                    <thead>
                      <tr>
                        {["Driver/Supervisor", "Vehicles", "Trips", "Active Scope"].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.values(
                        filteredTrips.reduce<Record<string, { name: string; vehicles: Set<string>; trips: number; active: number }>>(
                          (acc, t) => {
                            const name = t.driver_name || "Unassigned driver";
                            if (!acc[name]) acc[name] = { name, vehicles: new Set(), trips: 0, active: 0 };
                            acc[name].vehicles.add(t.vehicle_plate || "N/A");
                            acc[name].trips++;
                            if (["available", "assigned", "dispatched"].includes(normalizeState(t.status))) acc[name].active++;
                            return acc;
                          }, {}
                        )
                      ).map((row) => (
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ── Trips ── */}
          {view === "trips" && !loading && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <h2 id="trips-title" style={{ fontWeight: 900, fontSize: 18, margin: 0 }}>
                  {statusFilter === "active" ? "Active Journeys" : "Journeys"}
                </h2>
                <span id="search-meta" className="muted" style={{ fontSize: 13 }}>
                  {filteredTrips.length} of {allTrips.length} shown
                </span>
                <select
                  id="status-select"
                  className="fleet-input"
                  style={{ width: "auto", minHeight: 36 }}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="available">Available</option>
                  <option value="dispatched">Dispatched</option>
                  <option value="done">Done</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div id="trip-list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
                {filteredTrips.length === 0 ? (
                  <div className="empty">No trips match this view.</div>
                ) : (
                  filteredTrips.map((t) => (
                    <TripCard key={t.id} trip={t} targetId="trip-list" />
                  ))
                )}
              </div>
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
                        {["Trip", "Customer", "Status", "Orders", "Receivable", "Paid", "Pending", "Vendor Pending", "Profit"].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTrips.map((t) => (
                        <tr key={t.id}>
                          <td>{t.vehicle_plate || String(t.id)}</td>
                          <td>{t.customer_name || t.driver_name || "Customer"}</td>
                          <td>{paymentLabel(t)}</td>
                          <td>{Number(t.order_count || 1)}</td>
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

          {/* ── Analytics / Graphs ── */}
          {view === "graphs" && !loading && (
            <>
              <AnalyticsStrip data={data} trips={filteredTrips} onOpenView={handleOpenView} />
              <WorkflowGraph data={data} allTrips={allTrips} onOpenView={handleOpenView} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
