import type { Trip } from "@/types/trip";

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

// ── Order count ───────────────────────────────────────
export const getOrderCount = (trip: Trip): number => {
  const legCount = Array.isArray(trip.trips) ? trip.trips.length : 0;
  return Number(
    trip.order_count ||
      trip.order_receivable_count ||
      trip.payment_request_count ||
      legCount ||
      1
  );
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

// ── Colour by GPS status ──────────────────────────────
export const gpsTone = (status?: string): string => {
  const v = String(status || "").toLowerCase();
  if (v.includes("online")) return "#0e9849";
  if (v.includes("offline")) return "#dc2626";
  if (v.includes("ack")) return "#f59e0b";
  return "#00499e";
};
