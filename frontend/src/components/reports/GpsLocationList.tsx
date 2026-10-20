import Link from "next/link";
import { mayetSearchTerm, stateLabel } from "@/lib/formatters";
import type { LocationRow, MayetVehicle } from "@/types/trip";

const plateKey = (value?: string) => mayetSearchTerm(value);

const coordText = (vehicle?: MayetVehicle) => {
  const latitude = Number(vehicle?.latitude ?? vehicle?.lat);
  const longitude = Number(vehicle?.longitude ?? vehicle?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (!latitude && !longitude)) return "";
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
};

const trackerStatus = (vehicle?: MayetVehicle) => {
  const status = String(vehicle?.location || "").trim();
  if (!status || /^-?\d/.test(status)) return "";
  return status;
};

export default function GpsLocationList({
  trips,
  gpsVehicles,
  error,
}: {
  trips: LocationRow[];
  gpsVehicles: MayetVehicle[];
  error?: string;
}) {
  const gpsByPlate = new Map<string, MayetVehicle>();
  gpsVehicles.forEach((vehicle) => {
    const key = plateKey(vehicle.plate);
    if (key && !gpsByPlate.has(key)) gpsByPlate.set(key, vehicle);
  });

  const rows = trips.map((trip, index) => {
    const plate = trip.vehicle_plate || "N/A";
    const gps = gpsByPlate.get(plateKey(plate));
    const params = new URLSearchParams();
    if (trip.trip_id) params.set("journey_id", String(trip.trip_id));
    if (trip.vehicle_plate) params.set("vehicle", trip.vehicle_plate);
    return {
      key: `${trip.trip_id || trip.vehicle_id || plate}:${index}`,
      trip,
      plate,
      gps,
      href: `/map?${params.toString()}`,
    };
  });

  if (error) return <div className="login-error">{error}</div>;
  if (rows.length === 0) return <div className="muted">No trips in this list.</div>;

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">GPS current location list</div>
          <div className="finance-sheet-note">Tracker position, not the database location. Open map for the trip.</div>
        </div>
      </div>
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
            {rows.map((row) => {
              const status = trackerStatus(row.gps);
              const coords = coordText(row.gps);
              return (
                <tr key={row.key}>
                  <td><strong>{row.plate}</strong></td>
                  <td>{row.trip.supervisor_name || "Unassigned"}</td>
                  <td>{row.trip.driver_name || "Unassigned"}</td>
                  <td>{row.trip.destination_name || "–"}</td>
                  <td>
                    {coords ? (
                      <>
                        <strong>{coords}</strong>
                        <span className="finance-sub">{status || stateLabel(row.trip.state)}</span>
                      </>
                    ) : (
                      <span className="muted">No GPS</span>
                    )}
                  </td>
                  <td>{row.gps?.captured_at || "–"}</td>
                  <td>
                    <Link className="fleet-btn" href={row.href}>Open map</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
