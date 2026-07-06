// ── Dashboard snapshot ──────────────────────────────
export interface DashboardSummary {
  total_vehicles?: number;
  total_journeys?: number;
}

export interface PaymentSummary {
  receivable_total?: number;
  customer_paid_total?: number;
  customer_pending_total?: number;
  vendor_paid_total?: number;
  vendor_pending_total?: number;
  expense_total?: number;
  payment_request_total?: number;
}

export interface JourneyByStatus {
  state?: string;
  status?: string;
  count?: number;
}

export interface DashboardSnapshot {
  summary?: DashboardSummary;
  payment_summary?: PaymentSummary;
  recent_journeys?: import("./trip").Trip[];
  journeys_by_status?: JourneyByStatus[];
  active_journey_count?: number;
  _mode?: string;
  _warning?: string;
}

export type DashboardMode = "live" | "demo";
