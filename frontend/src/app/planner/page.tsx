"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bot,
  CreditCard,
  DollarSign,
  MapPin,
  Menu,
  Moon,
  Route,
  Search,
  Sun,
  Truck,
} from "lucide-react";
import Sidebar, { type SidebarView } from "@/components/layout/Sidebar";
import { useTheme } from "@/hooks/useTheme";
import { API_BASE, fetchCachedJson, fetchJson } from "@/lib/api";
import {
  buildJourneyRoute,
  mayetSearchTerm,
  money,
  normalizeState,
  stateLabel,
} from "@/lib/formatters";
import type { DashboardSnapshot } from "@/types/dashboard";
import type { MayetVehicle, Trip } from "@/types/trip";

type MayetVehicleCatalog = {
  vehicles?: MayetVehicle[];
  count?: number;
};

type ChatMessage = {
  role: "agent" | "user";
  text: string;
};

type PlanCard = {
  title: string;
  value: string;
  tone: "blue" | "green" | "amber" | "red";
  icon: ReactNode;
  action: string;
  reason: string;
  revenue: string;
};

const ACTIVE_STATES = new Set(["available", "assigned", "dispatched", "started", "in transit", "draft"]);
const FLEET_AGENT_ENABLED = false;

const isActiveTrip = (trip: Trip) => {
  const state = normalizeState(trip.status || trip.state);
  return ACTIVE_STATES.has(state) && !["done", "cancelled", "cancel"].includes(state);
};

const tripPlate = (trip: Trip) => trip.vehicle_plate || trip.vehicle_id || String(trip.id);

const tripDestination = (trip: Trip) => {
  if (Array.isArray(trip.destinations) && trip.destinations.length) return trip.destinations.join(", ");
  return trip.destination || trip.journey_end || "Destination not set";
};

const dbLocationLabel = (trip: Trip) =>
  trip.current_location || trip.current_location_note || tripDestination(trip) || "DB location pending";

const netValue = (trip: Trip) => Number(trip.total_revenue || 0) - Number(trip.total_expense || 0);

const telemetryValue = (value?: string | number | null, suffix = "") => {
  if (value === null || value === undefined || value === "") return "N/A";
  return `${value}${suffix}`;
};

const compactPlateList = (plates: string[]) => {
  const visible = plates.slice(0, 8).join(", ");
  return plates.length > 8 ? `${visible} +${plates.length - 8}` : visible;
};

const locationKeyForVehicle = (vehicle: MayetVehicle) => {
  const location = String(vehicle.address || vehicle.location || "").trim();
  if (location && !/^-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?$/.test(location)) return location.toLowerCase();
  const lat = Number(vehicle.latitude ?? vehicle.lat);
  const lng = Number(vehicle.longitude ?? vehicle.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat.toFixed(2)},${lng.toFixed(2)}`;
  return "";
};

const vehiclePointText = (vehicle: MayetVehicle) => {
  const location = String(vehicle.address || vehicle.location || "").trim();
  if (location && !/^-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?$/.test(location)) return location;
  const lat = Number(vehicle.latitude ?? vehicle.lat);
  const lng = Number(vehicle.longitude ?? vehicle.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `GPS area ${lat.toFixed(2)}, ${lng.toFixed(2)}`;
  return "Unknown area";
};

function answerFleetQuestion(question: string, trips: Trip[], mayetVehicles: MayetVehicle[], data: DashboardSnapshot) {
  const q = question.toLowerCase().trim();
  if (!q) return "Ask me for a plate, driver, destination, payment risk, GPS issue, or revenue opportunity.";

  if (q.includes("conflict") || q.includes("same driver") || q.includes("same vehicle")) {
    const conflicts = data.vehicle_conflicts || [];
    if (!conflicts.length) return "No vehicle assignment conflicts are showing in the current dashboard data.";
    return conflicts
      .slice(0, 3)
      .map((conflict) => `${conflict.vehicle_plate}: ${conflict.driver_count} active drivers (${conflict.drivers.join(", ")}).`)
      .join("\n");
  }

  if (q.includes("idle") || q.includes("available")) {
    const available = trips.filter((trip) => ["available", "draft"].includes(normalizeState(trip.status || trip.state)));
    if (!available.length) return "No available or draft journeys found in the current data.";
    return available
      .slice(0, 6)
      .map((trip) => `${tripPlate(trip)}: ${stateLabel(trip.status || trip.state)} to ${tripDestination(trip)}, driver ${trip.driver_name || "unassigned"}.`)
      .join("\n");
  }

  if (q.includes("gps") || q.includes("location") || q.includes("map")) {
    const missingGps = trips.filter((trip) => isActiveTrip(trip) && (trip.mayet_latitude == null || trip.mayet_longitude == null));
    return `${mayetVehicles.length} Mayet vehicles are cached now. ${missingGps.length} active journeys do not have a direct Mayet GPS point in the dashboard journey data.`;
  }

  if (q.includes("revenue") || q.includes("profit") || q.includes("money")) {
    const top = [...trips].sort((a, b) => netValue(b) - netValue(a)).slice(0, 5);
    return top
      .map((trip) => `${tripPlate(trip)}: net ${money(netValue(trip))}, revenue ${money(trip.total_revenue)}, route ${tripDestination(trip)}.`)
      .join("\n");
  }

  const plateNumber = mayetSearchTerm(question);
  const match = trips.find((trip) => {
    const plate = tripPlate(trip);
    return (
      String(plate).toLowerCase().includes(q) ||
      mayetSearchTerm(plate) === plateNumber ||
      String(trip.driver_name || "").toLowerCase().includes(q) ||
      String(tripDestination(trip)).toLowerCase().includes(q)
    );
  });

  if (!match) {
    const mayetMatch = mayetVehicles.find((vehicle) => mayetSearchTerm(vehicle.plate) === plateNumber);
    if (mayetMatch) {
      return `${mayetMatch.plate}: no DB trip row found. GPS cache is available only for comparison. Speed ${telemetryValue(mayetMatch.speed, " km/h")}, fuel ${telemetryValue(mayetMatch.fuel_level ?? mayetMatch.fuel, "%")}, stop ${telemetryValue(mayetMatch.stop_duration_text ?? mayetMatch.stop_duration ?? mayetMatch.stopped_for)}.`;
    }
    return "I could not find that vehicle in the current trips or Mayet vehicle cache.";
  }

  return [
    `${tripPlate(match)}: ${stateLabel(match.status || match.state)} journey.`,
    `Driver: ${match.driver_name || "unassigned"}. Route: ${buildJourneyRoute(match)}.`,
    `DB location: ${dbLocationLabel(match)}. Speed ${telemetryValue(match.mayet_speed, " km/h")}, fuel ${telemetryValue(match.mayet_fuel_level, "%")}.`,
    `Revenue: ${money(match.total_revenue)}. Expense: ${money(match.total_expense)}. Net: ${money(netValue(match))}. Pending: ${money(match.pending_payment)}.`,
  ].join("\n");
}

function FleetPlannerContent() {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [data, setData] = useState<DashboardSnapshot>({});
  const [mayetVehicles, setMayetVehicles] = useState<MayetVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "agent",
      text: "Fleet Agent ready. Ask by plate, driver, destination, GPS, conflicts, idle vehicles, or revenue.",
    },
  ]);

  useEffect(() => {
    fetchJson(`${API_BASE}/auth/me`).catch(() => router.push("/login"));
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchCachedJson<DashboardSnapshot>(
        `${API_BASE}/dashboard/full?mode=live`,
        undefined,
        { ttlMs: 60_000, cacheKey: "dashboard:live:journey-routes-full-odoo-v3", forceRefresh: true }
      ),
      fetchCachedJson<MayetVehicleCatalog>(
        `${API_BASE}/dashboard/mayet/vehicles`,
        undefined,
        { ttlMs: 30_000, cacheKey: "dashboard:mayet:vehicles", forceRefresh: true }
      ),
    ])
      .then(([snapshot, catalog]) => {
        if (cancelled) return;
        setData(snapshot);
        setMayetVehicles(Array.isArray(catalog.vehicles) ? catalog.vehicles : []);
        setError("");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load fleet planning data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trips = useMemo(() => data.recent_journeys || [], [data.recent_journeys]);
  const activeTrips = useMemo(() => trips.filter(isActiveTrip), [trips]);
  const availableTrips = useMemo(
    () => trips.filter((trip) => ["available", "draft"].includes(normalizeState(trip.status || trip.state))),
    [trips]
  );
  const pendingTrips = useMemo(
    () => trips.filter((trip) => Number(trip.pending_payment || 0) > 0).sort((a, b) => Number(b.pending_payment || 0) - Number(a.pending_payment || 0)),
    [trips]
  );
  const highNetTrips = useMemo(
    () => [...trips].sort((a, b) => netValue(b) - netValue(a)).slice(0, 6),
    [trips]
  );
  const lowMarginTrips = useMemo(
    () => trips.filter((trip) => Number(trip.total_revenue || 0) > 0).sort((a, b) => netValue(a) - netValue(b)).slice(0, 5),
    [trips]
  );

  const gpsClusters = useMemo(() => {
    const grouped = new Map<string, { label: string; plates: string[] }>();
    mayetVehicles.forEach((vehicle) => {
      const key = locationKeyForVehicle(vehicle);
      if (!key) return;
      const group = grouped.get(key) || { label: vehiclePointText(vehicle), plates: [] };
      const plate = String(vehicle.plate || "Unknown");
      if (!group.plates.includes(plate)) group.plates.push(plate);
      grouped.set(key, group);
    });
    return Array.from(grouped.values())
      .filter((group) => group.plates.length >= 4)
      .sort((a, b) => b.plates.length - a.plates.length)
      .slice(0, 5);
  }, [mayetVehicles]);

  const totalRevenue = trips.reduce((sum, trip) => sum + Number(trip.total_revenue || 0), 0);
  const totalExpense = trips.reduce((sum, trip) => sum + Number(trip.total_expense || 0), 0);
  const pendingPayment = trips.reduce((sum, trip) => sum + Number(trip.pending_payment || 0), 0);
  const gpsMissing = activeTrips.filter((trip) => trip.mayet_latitude == null || trip.mayet_longitude == null).length;

  const planCards = useMemo<PlanCard[]>(() => {
    const conflicts = data.vehicle_conflicts || [];
    const topPending = pendingTrips[0];
    const bestAvailable = availableTrips[0];
    return [
      {
        title: "Collect Before Dispatch",
        value: money(pendingPayment),
        tone: "amber",
        icon: <CreditCard size={18} />,
        action: topPending ? `Start with ${tripPlate(topPending)} / ${topPending.customer_name || topPending.driver_name || "customer"}.` : "No large pending customer balance found.",
        reason: `${pendingTrips.length} journeys have pending customer payment.`,
        revenue: "Improves cash flow and reduces unpaid-trip risk.",
      },
      {
        title: "Assign Available Capacity",
        value: `${availableTrips.length} vehicles`,
        tone: "green",
        icon: <Truck size={18} />,
        action: bestAvailable ? `Review ${tripPlate(bestAvailable)} for the next revenue route to ${tripDestination(bestAvailable)}.` : "No available vehicle pool found now.",
        reason: "Available and draft vehicles are the fastest capacity to turn into active revenue.",
        revenue: "Moves idle capacity into billable work.",
      },
      {
        title: "Protect Top Routes",
        value: money(highNetTrips.reduce((sum, trip) => sum + Math.max(0, netValue(trip)), 0)),
        tone: "blue",
        icon: <Route size={18} />,
        action: highNetTrips[0] ? `Monitor ${tripPlate(highNetTrips[0])}: ${tripDestination(highNetTrips[0])}.` : "No route revenue data available.",
        reason: "Highest net journeys should get priority follow-up and tracking.",
        revenue: "Protects confirmed revenue from delay and GPS blind spots.",
      },
      {
        title: "Fix Assignment Risk",
        value: `${conflicts.length} conflicts`,
        tone: conflicts.length ? "red" : "green",
        icon: <AlertTriangle size={18} />,
        action: conflicts[0] ? `Resolve ${conflicts[0].vehicle_plate} assigned to ${conflicts[0].drivers.join(", ")}.` : "No vehicle conflict action needed.",
        reason: "One vehicle with multiple active drivers creates execution risk.",
        revenue: "Prevents dispatch confusion and missed trips.",
      },
    ];
  }, [availableTrips, data.vehicle_conflicts, highNetTrips, pendingPayment, pendingTrips]);

  const ask = (prompt = question) => {
    const clean = prompt.trim();
    if (!clean) return;
    const answer = answerFleetQuestion(clean, trips, mayetVehicles, data);
    const nextMessages: ChatMessage[] = [
      { role: "user", text: clean },
      { role: "agent", text: answer },
    ];
    setMessages((prev) => [...prev, ...nextMessages].slice(-8));
    setQuestion("");
  };

  const nav = (view: SidebarView) => {
    if (view === "overview") router.push("/");
    else if (view === "payments") router.push("/payments");
    else if (view === "reports") router.push("/reports");
    else if (view === "map") router.push("/map");
    else if (view === "planner") router.push("/planner");
    else router.push(`/?view=${view}`);
  };

  return (
    <div className="app-shell">
      <div className={`overlay${mobileSidebarOpen ? " open" : ""}`} onClick={() => setMobileSidebarOpen(false)} />
      <Sidebar currentView="planner" onViewChange={nav} mobileOpen={mobileSidebarOpen} />
      <div className="app-main">
        <div className="fleet-topbar">
          <button className="btn md-hidden" onClick={() => setMobileSidebarOpen(true)} title="Open menu">
            <Menu size={18} />
          </button>
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Fleet Agent & Logistics Plan</h1>
            <div className="muted" style={{ fontSize: 13 }}>Live trips, DB locations, payment risk, and dispatch recommendations</div>
          </div>
          <button className="btn" onClick={toggle} title="Toggle theme">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <Link href="/map" className="btn primary">
            <MapPin size={16} /> Map
          </Link>
        </div>

        <main className="main-content fleet-page" style={{ display: "grid", gap: 18 }}>
          {loading && <div className="empty" style={{ padding: 48 }}>Loading live fleet plan...</div>}
          {error && <div className="login-error" style={{ padding: 16 }}>{error}</div>}
          {!loading && !error && (
            <>
              <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
                {[
                  ["Active journeys", activeTrips.length, "blue"],
                  ["Mayet vehicles", mayetVehicles.length, "green"],
                  ["Same-place clusters", gpsClusters.length, gpsClusters.length ? "amber" : "green"],
                  ["Missing GPS", gpsMissing, gpsMissing ? "red" : "green"],
                  ["Revenue", money(totalRevenue), "green"],
                  ["Net", money(totalRevenue - totalExpense), totalRevenue - totalExpense >= 0 ? "green" : "red"],
                ].map(([label, value, tone]) => (
                  <div className="card" key={label}>
                    <div className="card-label">{label}</div>
                    <div className={`card-value ${tone}`}>{value}</div>
                  </div>
                ))}
              </section>

              <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(340px, .9fr)", gap: 16 }} className="planner-main-grid">
                <div style={{ display: "grid", gap: 16 }}>
                  <div className="panel">
                    <div className="panel-header">
                      <div>
                        <div className="panel-title">Suggested Logistics Plan</div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>Decisions based on live vehicle workflow, GPS coverage, payments, and margin.</div>
                      </div>
                    </div>
                    <div className="panel-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
                      {planCards.map((card) => (
                        <article key={card.title} className="card" style={{ display: "grid", gap: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <div className={`pill ${card.tone === "red" ? "cancelled" : card.tone === "amber" ? "assigned" : card.tone === "green" ? "done" : "available"}`}>{card.icon}{card.title}</div>
                            <strong className={card.tone}>{card.value}</strong>
                          </div>
                          <div style={{ fontWeight: 800 }}>{card.action}</div>
                          <div className="muted" style={{ fontSize: 13 }}>{card.reason}</div>
                          <div style={{ fontSize: 13 }}>{card.revenue}</div>
                        </article>
                      ))}
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-header">
                      <div>
                        <div className="panel-title">Vehicle Clusters On Map</div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>Areas where several Mayet GPS vehicles are stacked together.</div>
                      </div>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table className="fleet-table">
                        <thead>
                          <tr>
                            {["Area", "Vehicles", "Decision"].map((header) => <th key={header}>{header}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {gpsClusters.map((cluster) => (
                            <tr key={cluster.label}>
                              <td><strong>{cluster.label}</strong></td>
                              <td>{cluster.plates.length}<div className="muted" style={{ fontSize: 12 }}>{compactPlateList(cluster.plates)}</div></td>
                              <td>Check idle vehicles in this area and assign nearest available unit before sending a far vehicle.</td>
                            </tr>
                          ))}
                          {gpsClusters.length === 0 && (
                            <tr><td colSpan={3} className="empty">No heavy same-location cluster found in Mayet GPS now.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-header">
                      <div className="panel-title">Revenue Decision Queue</div>
                      <span className="pill available">{highNetTrips.length} priority journeys</span>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table className="fleet-table">
                        <thead>
                          <tr>
                            {["Vehicle", "Route", "State", "Revenue", "Net", "Decision"].map((header) => <th key={header}>{header}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {highNetTrips.map((trip) => (
                            <tr key={trip.id}>
                              <td><strong>{tripPlate(trip)}</strong><div className="muted" style={{ fontSize: 12 }}>{trip.driver_name || "Unassigned"}</div></td>
                              <td>{tripDestination(trip)}</td>
                              <td><span className={`pill ${normalizeState(trip.status || trip.state)}`}>{stateLabel(trip.status || trip.state)}</span></td>
                              <td className="green">{money(trip.total_revenue)}</td>
                              <td className={netValue(trip) >= 0 ? "green" : "red"}>{money(netValue(trip))}</td>
                              <td>Protect schedule, verify GPS, collect pending before new loading.</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-header">
                      <div className="panel-title">Cost And Risk Watch</div>
                    </div>
                    <div className="panel-body" style={{ display: "grid", gap: 10 }}>
                      {lowMarginTrips.map((trip) => (
                        <div key={trip.id} className="card" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
                          <div>
                            <strong>{tripPlate(trip)}</strong>
                            <div className="muted" style={{ fontSize: 13 }}>{tripDestination(trip)} · {dbLocationLabel(trip)}</div>
                          </div>
                          <div className={netValue(trip) >= 0 ? "green" : "red"} style={{ fontWeight: 900 }}>{money(netValue(trip))}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <aside className="panel" style={{ alignSelf: "start" }}>
                  <div className="panel-header">
                    <div>
                      <div className="panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><Bot size={18} /> Fleet Quick Teller</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>Ask about any vehicle, driver, GPS, payments, conflicts, or revenue.</div>
                    </div>
                  </div>
                  <div className="panel-body" style={{ display: "grid", gap: 12 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ position: "relative", flex: 1 }}>
                        <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
                        <input
                          className="fleet-input"
                          value={question}
                          onChange={(event) => setQuestion(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") ask();
                          }}
                          placeholder="Ask: 92652, idle, GPS, revenue..."
                          style={{ width: "100%", paddingLeft: 34 }}
                        />
                      </div>
                      <button className="btn primary" onClick={() => ask()}>Ask</button>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {["Driver conflicts", "Idle vehicles", "GPS issues", "Revenue opportunities"].map((chip) => (
                        <button key={chip} className="btn" style={{ minHeight: 32, fontSize: 12 }} onClick={() => ask(chip)}>
                          {chip}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "grid", gap: 10, maxHeight: 420, overflowY: "auto", paddingRight: 4 }}>
                      {messages.map((message, index) => (
                        <div
                          key={`${message.role}-${index}`}
                          className="card"
                          style={{
                            background: message.role === "agent" ? "var(--panel-2)" : "var(--primary-soft)",
                            whiteSpace: "pre-line",
                            fontSize: 13,
                          }}
                        >
                          <strong>{message.role === "agent" ? "Fleet Agent" : "You"}</strong>
                          <div style={{ marginTop: 5 }}>{message.text}</div>
                        </div>
                      ))}
                    </div>
                    <div className="card" style={{ display: "grid", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}><DollarSign size={16} /> Decision Summary</div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {activeTrips.length} active journeys, {availableTrips.length} available/draft vehicles, {pendingTrips.length} payment follow-ups, and {gpsMissing} active GPS gaps.
                      </div>
                    </div>
                  </div>
                </aside>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default function FleetPlannerPage() {
  const router = useRouter();

  useEffect(() => {
    if (!FLEET_AGENT_ENABLED) router.replace("/");
  }, [router]);

  if (!FLEET_AGENT_ENABLED) {
    return <div className="empty" style={{ padding: 60 }}>Redirecting...</div>;
  }

  return (
    <Suspense fallback={<div className="empty" style={{ padding: 60 }}>Loading planner...</div>}>
      <FleetPlannerContent />
    </Suspense>
  );
}
