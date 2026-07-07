"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { resolveCityCoords, CITY_COORDS } from "@/lib/cityCoords";
import { paymentLabel, stateLabel, firstPlateNumber } from "@/lib/formatters";
import type { Trip } from "@/types/trip";

interface DashboardMapProps {
  trips: Trip[];
}

export default function DashboardMap({ trips }: DashboardMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const layerRef = useRef<unknown>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");

      if (!mapRef.current || !mounted) return;

      if (!mapInstanceRef.current) {
        const m = L.map(mapRef.current, { scrollWheelZoom: false }).setView(
          [9.0054, 38.7636],
          6
        );
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap",
        }).addTo(m);
        mapInstanceRef.current = m;
        layerRef.current = L.layerGroup().addTo(m);
      }

      const map = mapInstanceRef.current as ReturnType<typeof L.map>;
      const layer = layerRef.current as ReturnType<typeof L.layerGroup>;
      layer.clearLayers();

      const points: [number, number][] = [];
      trips.slice(0, 12).forEach((trip) => {
        const origin = trip.origin || "Addis Ababa";
        const dest =
          Array.isArray(trip.destinations) && trip.destinations.length
            ? trip.destinations[0]
            : trip.destination;
        const o = resolveCityCoords(origin);
        const d = resolveCityCoords(dest);
        if (o) {
          points.push(o);
          L.circleMarker(o, {
            radius: 6,
            color: "#00499e",
            fillColor: "#00499e",
            fillOpacity: 0.85,
          })
            .addTo(layer)
            .bindPopup(`<b>${trip.vehicle_plate || trip.id}</b><br>${origin}`);
        }
        if (d) {
          points.push(d);
          L.circleMarker(d, {
            radius: 7,
            color: "#0e9849",
            fillColor: "#0e9849",
            fillOpacity: 0.85,
          })
            .addTo(layer)
            .bindPopup(`<b>${trip.vehicle_plate || trip.id}</b><br>${dest}`);
        }
        if (o && d)
          L.polyline([o, d], { color: "#00499e", weight: 3, opacity: 0.7 }).addTo(layer);
      });

      if (points.length) {
        map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 8 });
      }
      setTimeout(() => map.invalidateSize(), 0);
    })();
    return () => {
      mounted = false;
    };
  }, [trips]);

  const sideTrips = trips.slice(0, 5);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16, minHeight: 340 }}>
      <div
        ref={mapRef}
        id="dashboard-map"
        style={{ minHeight: 300, borderRadius: 8, border: "1px solid var(--line)", overflow: "hidden" }}
      />
      <div id="map-side" style={{ display: "grid", gap: 8, alignContent: "start" }}>
        {sideTrips.length === 0 ? (
          <div className="empty">No map records.</div>
        ) : (
          sideTrips.map((t) => (
            <button
              key={t.id}
              className="map-side-row"
              type="button"
              style={{ cursor: "pointer", textAlign: "left" }}
              onClick={() => {
                const plate = t.vehicle_plate || t.vehicle_id || String(t.id);
                const searchStr = firstPlateNumber(plate);
                if (searchStr) navigator.clipboard.writeText(searchStr);
                window.open(`https://mayetgps.com/objects?search=${encodeURIComponent(searchStr)}`, "mayet_gps");
              }}
            >
              <div className="map-side-label">
                {stateLabel(t.status)} · {paymentLabel(t)}
              </div>
              <div className="map-side-value">{t.vehicle_plate || String(t.id)}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {t.customer_name || "Customer"} ·{" "}
                {Array.isArray(t.destinations) ? t.destinations.join(", ") : t.destination || "Destination pending"}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
