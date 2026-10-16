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
  all_trip_rows?: import("./trip").Trip[];
  vehicle_locations?: import("./trip").LocationRow[];
  journeys_by_status?: JourneyByStatus[];
  active_journey_count?: number;
  driver_conflict_count?: number;
  driver_conflicts?: {
    driver_name: string;
    vehicle_count: number;
    vehicles: string[];
    journey_count: number;
    journeys: {
      id?: string | number;
      vehicle_plate?: string;
      status?: string;
      destination?: string;
      departure_date?: string;
    }[];
  }[];
  vehicle_conflict_count?: number;
  vehicle_conflicts?: {
    vehicle_plate: string;
    driver_count: number;
    drivers: string[];
    journey_count: number;
    journeys: {
      id?: string | number;
      driver_name?: string;
      status?: string;
      destination?: string;
      departure_date?: string;
    }[];
  }[];
  _mode?: string;
  _warning?: string;
  _stale_live_cache?: boolean;
  _cache_saved_at?: number;
  _cache_message?: string;
}

export type DashboardMode = "live";
