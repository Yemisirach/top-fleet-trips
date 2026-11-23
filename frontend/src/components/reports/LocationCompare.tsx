"use client";

import Link from "next/link";
import { mayetSearchTerm } from "@/lib/formatters";
import type { LocationRow, MayetVehicle } from "@/types/trip";
import type { GpsPlace } from "@/components/reports/GpsLocationList";

const plateKey = (value?: string) => mayetSearchTerm(value);

const coordText = (latitude?: number, longitude?: number) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (!lat && !lng)) return "";
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
};

const cleanName = (value?: string | null) =>
  String(value || "")
    .toLowerCase()
    .replace(/^\*\s*pending destination.*$/i, "")
    .replace(/[^a-z0-9\u1200-\u137f]+/gi, " ")
    .trim();

const namesMatch = (left?: string | null, right?: string | null) => {
  const a = cleanName(left);
  const b = cleanName(right);
  if (!a || !b || a.length < 3 || b.length < 3) return false;
  return a.includes(b) || b.includes(a);
};

export default function LocationCompare({
  trips,
  gpsVehicles,
  places = [],
  query = "",
  error,
}: {
  trips: LocationRow[];
  gpsVehicles: MayetVehicle[];
  places?: GpsPlace[];
  query?: string;
  error?: string;
}) {
  const gpsByPlate = new Map<string, MayetVehicle>();
  gpsVehicles.forEach((vehicle) => {
    const key = plateKey(vehicle.plate);
    if (key && !gpsByPlate.has(key)) gpsByPlate.set(key, vehicle);
  });
  const placeByPlate = new Map<string, GpsPlace>();
  places.forEach((place) => {
    const key = plateKey(place.plate);
    if (key && !placeByPlate.has(key)) placeByPlate.set(key, place);
  });

  const rows = trips.map((trip, index) => {
    const plate = trip.vehicle_plate || "N/A";
    const gps = gpsByPlate.get(plateKey(plate));
    const place = placeByPlate.get(plateKey(plate));
    const latitude = place?.latitude ?? gps?.latitude ?? gps?.lat;
    const longitude = place?.longitude ?? gps?.longitude ?? gps?.lng;
    const coords = coordText(latitude, longitude);
    const gpsName = place?.short_name || place?.full_name || "";
    const dbLocation = trip.current_location_name || "Unknown";
    const hasGps = Boolean(gpsName || coords);
    const status = !hasGps ? "No GPS" : namesMatch(dbLocation, gpsName) || namesMatch(trip.current_location_note, gpsName) ? "Same" : "Different";
    const params = new URLSearchParams();
    if (trip.trip_id) params.set("journey_id", String(trip.trip_id));
    if (trip.vehicle_plate) params.set("vehicle", trip.vehicle_plate);
    return {
      key: `${trip.trip_id || trip.vehicle_id || plate}:${index}`,
      trip,
      plate,
      dbLocation,
      gpsName,
      coords,
      pending: Boolean(coords && !gpsName),
      status,
      seen: gps?.captured_at || "",
      href: `/map?${params.toString()}`,
    };
  });

  const needle = query.trim().toLowerCase();
  const visible = (needle
    ? rows.filter((row) => [
        row.plate,
        row.trip.supervisor_name,
        row.trip.driver_name,
        row.dbLocation,
        row.trip.current_location_note,
        row.trip.reference,
        row.gpsName,
        row.coords,
        row.status,
      ].join(" ").toLowerCase().includes(needle))
    : rows
  ).slice().sort((a, b) => {
    const rank = (status: string) => status === "Different" ? 0 : status === "No GPS" ? 1 : 2;
    return rank(a.status) - rank(b.status) || a.plate.localeCompare(b.plate);
  });
  const counts = {
    same: rows.filter((row) => row.status === "Same").length,
    different: rows.filter((row) => row.status === "Different").length,
    missing: rows.filter((row) => row.status === "No GPS").length,
  };

  if (error) return <div className="login-error">{error}</div>;

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">Compare locations</div>
          <div className="finance-sheet-note">
            Database location next to the GPS location. {visible.length} of {rows.length} vehicles.
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, padding: "0 16px 12px", flexWrap: "wrap" }}>
        <div className="card"><div className="card-label">Different</div><div className="card-value red">{counts.different}</div></div>
        <div className="card"><div className="card-label">Same</div><div className="card-value green">{counts.same}</div></div>
        <div className="card"><div className="card-label">No GPS</div><div className="card-value">{counts.missing}</div></div>
      </div>
      {visible.length === 0 ? (
        <div className="muted" style={{ padding: 16 }}>No vehicles match this search.</div>
      ) : (
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Plate</th>
                <th>Supervisor</th>
                <th>Driver</th>
                <th>DB location</th>
                <th>GPS location</th>
                <th>Compare</th>
                <th>Seen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.key}>
                  <td><strong>{row.plate}</strong></td>
                  <td>{row.trip.supervisor_name || "Unassigned"}</td>
                  <td>{row.trip.driver_name || "Unassigned"}</td>
                  <td>
                    <strong>{row.dbLocation}</strong>
                    {row.trip.reference && <div className="finance-sub">{row.trip.reference}</div>}
                    {row.trip.current_location_note && <div className="finance-sub">{row.trip.current_location_note}</div>}
                  </td>
                  <td>
                    {row.gpsName ? <strong>{row.gpsName}</strong> : row.pending ? <strong>Finding place name…</strong> : <span className="muted">No GPS</span>}
                    {row.coords && <div className="finance-sub">{row.coords}</div>}
                  </td>
                  <td className={row.status === "Same" ? "green" : row.status === "Different" ? "red" : ""}>{row.status}</td>
                  <td>{row.seen || "–"}</td>
                  <td><Link className="fleet-btn" href={row.href}>Open map</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
