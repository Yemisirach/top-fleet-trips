"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle,
  Copy,
  ExternalLink,
  LayoutDashboard,
  MapPin,
  Menu,
  Moon,
  Navigation,
  Phone,
  Search,
  Sun,
  Truck,
  User,
} from "lucide-react";
import Sidebar, { WindowLogout, type SidebarView } from "@/components/layout/Sidebar";
import { useFleetUser } from "@/hooks/useFleetUser";
import { useTheme } from "@/hooks/useTheme";
import { driverPhone, isSupervisor, scopeMayetVehicles, scopeTrips } from "@/lib/scope";
import { API_BASE, DASHBOARD_CACHE_KEY, fetchCachedJson, formatSyncTime, readCachedJson } from "@/lib/api";
import LastSyncLabel, { SyncButton, tripLastSync } from "@/components/layout/LastSync";
import { resolveCityCoords } from "@/lib/cityCoords";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  buildJourneyRoute,
  buildMayetUrl,
  getJourneyRouteStops,
  getJourneyDestinations,
  getOrderCount,
  gpsTone,
  isCoordinateText,
  mayetSearchTerm,
  money,
  normalizeState,
  paymentLabel,
  stateLabel,
} from "@/lib/formatters";
import type { DashboardSnapshot } from "@/types/dashboard";
import type { GpsData, GpsPayload, LocationRow, MayetVehicle, Trip } from "@/types/trip";

const ACTIVE_STATES = new Set(["available", "assigned", "dispatched", "started", "in transit", "draft"]);

type MapPoint = {
  trip: Trip;
  route: [number, number][];
  current?: [number, number];
};

type MayetVehicleCatalog = {
  vehicles?: MayetVehicle[];
  count?: number;
  message?: string;
};

const statusTone = (status?: string) => {
  const state = normalizeState(status);
  if (state === "dispatched" || state === "started" || state === "in transit") return "#2563eb";
  if (state === "assigned" || state === "available" || state === "draft") return "#f59e0b";
  if (state === "done") return "#0e9849";
  return "#64748b";
};

const escapeHtml = (value?: string | number | null) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const tripPlate = (trip: Trip) => trip.vehicle_plate || trip.vehicle_id || String(trip.id);

const tripDestination = (trip: Trip) => getJourneyDestinations(trip);

const dbLocationLabel = (trip: Trip) =>
  trip.current_location || trip.current_location_note || trip.destination || tripDestination(trip) || "DB location pending";

const tripSubtitle = (trip: Trip) =>
  buildJourneyRoute(trip);

const locationRowToTrip = (row: LocationRow): Trip => ({
  id: row.trip_id || `vehicle:${row.vehicle_id || row.vehicle_plate}`,
  vehicle_id: row.vehicle_id ? String(row.vehicle_id) : undefined,
  vehicle_plate: row.vehicle_plate,
  vehicle_brand: row.vehicle_brand,
  driver_name: row.driver_name,
  supervisor_name: row.supervisor_name,
  driver_phone: row.driver_phone,
  origin: row.departure_name,
  destination: row.destination_name,
  current_location: row.current_location_name,
  current_location_note: row.current_location_note,
  status: row.state || "available",
  state: row.state || "available",
  departure_date: row.departure_date,
  arrival_date: row.arrival_date,
  write_date: row.arrival_date || row.departure_date,
  total_revenue: 0,
  total_expense: 0,
  trip_count: row.trip_id ? 1 : 0,
  order_count: row.trip_id ? 1 : 0,
  trips: [],
  is_vehicle_location_only: true,
});

const gpsPoint = (gps?: GpsData | null): [number, number] | undefined => {
  const latitude = Number(gps?.latitude);
  const longitude = Number(gps?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : undefined;
};

const mayetVehiclePoint = (vehicle: MayetVehicle): [number, number] | undefined => {
  const latitude = Number(vehicle.latitude ?? vehicle.lat);
  const longitude = Number(vehicle.longitude ?? vehicle.lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : undefined;
};

const mayetVehicleLocation = (vehicle: MayetVehicle): string => {
  if (vehicle.address && !isCoordinateText(vehicle.address)) return vehicle.address;
  const location = String(vehicle.location || "").trim();
  if (location && !isCoordinateText(location) && !/^(online|offline|ack|idle|stopped|moving)$/i.test(location)) {
    return location;
  }
  return "Loading current location...";
};

const gpsLocationLabel = (payload?: GpsPayload | null): string => {
  const gps = payload?.gps;
  if (!gps) return "";
  if (gps.address && !isCoordinateText(gps.address)) return gps.address;
  const location = String(gps.location || "").trim();
  return /^(online|offline|ack|idle|stopped|moving)$/i.test(location) || isCoordinateText(location) ? "" : location;
};

const mayetPopupHtml = (plate: string, location: string, capturedAt?: string) =>
  `<b>Mayet GPS</b><br>${escapeHtml(plate)}<br>${escapeHtml(location || "Current location loading...")}${
    capturedAt ? `<br><small>${escapeHtml(capturedAt)}</small>` : ""
  }`;

const telemetryValue = (value?: string | number | null, suffix = "") => {
  if (value === null || value === undefined || value === "") return "N/A";
  return `${value}${suffix}`;
};

const fuelValue = (gps?: GpsData | MayetVehicle | null) =>
  telemetryValue(gps?.fuel_level ?? gps?.fuel, "%");

const speedValue = (gps?: GpsData | MayetVehicle | null) =>
  telemetryValue(gps?.speed, " km/h");

const stopDurationValue = (gps?: GpsData | MayetVehicle | null) =>
  telemetryValue(gps?.stop_duration_text ?? gps?.stop_duration ?? gps?.stopped_for);

const mayetPopupHtmlWithTelemetry = (
  plate: string,
  location: string,
  gps?: GpsData | MayetVehicle | null,
  capturedAt?: string
) => `${mayetPopupHtml(plate, location, capturedAt)}<br><small>Speed: ${escapeHtml(speedValue(gps))} · Fuel: ${escapeHtml(fuelValue(gps))} · Stop: ${escapeHtml(stopDurationValue(gps))}</small>`;

const hasDriver = (trip: Trip) => {
  const driver = String(trip.driver_name || "").trim().toLowerCase();
  return Boolean(driver && driver !== "unassigned" && driver !== "n/a");
};

const isActiveTrip = (trip: Trip) => {
  const state = normalizeState(trip.status || trip.state);
  return ACTIVE_STATES.has(state) || !["done", "cancelled", "cancel"].includes(state);
};

const getTripRoutePoints = (trip: Trip): [number, number][] => {
  const routeNames: string[] = [];
  const add = (value?: string | null) => {
    const clean = String(value || "").trim();
    if (clean && routeNames[routeNames.length - 1] !== clean) routeNames.push(clean);
  };

  getJourneyRouteStops(trip).forEach(add);

  const points = routeNames
    .map((name) => resolveCityCoords(name))
    .filter((point): point is [number, number] => Boolean(point));

  const current =
    trip.mayet_latitude != null && trip.mayet_longitude != null
      ? ([Number(trip.mayet_latitude), Number(trip.mayet_longitude)] as [number, number])
      : null;

  if (current) points.splice(Math.min(1, points.length), 0, current);
  return points;
};

export default function MapPage() {
  return <MapContent />;
}

function MapContent() {
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const [journeyIdParam, setJourneyIdParam] = useState<string | null>(null);
  const [vehicleParam, setVehicleParam] = useState("");
  const [fullRequested, setFullRequested] = useState(false);
  const fleetUser = useFleetUser();
  const fullMap = fullRequested && !isSupervisor(fleetUser);

  const [data, setData] = useState<DashboardSnapshot>({});
  const [allTrips, setAllTrips] = useState<Trip[]>([]);
  const [mayetVehicles, setMayetVehicles] = useState<MayetVehicle[]>([]);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState("");
  const [selectedGps, setSelectedGps] = useState<GpsPayload | null>(null);
  const [mapLayer, setMapLayer] = useState<'satellite' | 'street'>('satellite');
  const [copied, setCopied] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const layerRef = useRef<unknown>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedJourney = params.get("journey_id") || params.get("trip_id");
    const requestedVehicle = params.get("vehicle") || params.get("plate") || params.get("search") || "";
    setJourneyIdParam(requestedJourney);
    setVehicleParam(requestedVehicle);
    setFullRequested(params.get("full") === "1");
    if (requestedJourney) setSelectedId(requestedJourney);
    if (requestedVehicle) setVehicleSearch(requestedVehicle);
    const cached = readCachedJson<DashboardSnapshot>(DASHBOARD_CACHE_KEY);
    if (cached) {
      const journeys = cached.vehicle_locations?.length
        ? cached.vehicle_locations.map(locationRowToTrip)
        : [];
      setData(cached);
      setAllTrips(journeys);
    }
    fetchCachedJson<DashboardSnapshot>(
      `${API_BASE}/dashboard/full?mode=live`,
      undefined,
      { ttlMs: 60_000, cacheKey: DASHBOARD_CACHE_KEY }
    )
      .then((snapshot) => {
        const journeys = snapshot.vehicle_locations?.length
          ? snapshot.vehicle_locations.map(locationRowToTrip)
          : [];
        const vehicleKey = mayetSearchTerm(requestedVehicle);
        const selected =
          journeys.find((trip) => String(trip.id) === String(requestedJourney)) ||
          journeys.find((trip) => {
            const plate = tripPlate(trip);
            return plate === requestedVehicle || mayetSearchTerm(plate) === vehicleKey;
          }) ||
          journeys[0];

        setData(snapshot);
        setAllTrips(journeys);
        setSelectedId(selected?.id || null);
        setVehicleSearch(selected ? tripPlate(selected) : requestedVehicle);
        setLoadError("");
      })
      .catch((err: unknown) => {
        if (!cached) setLoadError(err instanceof Error ? err.message : "Unable to load live dashboard data.");
      });

    const cachedCatalog = readCachedJson<MayetVehicleCatalog>("dashboard:mayet:vehicles");
    if (cachedCatalog) setMayetVehicles(Array.isArray(cachedCatalog.vehicles) ? cachedCatalog.vehicles : []);
    fetchCachedJson<MayetVehicleCatalog>(
      `${API_BASE}/dashboard/mayet/vehicles`,
      undefined,
      { ttlMs: 60_000, cacheKey: "dashboard:mayet:vehicles" }
    )
      .then((catalog) => setMayetVehicles(Array.isArray(catalog.vehicles) ? catalog.vehicles : []))
      .catch(() => setMayetVehicles([]));
  }, []);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ cacheKey?: string; data?: DashboardSnapshot | MayetVehicleCatalog }>).detail;
      if (!detail?.cacheKey || !detail.data) return;
      if (detail.cacheKey === DASHBOARD_CACHE_KEY) {
        const snapshot = detail.data as DashboardSnapshot;
        const journeys = snapshot.vehicle_locations?.length
          ? snapshot.vehicle_locations.map(locationRowToTrip)
          : [];
        setData(snapshot);
        setAllTrips(journeys);
        setLoadError("");
      }
      if (detail.cacheKey === "dashboard:mayet:vehicles") {
        const catalog = detail.data as MayetVehicleCatalog;
        setMayetVehicles(Array.isArray(catalog.vehicles) ? catalog.vehicles : []);
      }
    };
    window.addEventListener("fleet-cache-updated", onUpdate);
    return () => window.removeEventListener("fleet-cache-updated", onUpdate);
  }, []);

  const scopedTrips = useMemo(() => scopeTrips(allTrips, fleetUser), [allTrips, fleetUser]);
  const visibleMayet = useMemo(
    () => scopeMayetVehicles(mayetVehicles, scopedTrips, fleetUser),
    [mayetVehicles, scopedTrips, fleetUser],
  );
  const selectedTrip = useMemo(
    () => scopedTrips.find((trip) => String(trip.id) === String(selectedId)) || scopedTrips[0] || null,
    [scopedTrips, selectedId]
  );

  const selectedVehicleRef = useMemo(
    () => mayetSearchTerm(selectedTrip ? tripPlate(selectedTrip) : vehicleSearch),
    [selectedTrip, vehicleSearch]
  );

  useEffect(() => {
    if (!selectedVehicleRef) return;
    const cacheKey = `dashboard:gps:${selectedVehicleRef}`;
    const cached = readCachedJson<GpsPayload>(cacheKey);
    if (cached) setSelectedGps(cached);
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ cacheKey?: string; data?: GpsPayload }>).detail;
      if (detail?.cacheKey === cacheKey && detail.data) setSelectedGps(detail.data);
    };
    window.addEventListener("fleet-cache-updated", onUpdate);
    return () => window.removeEventListener("fleet-cache-updated", onUpdate);
  }, [selectedVehicleRef]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedVehicleRef) {
      return;
    }
    const pull = () => {
      fetchCachedJson<GpsPayload>(
        `${API_BASE}/dashboard/gps/${encodeURIComponent(selectedVehicleRef)}`,
        undefined,
        { ttlMs: 60_000, cacheKey: `dashboard:gps:${selectedVehicleRef}` }
      )
        .then((payload) => {
          if (!cancelled) setSelectedGps(payload);
        })
        .catch(() => {
          if (!cancelled) setSelectedGps(null);
        });
    };
    pull();
    const timer = window.setInterval(pull, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedVehicleRef]);

  useEffect(() => {
    const map = mapInstanceRef.current as any;
    if (!map || !selectedTrip) return;

    const lat = selectedTrip.mayet_latitude;
    const lng = selectedTrip.mayet_longitude;

    if (lat != null && lng != null) {
      map.flyTo([lat, lng], 15, { duration: 1.2 });
    }
  }, [selectedTrip]);

  const selectedTripForDisplay = useMemo(() => {
    if (!selectedTrip) return null;
    const gps = selectedGps?.gps;
    const point = gpsPoint(gps);
    if (!gps && !point) return selectedTrip;
    const location = gpsLocationLabel(selectedGps);
    return {
      ...selectedTrip,
      mayet_current_location: location || selectedTrip.mayet_current_location,
      mayet_address: gps?.address && !isCoordinateText(gps.address) ? gps.address : selectedTrip.mayet_address,
      mayet_captured_at: gps?.captured_at || selectedTrip.mayet_captured_at,
      mayet_latitude: point?.[0] ?? selectedTrip.mayet_latitude,
      mayet_longitude: point?.[1] ?? selectedTrip.mayet_longitude,
      mayet_speed: gps?.speed ?? selectedTrip.mayet_speed,
    };
  }, [selectedGps, selectedTrip]);

  const selectedDbLocationValue = selectedTripForDisplay
    ? dbLocationLabel(selectedTripForDisplay)
    : "DB location pending";

  const activeTrips = useMemo(
    () => scopedTrips.filter((trip) => isActiveTrip(trip) && hasDriver(trip)),
    [scopedTrips]
  );

  const activeOrderTrips = useMemo(() => {
    if (!selectedTrip) return activeTrips;
    const selectedKey = String(selectedTrip.id);
    const selectedActiveTrip = activeTrips.find((trip) => String(trip.id) === selectedKey);
    if (!selectedActiveTrip) return activeTrips;
    return [selectedActiveTrip, ...activeTrips.filter((trip) => String(trip.id) !== selectedKey)];
  }, [activeTrips, selectedTrip]);

  const unassignedTrips = useMemo(
    () => scopedTrips.filter((trip) => isActiveTrip(trip) && !hasDriver(trip)),
    [scopedTrips]
  );

  const visibleTrips = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sourceById = new Map<string, Trip>();
    [...activeTrips, ...unassignedTrips].forEach((trip) => sourceById.set(String(trip.id), trip));
    if (selectedTripForDisplay) sourceById.set(String(selectedTripForDisplay.id), selectedTripForDisplay);
    const source = Array.from(sourceById.values());
    if (!q) return source;
    return source.filter((trip) =>
      [
        trip.id,
        tripPlate(trip),
        mayetSearchTerm(tripPlate(trip)),
        trip.driver_name,
        trip.customer_name,
        trip.origin,
        tripDestination(trip),
        dbLocationLabel(trip),
        trip.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [activeTrips, unassignedTrips, query, selectedTripForDisplay]);

  useEffect(() => {
    const map = mapInstanceRef.current as any;
    if (!map) return;

    map.eachLayer((layer: any) => {
      if (layer._url) map.removeLayer(layer);
    });

    const tileUrl =
      mapLayer === 'satellite'
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

    import('leaflet').then(({ default: L }) => {
      L.tileLayer(tileUrl, {
        attribution: mapLayer === 'satellite' ? 'Esri' : 'OpenStreetMap',
      }).addTo(map);
    });
  }, [mapLayer]);

  const mapPoints = useMemo<MapPoint[]>(
    () =>
      visibleTrips.slice(0, 40).map((trip) => ({
        trip,
        route: getTripRoutePoints(trip),
        current:
          trip.mayet_latitude != null && trip.mayet_longitude != null
            ? [Number(trip.mayet_latitude), Number(trip.mayet_longitude)]
            : undefined,
      })),
    [visibleTrips]
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");

      if (!mapRef.current || !mounted) return;
      if (!mapInstanceRef.current) {
        const map = L.map(mapRef.current, {
          zoomControl: true,
          scrollWheelZoom: true,
        }).setView([9.0054, 38.7636], 6);
        const tileUrl =
          mapLayer === 'satellite'
            ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
            : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

        L.tileLayer(tileUrl, {
          attribution: "© OpenStreetMap",
        }).addTo(map);
        mapInstanceRef.current = map;
        layerRef.current = L.layerGroup().addTo(map);
      }

      const map = mapInstanceRef.current as ReturnType<typeof L.map>;
      const layer = layerRef.current as ReturnType<typeof L.layerGroup>;
      layer.clearLayers();

      const bounds: [number, number][] = [];
      const selectedBounds: [number, number][] = [];
      mapPoints.forEach(({ trip, route, current }) => {
        const color = statusTone(trip.status || trip.state);
        const isSelectedTrip = selectedTrip && String(selectedTrip.id) === String(trip.id);
        route.forEach((point) => bounds.push(point));
        if (isSelectedTrip) route.forEach((point) => selectedBounds.push(point));
        if (route.length > 1) {
          L.polyline(route, { color, weight: isSelectedTrip ? 5 : 3, opacity: isSelectedTrip ? 0.9 : 0.55, dashArray: "8 8" }).addTo(layer);
        }
        route.forEach((point, index) => {
          const isCurrent = current && point[0] === current[0] && point[1] === current[1];
          if (isSelectedTrip && isCurrent) selectedBounds.push(point);
          L.circleMarker(point, {
            radius: isCurrent ? (isSelectedTrip ? 11 : 9) : isSelectedTrip ? 8 : 6,
            color,
            fillColor: isCurrent ? color : "#fff",
            fillOpacity: isCurrent ? 0.95 : 1,
            weight: isSelectedTrip ? 4 : 3,
          })
            .addTo(layer)
            .bindPopup(
              `<b>${escapeHtml(tripPlate(trip))}</b><br>${escapeHtml(
                isCurrent ? dbLocationLabel(trip) : index === 0 ? trip.origin || "Origin" : tripDestination(trip)
              )}<br>${escapeHtml(stateLabel(trip.status || trip.state))}`
            );
        });
      });

      visibleMayet.slice(0, 250).forEach((vehicle) => {
        const point = mayetVehiclePoint(vehicle);
        if (!point) return;
        const plate = String(vehicle.plate || "Mayet vehicle");
        const isSelectedVehicle = Boolean(selectedVehicleRef && mayetSearchTerm(plate) === selectedVehicleRef);
        bounds.push(point);
        if (isSelectedVehicle) selectedBounds.push(point);
        const color = isSelectedVehicle ? "#dc2626" : gpsTone(vehicle.location);
        const vehicleIcon = L.divIcon({
          className: "fleet-vehicle-map-icon",
          html: `<div style="width:${isSelectedVehicle ? 34 : 28}px;height:${isSelectedVehicle ? 34 : 28}px;border-radius:999px;background:${escapeHtml(color)};color:#fff;display:flex;align-items:center;justify-content:center;border:${isSelectedVehicle ? 4 : 3}px solid #fff;box-shadow:0 8px 18px rgba(15,23,42,.28)"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17h4V5H2v12h3"/><path d="M14 17h1m4 0h3v-6l-3-4h-5"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg></div>`,
          iconSize: [isSelectedVehicle ? 34 : 28, isSelectedVehicle ? 34 : 28],
          iconAnchor: [isSelectedVehicle ? 17 : 14, isSelectedVehicle ? 17 : 14],
          popupAnchor: [0, isSelectedVehicle ? -18 : -14],
        });
        const marker = L.marker(point, { icon: vehicleIcon })
          .addTo(layer)
          .bindPopup(mayetPopupHtmlWithTelemetry(plate, mayetVehicleLocation(vehicle), vehicle, vehicle.captured_at));
        marker.on("popupopen", () => {
          const vehicleRef = mayetSearchTerm(plate);
          if (!vehicleRef) return;
          void fetchCachedJson<GpsPayload>(
            `${API_BASE}/dashboard/gps/${encodeURIComponent(vehicleRef)}`,
            undefined,
            { ttlMs: 60_000, cacheKey: `dashboard:gps:${vehicleRef}` }
          )
            .then((payload) => {
              const location = gpsLocationLabel(payload) || mayetVehicleLocation(vehicle);
              marker.setPopupContent(mayetPopupHtmlWithTelemetry(plate, location, payload.gps || vehicle, payload.gps?.captured_at || vehicle.captured_at));
            })
            .catch(() => {
              marker.setPopupContent(mayetPopupHtmlWithTelemetry(plate, mayetVehicleLocation(vehicle), vehicle, vehicle.captured_at));
            });
        });
        if (isSelectedVehicle) marker.openPopup();
      });

      if (selectedBounds.length) {
        map.fitBounds(L.latLngBounds(selectedBounds), { padding: [54, 54], maxZoom: 15 });
      } else if (bounds.length) {
        map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 8 });
      }
      setTimeout(() => map.invalidateSize(), 0);
    })();

    return () => {
      mounted = false;
    };
  }, [mapPoints, visibleMayet, selectedTrip, selectedVehicleRef]);

  useEffect(() => {
    return () => {
      const map = mapInstanceRef.current as { remove?: () => void } | null;
      try {
        map?.remove?.();
      } catch {
        /* The map node is already gone when the page switches. */
      }
      mapInstanceRef.current = null;
    };
  }, []);

  const selectTrip = (trip: Trip) => {
    const plate = tripPlate(trip);
    setSelectedId(trip.id);
    setVehicleSearch(plate);
    const next = new URLSearchParams({
      journey_id: String(trip.id),
      vehicle: plate,
    });
    if (fullMap) next.set("full", "1");
    window.history.pushState({}, "", `/map?${next.toString()}`);
  };

  const copyPlate = (plate = vehicleSearch) => {
    const searchTerm = mayetSearchTerm(plate);
    if (!searchTerm) return;
    void copyTextToClipboard(searchTerm).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  const openMayet = (plate = vehicleSearch, journeyId?: string | number) => {
    if (plate) copyPlate(plate);
    const baseUrl = selectedTrip?.mayet_url || "https://mayetgps.com/";
    window.open(buildMayetUrl(baseUrl, plate, journeyId || selectedTrip?.id), "mayet_gps");
  };

  const nav = (view: SidebarView) => {
    router.push(view === "overview" ? "/" : view === "finance" ? "/finance" : view === "reports" ? "/reports" : view === "payments" ? "/payments" : view === "map" ? "/map" : `/?view=${view}`);
  };

  return (
    <div className="app-shell">
      <div className={`overlay${mobileSidebarOpen ? " open" : ""}`} onClick={() => setMobileSidebarOpen(false)} />
      <Sidebar currentView={"map" as SidebarView} onViewChange={nav} mobileOpen={mobileSidebarOpen} />

      <div className="app-main" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "14px 20px",
            background: "var(--panel)",
            borderBottom: "1px solid var(--border)",
            flexWrap: "wrap",
          }}
        >
          <button className="btn md-hidden" onClick={() => setMobileSidebarOpen(true)} title="Open menu">
            <Menu size={18} />
          </button>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Fleet Live Map</h1>
            <div className="muted" style={{ fontSize: 13 }}>
              {data._mode === "live" ? "Real Odoo trips with DB current locations" : "Dashboard data pending"}{" "}
              {data._warning ? `- ${data._warning}` : ""}
            </div>
          </div>
          <div style={{ position: "relative", flex: "0 1 320px" }}>
            <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
            <input
              className="fleet-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search plate, driver, location"
              style={{ width: "100%", paddingLeft: 34, minHeight: 38 }}
            />
            <div style={{ marginTop: 6 }}><LastSyncLabel searching={Boolean(query.trim())} /></div>
            {query.trim() && (
              <div className="search-sync-results" style={{ position: "absolute", zIndex: 5, top: "100%", left: 0, right: 0, marginTop: 8, background: "var(--panel)", padding: 8 }}>
                {visibleTrips.slice(0, 6).map((trip) => (
                  <button key={trip.id} type="button" onClick={() => selectTrip(trip)} style={{ display: "grid", textAlign: "left", gap: 2 }}>
                    <strong>{tripPlate(trip)}</strong>
                    <span>Last sync {formatSyncTime(tripLastSync(trip))}</span>
                  </button>
                ))}
                {visibleTrips.length === 0 && <div className="empty">No saved matches.</div>}
              </div>
            )}
          </div>
          <SyncButton />
          <button className="btn" onClick={toggle} title="Toggle theme">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <WindowLogout />
          <button className="btn" onClick={() => openMayet()} disabled={!vehicleSearch} title="Open selected plate in Mayet">
            <ExternalLink size={16} /> Mayet
          </button>
          {!isSupervisor(fleetUser) && (
            <Link href={fullMap ? "/map" : "/map?full=1"} className="btn">
              <MapPin size={16} /> {fullMap ? "Map list" : "Full map"}
            </Link>
          )}
          <Link href={isSupervisor(fleetUser) ? "/supervisor" : "/"} className="btn primary">
            <LayoutDashboard size={16} /> {isSupervisor(fleetUser) ? "My vehicles" : "Dashboard"}
          </Link>
        </div>

        {loadError ? (
          <div className="main-content">
            <div className="login-error" style={{ padding: 16 }}>{loadError}</div>
          </div>
        ) : (
          <div
            className="map-page-grid"
            style={{
              flex: 1,
              display: "grid",
              gridTemplateColumns: fullMap ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(340px, 390px)",
              minHeight: 0,
              background: "var(--bg)",
            }}
          >
            <main style={{ minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: 10,
                  padding: 14,
                  borderBottom: "1px solid var(--border)",
                  background: "var(--panel)",
                }}
              >
                {[
                  ["Active orders", activeTrips.length],
                  ["Unassigned", unassignedTrips.length],
                  ["Mapped vehicles", mapPoints.filter((point) => point.route.length).length],
                  ["Total records", scopedTrips.length],
                ].map(([label, value]) => (
                  <div key={label} style={{ minWidth: 0 }}>
                    <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{label}</div>
                    <div style={{ fontSize: 20, fontWeight: 900 }}>{value}</div>
                  </div>
                ))}
              </div>
              <div ref={mapRef} id="fleet-live-map" style={{ flex: 1, minHeight: 420 }} />
              {fullMap && selectedTripForDisplay && (
                <div style={{ position: "absolute", left: 16, bottom: 16, zIndex: 500, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "grid", gap: 8, maxWidth: 320 }}>
                  <strong>{tripPlate(selectedTripForDisplay)}</strong>
                  <span className="muted">{selectedTripForDisplay.driver_name || "Unassigned driver"}</span>
                  <CallDriverButton trip={selectedTripForDisplay} />
                </div>
              )}
            </main>

            {!fullMap && <aside
              className="map-sidebar"
              style={{
                borderLeft: "1px solid var(--border)",
                background: "var(--panel)",
                overflowY: "auto",
                padding: 16,
                display: "grid",
                gap: 16,
                alignContent: "start",
              }}
            >
              <section>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 900 }}>Active Orders</h2>
                  <span className="mode-badge live">{data._mode || "live"}</span>
                </div>
                <div
                  className="map-order-scroll"
                  style={{
                    display: "grid",
                    gap: 10,
                    maxHeight: 354,
                    overflowY: "auto",
                    paddingRight: 4,
                  }}
                >
                  {activeOrderTrips.length ? (
                    activeOrderTrips.map((trip) => (
                      <OrderRow
                        key={trip.id}
                        trip={trip}
                        selected={selectedId ? String(selectedId) === String(trip.id) : false}
                        onSelect={() => selectTrip(trip)}
                        onCopy={() => copyPlate(tripPlate(trip))}
                        onOpen={() => openMayet(tripPlate(trip), trip.id)}
                      />
                    ))
                  ) : (
                    <div className="empty">No active assigned orders.</div>
                  )}
                </div>
              </section>

              {selectedTripForDisplay && (
                <section style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                  <h2 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 900 }}>Selected Journey</h2>
                  <div style={{ display: "grid", gap: 9, fontSize: 13 }}>
                    <InfoRow icon={<Truck size={14} />} label="Vehicle" value={tripPlate(selectedTripForDisplay)} />
                    <InfoRow icon={<User size={14} />} label="Driver" value={selectedTripForDisplay.driver_name || "Unassigned"} />
                    <InfoRow icon={<User size={14} />} label="Supervisor" value={(selectedTripForDisplay as any).supervisor_name || (selectedTripForDisplay as any).supervisor || "—"} />
                    <CallDriverButton trip={selectedTripForDisplay} />
                    <InfoRow icon={<Navigation size={14} />} label="Route" value={buildJourneyRoute(selectedTripForDisplay)} />
                    <InfoRow icon={<MapPin size={14} />} label="DB Location" value={selectedDbLocationValue} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, paddingTop: 6 }}>
                      <button className="btn" onClick={() => copyPlate(tripPlate(selectedTripForDisplay))}>
                        {copied ? <CheckCircle size={15} /> : <Copy size={15} />} Copy
                      </button>
                      <button className="btn primary" onClick={() => openMayet(tripPlate(selectedTripForDisplay), selectedTripForDisplay.id)}>
                        <ExternalLink size={15} /> Open
                      </button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, paddingTop: 4 }}>
                      <Metric label="Revenue" value={money(selectedTripForDisplay.total_revenue)} />
                      <Metric label="Expense" value={money(selectedTripForDisplay.total_expense)} />
                      <Metric label="Speed" value={speedValue(selectedGps?.gps || { speed: selectedTripForDisplay.mayet_speed })} />
                      <Metric label="Fuel" value={fuelValue(selectedGps?.gps || { fuel_level: selectedTripForDisplay.mayet_fuel_level })} />
                      <Metric label="Stop Duration" value={stopDurationValue(selectedGps?.gps)} />
                    </div>
                  </div>
                </section>
              )}

              <section>
                <h2 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 900 }}>Unassigned Orders</h2>
                <div style={{ display: "grid", gap: 10 }}>
                  {unassignedTrips.length ? (
                    unassignedTrips.slice(0, 8).map((trip) => (
                      <OrderRow
                        key={trip.id}
                        trip={trip}
                        selected={selectedId ? String(selectedId) === String(trip.id) : false}
                        onSelect={() => selectTrip(trip)}
                        onCopy={() => copyPlate(tripPlate(trip))}
                        onOpen={() => openMayet(tripPlate(trip), trip.id)}
                        compact
                      />
                    ))
                  ) : (
                    <div className="empty">No unassigned orders.</div>
                  )}
                </div>
              </section>
            </aside>}
          </div>
        )}
      </div>
    </div>
  );
}

function CallDriverButton({ trip }: { trip?: Trip | null }) {
  const phone = driverPhone(trip);
  if (!phone) {
    return (
      <button className="btn" type="button" disabled title="No driver phone is stored for this vehicle">
        <Phone size={14} /> Call driver
      </button>
    );
  }
  return (
    <a className="btn primary" href={`tel:${phone}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Phone size={14} /> Call driver
    </a>
  );
}

function OrderRow({
  trip,
  selected,
  onSelect,
  onCopy,
  onOpen,
  compact = false,
}: {
  trip: Trip;
  selected: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onOpen: () => void;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        border: `1px solid ${selected ? statusTone(trip.status || trip.state) : "var(--border)"}`,
        borderRadius: 8,
        background: selected ? "var(--primary-soft)" : "var(--bg)",
        padding: 12,
        display: "grid",
        gap: 9,
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          border: "none",
          background: "transparent",
          color: "var(--fg)",
          padding: 0,
          textAlign: "left",
          cursor: "pointer",
          display: "grid",
          gap: 7,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <strong style={{ fontSize: 14 }}>{tripPlate(trip)}</strong>
          <span
            style={{
              border: `1px solid ${statusTone(trip.status || trip.state)}`,
              color: statusTone(trip.status || trip.state),
              borderRadius: 999,
              padding: "3px 8px",
              fontSize: 11,
              fontWeight: 800,
              whiteSpace: "nowrap",
            }}
          >
            {stateLabel(trip.status || trip.state)}
          </span>
        </div>
        <div className="muted" style={{ display: "grid", gap: 4, fontSize: 12, lineHeight: 1.35 }}>
          <span>{tripSubtitle(trip)}</span>
          {!compact && <span>{trip.driver_name || "Unassigned driver"} - {paymentLabel(trip)} - {getOrderCount(trip)} orders</span>}
        </div>
      </button>
      <div style={{ display: "flex", gap: 8 }}>
        <CallDriverButton trip={trip} />
        <button className="btn" onClick={onCopy} title="Copy plate" style={{ flex: 1, minHeight: 34 }}>
          <Copy size={14} />
        </button>
        <button className="btn" onClick={onOpen} title="Open in Mayet GPS" style={{ flex: 1, minHeight: 34 }}>
          <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value?: string | number | null }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "96px minmax(0, 1fr)", gap: 10, alignItems: "start" }}>
      <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{icon}{label}</span>
      <strong style={{ minWidth: 0, overflowWrap: "anywhere" }}>{value || "N/A"}</strong>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, background: "var(--bg)" }}>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontWeight: 900, fontSize: 13, overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}
