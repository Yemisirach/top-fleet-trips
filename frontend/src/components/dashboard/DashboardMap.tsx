"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { resolveCityCoords } from "@/lib/cityCoords";
import { getJourneyDestinations, getJourneyRouteStops, paymentLabel, stateLabel } from "@/lib/formatters";
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
        const routePoints = getJourneyRouteStops(trip)
          .map((stop) => ({ stop, point: resolveCityCoords(stop) }))
          .filter((item): item is { stop: string; point: [number, number] } => Boolean(item.point));

        routePoints.forEach(({ stop, point }, index) => {
          points.push(point);
          L.circleMarker(point, {
            radius: 6,
            color: index === 0 ? "#00499e" : "#0e9849",
            fillColor: index === 0 ? "#00499e" : "#0e9849",
            fillOpacity: 0.85,
          })
            .addTo(layer)
            .bindPopup(`<b>${trip.vehicle_plate || trip.id}</b><br>${stop}`);
        });
        if (routePoints.length > 1)
          L.polyline(routePoints.map(({ point }) => point), { color: "#00499e", weight: 3, opacity: 0.7 }).addTo(layer);
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
                window.location.href = `/map?journey_id=${encodeURIComponent(t.id)}&vehicle=${encodeURIComponent(plate)}`;
              }}
            >
              <div className="map-side-label">
                {stateLabel(t.status)} · {paymentLabel(t)}
              </div>
              <div className="map-side-value">{t.vehicle_plate || String(t.id)}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {t.customer_name || "Customer not set"} · {getJourneyDestinations(t)}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
