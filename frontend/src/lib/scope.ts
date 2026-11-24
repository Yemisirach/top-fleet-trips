import type { DashboardSnapshot } from "@/types/dashboard";
import type { MayetVehicle, Trip } from "@/types/trip";

export type FleetUser = {
  username?: string;
  expires_at?: number;
  name?: string;
  role?: string;
};

const ROLE_KEY = "fleet-role";
const NAME_KEY = "fleet-name";

const USER_KEY = "fleet-user-v2";
const OWNER_KEY = "fleet-active-user-v2";

export function rememberFleetUser(user?: FleetUser | null) {
  if (typeof window === "undefined" || !user?.username || window.localStorage.getItem("fleet-logged-out") === "1") return;
  const saved = { ...user, expires_at: user.expires_at || Math.floor(Date.now() / 1000) + 12 * 60 * 60 };
  window.sessionStorage.setItem(USER_KEY, JSON.stringify(saved));
  window.sessionStorage.setItem(ROLE_KEY, user.role || "");
  window.sessionStorage.setItem(NAME_KEY, user.name || "");
  window.localStorage.setItem(OWNER_KEY, `${user.username}:${user.role}:${user.name}`);
}

export function clearFleetUser() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(USER_KEY);
  window.sessionStorage.removeItem(ROLE_KEY);
  window.sessionStorage.removeItem(NAME_KEY);
  window.localStorage.removeItem(OWNER_KEY);
}

export function storedFleetUser(): FleetUser | null {
  if (typeof window === "undefined") return null;
  try {
    const user = JSON.parse(window.sessionStorage.getItem(USER_KEY) || "null") as FleetUser | null;
    if (!user?.username || !user.expires_at || user.expires_at <= Date.now() / 1000) return null;
    if (window.localStorage.getItem(OWNER_KEY) !== `${user.username}:${user.role}:${user.name}`) return null;
    return user;
  } catch { return null; }
}

export function fleetCacheScope(): string {
  const user = storedFleetUser();
  return user ? `user-v2:${encodeURIComponent(JSON.stringify([user.username, user.role, user.name]))}:` : "";
}

export function isSupervisor(user?: FleetUser | null) {
  return user?.role === "supervisor";
}

function sameName(left?: string, right?: string) {
  return (left || "").trim().toLowerCase() === (right || "").trim().toLowerCase();
}

export function plateKey(value?: string | number | null) {
  const digits = String(value || "").replace(/\D/g, "").replace(/^0+/, "");
  return digits;
}

export function trackerKey(value?: string | number | null) {
  const numbers = String(value || "").match(/\d+/g) || [];
  const chosen = numbers.find((part) => part.length >= 4) || numbers[0] || "";
  return chosen.replace(/^0+/, "") || chosen;
}

export function scopeTrips(trips: Trip[], user?: FleetUser | null): Trip[] {
  if (!isSupervisor(user)) return trips;
  const name = user?.name || "";
  return trips.filter((trip) => sameName(trip.supervisor_name, name));
}

export function scopeDashboard(snapshot: DashboardSnapshot, user?: FleetUser | null): DashboardSnapshot {
  if (!isSupervisor(user) || !snapshot) return snapshot;
  const name = user?.name || "";
  const locations = (snapshot.vehicle_locations || []).filter((row) => sameName(row.supervisor_name, name));
  const keys = new Set(locations.map((row) => plateKey(row.vehicle_plate)).filter(Boolean));
  const ids = new Set(locations.map((row) => String(row.vehicle_id || "")).filter(Boolean));
  const owns = (row: { supervisor_name?: string; vehicle_plate?: string; vehicle_id?: string | number }) =>
    sameName(row.supervisor_name, name) || keys.has(plateKey(row.vehicle_plate)) || ids.has(String(row.vehicle_id || ""));
  const journeys = (snapshot.recent_journeys || []).filter(owns);
  return {
    ...snapshot,
    vehicle_locations: locations,
    recent_journeys: journeys,
    all_trip_rows: (snapshot.all_trip_rows || []).filter(owns),
    scope: "assigned",
    supervisor_name: name,
  };
}

export function scopeMayetVehicles(vehicles: MayetVehicle[], trips: Trip[], user?: FleetUser | null) {
  if (!isSupervisor(user)) return vehicles;
  const keys = new Set(trips.map((trip) => plateKey(trip.vehicle_plate)).filter(Boolean));
  return vehicles.filter((vehicle) => keys.has(plateKey(vehicle.plate)));
}

export function driverPhone(trip?: { driver_phone?: string; phone?: string } | null) {
  return String(trip?.driver_phone || trip?.phone || "").trim();
}
