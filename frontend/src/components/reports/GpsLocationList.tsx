"use client";

import { useState } from "react";
import Link from "next/link";
import { mayetSearchTerm, stateLabel } from "@/lib/formatters";
import type { LocationRow, MayetVehicle } from "@/types/trip";

export type GpsPlace = {
  plate?: string;
  latitude?: number;
  longitude?: number;
  short_name?: string;
  full_name?: string;
  pending?: boolean;
};

const plateKey = (value?: string) => mayetSearchTerm(value);

const coordText = (latitude?: number, longitude?: number) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (!lat && !lng)) return "";
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
};

const trackerStatus = (vehicle?: MayetVehicle) => {
  const status = String(vehicle?.location || "").trim();
  if (!status || /^-?\d/.test(status)) return "";
  return status;
};

function PlaceName({
  shortName,
  fullName,
  coords,
  pending,
  expanded,
  onToggle,
}: {
  shortName: string;
  fullName: string;
  coords: string;
  pending: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const name = shortName || (pending ? "" : coords);
  const long = Boolean(fullName && fullName !== name && fullName.length > name.length);
  if (!name && pending) {
    return (
      <>
        <strong>Finding place name…</strong>
        {coords && <span className="finance-sub">{coords}</span>}
      </>
    );
  }
  if (!name) return <span className="muted">No GPS</span>;
  return (
    <>
      <strong>{expanded && long ? fullName : name}</strong>
      <span className="finance-sub">{coords}</span>
      {long && (
        <button type="button" className="gps-see-more" onClick={onToggle}>
          {expanded ? "See less" : "See more"}
        </button>
      )}
    </>
  );
}

export default function GpsLocationList({
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
  const [expanded, setExpanded] = useState<string[]>([]);
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
    const params = new URLSearchParams();
    if (trip.trip_id) params.set("journey_id", String(trip.trip_id));
    if (trip.vehicle_plate) params.set("vehicle", trip.vehicle_plate);
    return {
      key: `${trip.trip_id || trip.vehicle_id || plate}:${index}`,
      trip,
      plate,
      gps,
      place,
      coords,
      status: trackerStatus(gps),
      href: `/map?${params.toString()}`,
    };
  });
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? rows.filter((row) => [
        row.plate,
        row.trip.supervisor_name,
        row.trip.driver_name,
        row.trip.destination_name,
        row.trip.current_location_name,
        row.trip.current_location_note,
        row.trip.state,
        stateLabel(row.trip.state),
        row.status,
        row.coords,
        row.place?.short_name,
        row.place?.full_name,
        row.gps?.captured_at,
      ].join(" ").toLowerCase().includes(needle))
    : rows;

  if (error) return <div className="login-error">{error}</div>;

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">GPS current location list</div>
          <div className="finance-sheet-note">
            {visible.length} of {rows.length} trips. Search matches every column. Open map for the trip.
          </div>
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="muted" style={{ padding: 16 }}>No trips match this search.</div>
      ) : (
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Plate</th>
                <th>Supervisor</th>
                <th>Driver</th>
                <th>Destination</th>
                <th>Real location</th>
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
                  <td>{row.trip.destination_name || "–"}</td>
                  <td>
                    <PlaceName
                      shortName={row.place?.short_name || ""}
                      fullName={row.place?.full_name || ""}
                      coords={row.coords}
                      pending={Boolean(row.coords && row.place?.pending !== false && !row.place?.short_name)}
                      expanded={expanded.includes(row.key)}
                      onToggle={() => setExpanded((current) => current.includes(row.key) ? current.filter((key) => key !== row.key) : [...current, row.key])}
                    />
                  </td>
                  <td>{row.gps?.captured_at || "–"}</td>
                  <td>
                    <Link className="fleet-btn" href={row.href}>Open map</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
