// ── Trip / Journey types ──────────────────────────────
export interface TripLeg {
  id?: string | number;
  origin?: string;
  destination?: string;
  departure_date?: string;
  arrival_date?: string;
  create_date?: string;
  write_date?: string;
  distance_km?: number;
  revenue?: number;
  expense?: number;
  paid_amount?: number;
  pending_payment?: number;
  pending_expense_payment?: number;
  payment_request_total?: number;
  payment_request_count?: number;
  payment_request_lines?: PaymentRequestLine[];
  status?: string;
  synthetic?: boolean;
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
  supervisor_name?: string;
  customer_name?: string;
  origin?: string;
  destination?: string;
  destinations?: string[];
  journey_start?: string;
  journey_end?: string;
  journey_started_at_factory?: boolean;
  journey_ended_at_factory?: boolean;
  departure_date?: string;
  return_date?: string;
  arrival_date?: string;
  create_date?: string;
  write_date?: string;
  total_revenue?: number;
  total_expense?: number;
  paid_amount?: number;
  pending_payment?: number;
  pending_expense_payment?: number;
  payment_request_total?: number;
  payment_request_count?: number;
  payment_request_lines?: PaymentRequestLine[];
  trip_count?: number;
  order_count?: number;
  order_receivable_count?: number;
  current_location?: string;
  current_location_note?: string;
  mayet_status?: string;
  mayet_current_location?: string;
  mayet_address?: string;
  mayet_captured_at?: string;
  mayet_latitude?: number;
  mayet_longitude?: number;
  mayet_speed?: number;
  mayet_mileage?: number;
  mayet_fuel_level?: number;
  mayet_url?: string;
  trips?: TripLeg[];
  is_vehicle_location_only?: boolean;
}

export interface PaymentRequestLine {
  request_id?: string | number;
  request_name?: string;
  request_state?: string;
  item?: string;
  description?: string;
  amount?: number;
  quantity?: number;
  total?: number;
}

// ── Payment request ──────────────────────────────────
export interface PaymentRequest {
  id: string | number;
  name?: string;
  reference?: string;
  trip_id?: string | number;
  trip_reference?: string;
  origin?: string;
  destination?: string;
  route_name?: string;
  vehicle_plate?: string;
  state?: string;
  date?: string;
  approved_on?: string;
  requester_name?: string;
  customer_id?: string | number;
  customer_name?: string;
  supervisor_name?: string;
  driver_name?: string;
  total_amount?: number;
  customer_receivable_total?: number;
  customer_paid_amount?: number;
  customer_pending_amount?: number;
  source?: string;
  request_text?: string;
  line_items?: PaymentRequestLine[];
}

// ── Report types ─────────────────────────────────────
export interface LocationRow {
  vehicle_id?: string | number;
  trip_id?: string | number;
  reference?: string;
  vehicle_plate?: string;
  vehicle_brand?: string;
  supervisor_name?: string;
  driver_name?: string;
  departure_name?: string;
  destination_name?: string;
  current_location_name?: string;
  current_location_note?: string;
  departure_date?: string;
  arrival_date?: string;
  write_date?: string;
  create_date?: string;
  days_as_of?: string;
  days_basis?: "arrival" | "departure" | "write" | "create" | "none" | string;
  state?: string;
  current_location_days?: number;
  days?: number;
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
  group_by?: string;
  group_label?: string;
  trip_count: number;
  revenue_total: number;
  expense_total: number;
  profit: number;
  pending_cost?: number;
}

export interface FinanceSummary {
  period: string;
  group_by?: string;
  periods: FinancePeriod[];
  totals: {
    trip_count: number;
    revenue_total: number;
    expense_total: number;
    profit: number;
    pending_cost?: number;
  };
  _warning?: string;
}

export interface FinanceCard {
  key: "daily" | "weekly" | "monthly" | string;
  label: string;
  period_start: string;
  period_end: string;
  trip_count: number;
  revenue_total: number;
  expense_total: number;
  profit: number;
  pending_cost: number;
}

export interface FinanceCards {
  as_of: string;
  timezone: string;
  cards: FinanceCard[];
}

export interface FinanceTrip {
  trip_id: number;
  trip_name: string;
  trip_day: string | null;
  driver_name: string;
  plate_number: string;
  route: string;
  supervisor_name: string;
  customer_name: string;
  revenue_total: number;
  cost_total: number;
  profit: number;
  pending_cost: number;
  receivable_posted: boolean;
  cost_source: "expense_lines" | "payment_request" | string;
  expense_line_total: number;
  request_total: number;
}

export interface FinanceTripDetail extends FinanceTrip {
  receivables: Array<{
    customer_name: string;
    amount_due: number;
    state: string;
    date_created: string | null;
  }>;
  expense_lines: Array<{
    type_name: string;
    description: string;
    quantity: number;
    amount: number;
    total: number;
  }>;
  payment_lines: Array<{
    request_id: number;
    request_name: string;
    state: string;
    item: string;
    description: string;
    quantity: number;
    amount: number;
    total: number;
  }>;
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
  receivable_posted?: boolean;
  profit_note?: string;
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
    pending_trip_count?: number;
    pending_cost_total?: number;
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
  fuel?: number;
  fuel_level?: number;
  stop_duration?: string | number;
  stop_duration_text?: string;
  stopped_for?: string;
  ignition?: string;
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
  fuel?: number;
  fuel_level?: number;
  stop_duration?: string | number;
  stop_duration_text?: string;
  stopped_for?: string;
  ignition?: string;
}
