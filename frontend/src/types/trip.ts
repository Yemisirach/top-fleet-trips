// ── Trip / Journey types ──────────────────────────────
export interface TripLeg {
  id?: string | number;
  origin?: string;
  destination?: string;
  departure_date?: string;
  arrival_date?: string;
  distance_km?: number;
  revenue?: number;
  expense?: number;
  status?: string;
}

export interface Trip {
  id: string | number;
  name?: string;
  status?: string;
  state?: string;
  vehicle_plate?: string;
  vehicle_id?: string;
  vehicle_brand?: string;
  driver_name?: string;
  customer_name?: string;
  origin?: string;
  destination?: string;
  destinations?: string[];
  journey_start?: string;
  journey_end?: string;
  departure_date?: string;
  return_date?: string;
  arrival_date?: string;
  create_date?: string;
  total_revenue?: number;
  total_expense?: number;
  paid_amount?: number;
  pending_payment?: number;
  pending_expense_payment?: number;
  payment_request_total?: number;
  trip_count?: number;
  order_count?: number;
  order_receivable_count?: number;
  current_location?: string;
  current_location_note?: string;
  mayet_status?: string;
  mayet_captured_at?: string;
  mayet_latitude?: number;
  mayet_longitude?: number;
  trips?: TripLeg[];
}

// ── Payment request ──────────────────────────────────
export interface PaymentRequest {
  id: string | number;
  name?: string;
  reference?: string;
  trip_id?: string | number;
  trip_reference?: string;
  vehicle_plate?: string;
  state?: string;
  date?: string;
  approved_on?: string;
  requester_name?: string;
  supervisor_name?: string;
  total_amount?: number;
  source?: string;
  request_text?: string;
  line_items?: { item: string; description: string; amount: number }[];
}

// ── Report types ─────────────────────────────────────
export interface LocationRow {
  trip_id?: string | number;
  reference?: string;
  vehicle_plate?: string;
  driver_name?: string;
  departure_name?: string;
  destination_name?: string;
  current_location_name?: string;
  current_location_note?: string;
  departure_date?: string;
  arrival_date?: string;
  state?: string;
  current_location_days?: number;
}

export interface LocationSummaryGroup {
  location_name: string;
  vehicle_count: number;
  vehicles: LocationRow[];
}

export interface LocationSummary {
  locations: LocationSummaryGroup[];
  total_locations: number;
  total_vehicles: number;
  _warning?: string;
}

export interface FinancePeriod {
  period_start: string;
  trip_count: number;
  revenue_total: number;
  expense_total: number;
  profit: number;
}

export interface FinanceSummary {
  period: string;
  periods: FinancePeriod[];
  totals: {
    trip_count: number;
    revenue_total: number;
    expense_total: number;
    profit: number;
  };
  _warning?: string;
}

export interface DailyProfitRow {
  no: number;
  driver_name: string;
  plate_number: string;
  rent_amount: number;
  daily_total_cost: number;
  actual_daily_total_revenue: number;
  actual_net_profit: number;
  daily_net_profit: number;
  remarks: string;
  trip_id?: string | number;
  report_date?: string;
}

export interface DailyProfit {
  report_date?: string;
  rows: DailyProfitRow[];
  totals: {
    vehicle_count: number;
    rent_total: number;
    cost_total: number;
    revenue_total: number;
    net_profit_total: number;
    daily_net_profit_total: number;
  };
  _warning?: string;
}

export interface IncomeStatement {
  trip_count: number;
  expense_total: number;
  revenue_total: number;
  profit: number;
  receivable_count: number;
  payment_request_count: number;
  _warning?: string;
}

// ── GPS ──────────────────────────────────────────────
export interface GpsData {
  plate?: string;
  latitude?: number;
  longitude?: number;
  location?: string;
  address?: string;
  speed?: number;
  battery?: number;
  mileage?: number;
  captured_at?: string;
}

export interface GpsPayload {
  gps?: GpsData | null;
  mayet_url?: string;
  message?: string;
}

export interface MayetVehicle {
  plate?: string;
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
  location?: string;
  address?: string;
  captured_at?: string;
  speed?: number;
}
