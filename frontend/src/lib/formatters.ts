import type { Trip, TripLeg } from "@/types/trip";

// ── Currency formatter ────────────────────────────────
const etbFormatter = new Intl.NumberFormat("en-ET", {
  style: "currency",
  currency: "ETB",
  maximumFractionDigits: 0,
});
export const money = (value?: number | string | null) =>
  etbFormatter.format(Number(value || 0));

// ── State normalisation ───────────────────────────────
const STATE_MAP: Record<string, string> = {
  planned: "available",
  in_progress: "dispatched",
  completed: "done",
  cancel: "cancelled",
  canceled: "cancelled",
};

export const normalizeState = (status?: string | null): string => {
  const raw = String(status || "draft").toLowerCase();
  return STATE_MAP[raw] ?? raw;
};

export const stateLabel = (status?: string | null): string =>
  normalizeState(status)
    .replace("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

// ── Payment state ─────────────────────────────────────
export type PaymentState = "paid" | "partial" | "pending" | "open";

export const getPaymentState = (trip: Trip): PaymentState => {
  const pendingCustomer = Number(trip.pending_payment || 0);
  const paidCustomer = Number(trip.paid_amount || 0);
  const pendingVendor = Number(trip.pending_expense_payment || 0);
  if (
    pendingCustomer <= 0 &&
    pendingVendor <= 0 &&
    (paidCustomer > 0 || Number(trip.total_revenue || 0) > 0)
  )
    return "paid";
  if (paidCustomer > 0 && pendingCustomer > 0) return "partial";
  if (pendingCustomer > 0 || pendingVendor > 0) return "pending";
  return "open";
};

const PAY_LABELS: Record<PaymentState, string> = {
  paid: "Paid",
  partial: "Partial",
  pending: "Pending",
  open: "Open",
};
export const paymentLabel = (trip: Trip) =>
  PAY_LABELS[getPaymentState(trip)] ?? "Open";

// ── Trip count shown in manager summaries ─────────────
export const getOrderCount = (trip: Trip): number => {
  const legCount = Array.isArray(trip.trips) ? trip.trips.length : 0;
  const routeLegCount = getJourneyRouteStops(trip).length > 1 ? getJourneyRouteStops(trip).length - 1 : 0;
  return Number(
    Math.max(
      routeLegCount,
      Number(trip.trip_count || 0),
      legCount ||
        Number(trip.order_count || 0),
      Number(trip.order_receivable_count || 0),
      1
    )
  );
};

const routeStopLabel = (value?: string | null): string => {
  const raw = String(value || "").trim();
  if (isPendingLocation(raw)) return "Destination pending";
  return raw;
};

const addRouteStop = (stops: string[], value?: string | null) => {
  const stop = routeStopLabel(value);
  if (!stop) return;
  if (stops[stops.length - 1]?.toLowerCase() !== stop.toLowerCase()) stops.push(stop);
};

const sameStop = (left?: string | null, right?: string | null): boolean =>
  routeStopLabel(left).toLowerCase() === routeStopLabel(right).toLowerCase();

const TOP_DEPOT_PATTERN = /^top\s*[1-6]$/i;
const PENDING_LOCATION_PATTERN = /^\*?\s*(pending|db)?\s*destination(?:\s*(pending|not set))?$/i;

export const isTopDepot = (value?: string | null): boolean =>
  TOP_DEPOT_PATTERN.test(String(value || "").trim());

export const isPendingLocation = (value?: string | null): boolean => {
  const clean = String(value || "").trim();
  return !clean || PENDING_LOCATION_PATTERN.test(clean);
};

export const isJourneyDestination = (value?: string | null): boolean =>
  !isPendingLocation(value) && !isTopDepot(value);

export const displayLocation = (value?: string | null, fallback = "Destination pending"): string =>
  isPendingLocation(value) ? fallback : String(value || "").trim();

export const getTripLegs = (trip: Trip): TripLeg[] =>
  Array.isArray(trip.trips) ? trip.trips.filter((leg) => leg && (leg.origin || leg.destination)) : [];

export const getJourneyDestinationList = (trip: Trip): string[] => {
  const legs = getTripLegs(trip);
  const destinations: string[] = [];
  const addDestination = (value?: string | null) => {
    const stop = String(value || "").trim();
    if (!isJourneyDestination(stop)) return;
    if (!destinations.includes(stop)) destinations.push(stop);
  };

  (Array.isArray(trip.destinations) ? trip.destinations : []).forEach(addDestination);
  legs.forEach((leg) => addDestination(leg.destination));
  addDestination(trip.destination);
  return destinations;
};

export const getPrimaryJourneyDestination = (trip: Trip): string =>
  getJourneyDestinationList(trip)[0] || "Destination pending";

export const getJourneyRouteStops = (trip: Trip): string[] => {
  const start = String(trip.journey_start || trip.origin || "").trim();
  const end = String(trip.journey_end || "").trim();
  const legs = getTripLegs(trip);
  const stops: string[] = [];
  addRouteStop(stops, start);
  if (trip.journey_ended_at_factory && legs.length) {
    legs.forEach((leg) => {
      addRouteStop(stops, leg.origin);
      addRouteStop(stops, leg.destination);
    });
  } else {
    getJourneyDestinationList(trip).forEach((destination) => addRouteStop(stops, destination));
  }
  if (trip.journey_ended_at_factory) addRouteStop(stops, end || (isTopDepot(start) ? start : undefined));
  return stops;
};

export const getJourneyDisplayLegs = (trip: Trip): TripLeg[] => {
  const realLegs = getTripLegs(trip);
  const routeStops = getJourneyRouteStops(trip);
  if (routeStops.length < 2) return realLegs;

  const used = new Set<number>();
  const displayLegs: TripLeg[] = [];

  for (let index = 0; index < routeStops.length - 1; index += 1) {
    const origin = routeStops[index];
    const destination = routeStops[index + 1];
    const realIndex = realLegs.findIndex((leg, legIndex) =>
      !used.has(legIndex) && sameStop(leg.origin, origin) && sameStop(leg.destination, destination)
    );

    if (realIndex >= 0) {
      used.add(realIndex);
      displayLegs.push(realLegs[realIndex]);
      continue;
    }

    displayLegs.push({
      id: `${trip.id}:route-leg:${index}`,
      origin,
      destination,
      departure_date: index === 0 ? trip.departure_date || trip.create_date : trip.return_date || trip.arrival_date,
      arrival_date: index === routeStops.length - 2 ? trip.return_date || trip.arrival_date : undefined,
      create_date: trip.create_date,
      write_date: trip.write_date,
      status: trip.status || trip.state,
      revenue: 0,
      expense: 0,
      paid_amount: 0,
      pending_payment: 0,
      payment_request_total: 0,
      payment_request_count: 0,
      payment_request_lines: [],
      synthetic: true,
    });
  }

  realLegs.forEach((leg, index) => {
    if (!used.has(index)) displayLegs.push(leg);
  });

  return displayLegs;
};

export const getJourneyLegCount = (trip: Trip): number => {
  const displayCount = getJourneyDisplayLegs(trip).length;
  return Math.max(displayCount, Number(trip.trip_count || 0), Number(trip.order_count || 0), 1);
};

export const buildJourneyRoute = (trip: Trip): string => {
  const stops = getJourneyRouteStops(trip);
  if (stops.length === 1 && isTopDepot(stops[0])) return `${stops[0]} round trip`;
  return stops.length ? stops.join(" → ") : "Route not set";
};

export const getJourneyDestinations = (trip: Trip): string => {
  const destinations = getJourneyDestinationList(trip);
  return destinations.length ? destinations.join(", ") : "Destination pending";
};

export const legMoneyLabel = (leg: TripLeg): string =>
  `Revenue ${money(leg.revenue || 0)} · Expense ${money(leg.expense || 0)}`;

const INTERNAL_SEED_NAME = /^SEED[-_]/i;

export const isInternalSeedName = (value?: string | null): boolean =>
  INTERNAL_SEED_NAME.test(String(value || "").trim());

export const tripDisplayName = (trip: Pick<Trip, "id" | "name" | "origin" | "destination">): string => {
  const name = String(trip.name || "").trim();
  if (name && !isInternalSeedName(name)) return name;
  if (trip.origin && isJourneyDestination(trip.destination)) return `${trip.origin} to ${trip.destination}`;
  return `Trip ${trip.id}`;
};

export const cleanTripReference = (value?: string | null, fallback = "No route"): string => {
  const clean = String(value || "").trim();
  if (!clean || isInternalSeedName(clean)) return fallback;
  return clean;
};

// ── Number helpers ────────────────────────────────────
export const percentOf = (value: number, total: number): number => {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
};

// ── Date helpers ──────────────────────────────────────
export const tripDateKey = (trip: Trip): string => {
  const raw = trip.departure_date || trip.create_date || trip.arrival_date;
  const date = raw ? new Date(raw) : null;
  if (!date || isNaN(date.getTime())) return "No date";
  return date.toISOString().slice(0, 10);
};

export const getDailySeries = (
  trips: Trip[],
  valueGetter: (t: Trip) => number
): [string, number][] => {
  const buckets = new Map<string, number>();
  trips.forEach((t) => {
    const key = tripDateKey(t);
    buckets.set(key, (buckets.get(key) || 0) + Number(valueGetter(t) || 0));
  });
  const entries = Array.from(buckets.entries())
    .filter(([d]) => d !== "No date")
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7);
  return entries.length ? entries : [["No date", 0]];
};

// ── First plate number (for Mayet search) ─────────────
export const firstPlateNumber = (value?: string): string => {
  const m = String(value || "").match(/\d{4,}/);
  return m ? m[0].replace(/^0+/, "") || m[0] : String(value || "");
};

export const mayetSearchTerm = (value?: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const number = firstPlateNumber(raw);
  return number || raw;
};

export const buildMayetUrl = (baseUrl?: string, plateOrRef?: string, journeyId?: string | number): string => {
  const url = new URL(baseUrl || "https://mayetgps.com/", "https://mayetgps.com/");
  const vehicleRef = mayetSearchTerm(plateOrRef);
  if (url.hostname.includes("mayetgps.com") && (url.pathname === "/" || url.pathname === "")) {
    url.pathname = "/objects";
  }
  if (vehicleRef) {
    url.searchParams.set("vehicle", vehicleRef);
    url.searchParams.set("plate", vehicleRef);
    url.searchParams.set("unit", vehicleRef);
    url.searchParams.set("search", vehicleRef);
    url.searchParams.set("q", vehicleRef);
    url.searchParams.set("raw_plate", String(plateOrRef || ""));
  }
  if (journeyId) {
    url.searchParams.set("journey_id", String(journeyId));
  }
  return url.toString();
};

const MAYET_DEVICE_STATES = new Set(["offline", "online", "ack", "idle", "moving", "stopped", "status pending"]);

const isMayetDeviceState = (value?: string | null): boolean =>
  MAYET_DEVICE_STATES.has(String(value || "").trim().toLowerCase());

export const isCoordinateText = (value?: string | null): boolean =>
  /^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(String(value || ""));

export const mayetLocationLabel = (trip: Trip): string => {
  if (trip.mayet_current_location) return trip.mayet_current_location;
  if (trip.mayet_address) return trip.mayet_address;
  if (trip.mayet_latitude != null && trip.mayet_longitude != null) {
    return `${Number(trip.mayet_latitude).toFixed(5)}, ${Number(trip.mayet_longitude).toFixed(5)}`;
  }
  if (trip.mayet_status && !isMayetDeviceState(trip.mayet_status)) return trip.mayet_status;
  return "No Mayet current location";
};

export const readableMayetLocationLabel = (trip: Trip): string => {
  const mayet = mayetLocationLabel(trip);
  if (!isCoordinateText(mayet)) return mayet;
  return (
    trip.current_location ||
    trip.current_location_note ||
    trip.destination ||
    (Array.isArray(trip.destinations) ? trip.destinations[0] : undefined) ||
    mayet
  );
};

// ── Colour by GPS status ──────────────────────────────
export const gpsTone = (status?: string): string => {
  const v = String(status || "").toLowerCase();
  if (v.includes("online")) return "#0e9849";
  if (v.includes("offline")) return "#dc2626";
  if (v.includes("ack")) return "#f59e0b";
  return "#00499e";
};
