import { fleetCacheScope, storedFleetUser, clearFleetUser, rememberFleetUser } from "@/lib/scope";
import { idbAll, idbPut, idbClear } from "@/lib/fleet-db";

export const API_BASE = "/api";
export const DASHBOARD_CACHE_KEY = "dashboard:live:journey-routes-full-odoo-v11-own-receivable-only";
const memoryCache = new Map<string, unknown>();

export async function fetchJson<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function sessionIsActive(): Promise<boolean> {
  if (getCacheStorage("local")?.getItem("fleet-logged-out") === "1") return false;
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
    if (res.status === 401) { await resetFleetCache(); return false; }
    if (res.ok) {
      const payload = await res.json();
      rememberFleetUser(payload.user);
      return true;
    }
    return Boolean(storedFleetUser());
  } catch {
    return Boolean(storedFleetUser());
  }
}

interface CacheOptions {
  ttlMs?: number;
  cacheKey?: string;
  storage?: "local" | "session";
  forceRefresh?: boolean;
}

interface SyncTarget {
  url: string;
  cacheKey: string;
  ttlMs: number;
}

const LAST_SYNC_KEY = "fleet-last-sync";
const REGISTRY_KEY = "fleet-sync-registry";
const CORE_SYNCS: SyncTarget[] = [
  { url: "/api/dashboard/full?mode=live", cacheKey: DASHBOARD_CACHE_KEY, ttlMs: 6 * 60 * 60 * 1000 },
  { url: "/api/dashboard/mayet/vehicles", cacheKey: "dashboard:mayet:vehicles", ttlMs: 60_000 },
  { url: "/api/reports/payment-requests", cacheKey: "reports:payment-requests:odoo-db-v6-trip", ttlMs: 60_000 },
  { url: "/api/reports/payment-requests", cacheKey: "reports:payment-requests:odoo-db-v5", ttlMs: 60_000 },
  { url: "/api/reports/current-location", cacheKey: "reports:current-location-supervised-v2", ttlMs: 60_000 },
  { url: "/api/reports/current-location-summary", cacheKey: "reports:current-location-summary-supervised-v5", ttlMs: 60_000 },
  { url: "/api/reports/current-location-summary", cacheKey: "reports:current-location-summary-supervised-v2", ttlMs: 60_000 },
  { url: "/api/reports/daily-profit", cacheKey: "reports:daily-profit-v11:latest", ttlMs: 60_000 },
  { url: "/api/reports/daily-profit", cacheKey: "reports:daily-profit:latest", ttlMs: 60_000 },
  { url: "/api/reports/income-statement", cacheKey: "reports:income-statement", ttlMs: 60_000 },
  { url: "/api/reports/finance-cards", cacheKey: "reports:finance-cards", ttlMs: 60_000 },
  { url: "/api/reports/finance-cards", cacheKey: "reports:finance-cards:latest", ttlMs: 60_000 },
  { url: "/api/reports/finance-summary?period=daily&group_by=all", cacheKey: "reports:finance-summary-v7:daily:all", ttlMs: 60_000 },
  { url: "/api/reports/finance-summary?period=daily&group_by=all", cacheKey: "reports:finance-summary-v7:daily:all:", ttlMs: 60_000 },
  { url: "/api/reports/finance-summary?period=weekly&group_by=all", cacheKey: "reports:finance-summary-v7:weekly:all", ttlMs: 60_000 },
  { url: "/api/reports/finance-summary?period=monthly&group_by=all", cacheKey: "reports:finance-summary-v7:monthly:all", ttlMs: 60_000 },
  { url: "/api/reports/finance-summary?period=yearly&group_by=all", cacheKey: "reports:finance-summary-v7:yearly:all", ttlMs: 60_000 },
  { url: "/api/reports/finance-summary?period=daily", cacheKey: "reports:finance-summary:daily", ttlMs: 60_000 },
  { url: "/api/dashboard/gps-places", cacheKey: "dashboard:gps-places", ttlMs: 60_000 },
];

const getCacheStorage = (kind: "local" | "session" = "local") => {
  if (typeof window === "undefined") return null;
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

const storageKey = (cacheKey: string) =>
  cacheKey.startsWith("fleet-cache:") ? cacheKey : `fleet-cache:${cacheKey}`;

export function markLastSync(at = new Date().toISOString()) {
  const storage = getCacheStorage("local");
  try { storage?.setItem(fleetCacheScope() + LAST_SYNC_KEY, at); } catch { /* Storage may be full. */ }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("fleet-synced", { detail: at }));
  }
}

export async function pullServerSyncTime(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/fleet/sync-status`, {
      credentials: "include", cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (res.ok && res.headers.get("X-Fleet-Cached") !== "1") {
      const status = await res.json() as { synced_at?: string };
      if (status.synced_at) markLastSync(status.synced_at);
    }
  } catch { /* Preserve the last confirmed Odoo sync time while offline. */ }
  return readLastSync();
}

export function readLastSync(): string | null {
  return getCacheStorage("local")?.getItem(fleetCacheScope() + LAST_SYNC_KEY) || null;
}

export function fleetSavedNote(error?: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "");
  if (/timed out|offline|503|failed to fetch|network/i.test(raw)) {
    return "Showing the saved copy. The live database did not answer.";
  }
  return "Showing the saved copy.";
}

export function formatSyncTime(value?: string | null): string {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    timeZone: "Africa/Addis_Ababa",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function writeCachedJson(cacheKey: string, data: unknown, ttlMs: number) {
  const scope = fleetCacheScope();
  if (!scope) return;
  cacheKey = scope + cacheKey;
  memoryCache.set(cacheKey, data);
  void idbPut(cacheKey, data).catch(() => undefined);
  const storage = getCacheStorage("local");
  if (!storage) return;
  try {
    const payload = JSON.stringify({ expiresAt: Date.now() + ttlMs, data, syncedAt: new Date().toISOString() });
    if (payload.length > 200_000) return;
    storage.setItem(storageKey(cacheKey), payload);
  } catch {
    // IndexedDB keeps the copy when local storage is full.
  }
}

function readSavedTargets(): SyncTarget[] {
  const storage = getCacheStorage("local");
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(fleetCacheScope() + REGISTRY_KEY) || "[]") as SyncTarget[];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.url && item.cacheKey) : [];
  } catch {
    return [];
  }
}

function rememberSyncTarget(target: SyncTarget) {
  if (!target.url.startsWith("/api/") || target.url.startsWith("/api/auth/")) return;
  const storage = getCacheStorage("local");
  if (!storage) return;
  const saved = readSavedTargets().filter((item) => item.cacheKey !== target.cacheKey);
  saved.push(target);
  try {
    storage.setItem(fleetCacheScope() + REGISTRY_KEY, JSON.stringify(saved.slice(-60)));
  } catch {
    // The core sync list still runs if the registry cannot be saved.
  }
}

function syncTargets(): SyncTarget[] {
  const byKey = new Map<string, SyncTarget>();
  [...CORE_SYNCS, ...readSavedTargets()].forEach((target) => byKey.set(target.cacheKey, target));
  const supervisor = storedFleetUser()?.role === "supervisor";
  return Array.from(byKey.values()).filter((target) => !supervisor || target.url.startsWith("/api/dashboard/") || target.url.startsWith("/api/supervisor/") || target.url.startsWith("/api/reports/current-location"));
}

export function readCachedJson<T = unknown>(
  cacheKeyOrUrl: string,
  storageKind: "local" | "session" = "local"
): T | undefined {
  const scope = fleetCacheScope();
  if (!scope) return undefined;
  cacheKeyOrUrl = scope + cacheKeyOrUrl;
  if (storageKind === "local" && memoryCache.has(cacheKeyOrUrl)) return memoryCache.get(cacheKeyOrUrl) as T;
  const storage = getCacheStorage(storageKind);
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(storageKey(cacheKeyOrUrl));
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as { data: T };
    if (storageKind === "local") memoryCache.set(cacheKeyOrUrl, cached.data);
    return cached.data;
  } catch {
    storage.removeItem(storageKey(cacheKeyOrUrl));
    return undefined;
  }
}

let localDbReady: Promise<void> | undefined;
let hydratedScope = "";

export function loadLocalFleetDb(): Promise<void> {
  const scope = fleetCacheScope();
  if (!scope) return Promise.resolve();
  if (hydratedScope !== scope) {
    hydratedScope = scope;
    memoryCache.clear();
    localDbReady = undefined;
  }
  return localDbReady ??= (async () => {
    try {
      const rows = await idbAll();
      if (fleetCacheScope() !== scope) return;
      rows.filter((row) => row.key.startsWith(scope)).forEach((row) => memoryCache.set(row.key, row.data));
    } catch { /* Small saved copies remain in local storage. */ }
    if (fleetCacheScope() !== scope) return;
    window.dispatchEvent(new CustomEvent("fleet-local-ready"));
    memoryCache.forEach((data, key) => {
      if (key.startsWith(scope)) publishCache(key.slice(scope.length), data);
    });
  })();
}

export async function resetFleetCache(): Promise<void> {
  memoryCache.clear();
  localDbReady = undefined;
  hydratedScope = "";
  clearFleetUser();
  try { await idbClear(); } catch { /* Inaccessible stores cannot be read. */ }
  for (const storage of [getCacheStorage("local"), getCacheStorage("session")]) {
    if (!storage) continue;
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith("fleet-") || key?.startsWith("user-v2:")) storage.removeItem(key!);
    }
  }
  if ("caches" in window) {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("top-fleet-api-")).map((name) => caches.delete(name)));
  }
}

export async function logoutFleetSession(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include", signal: AbortSignal.timeout(5_000) });
  } catch { /* Offline logout still removes all local access. */ }
  await resetFleetCache();
  getCacheStorage("local")?.setItem("fleet-logged-out", "1");
}

let refreshInFlight: Promise<void> | undefined;

export function refreshLocalFleetDb(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshFleetCopies().finally(() => { refreshInFlight = undefined; });
  return refreshInFlight;
}

async function refreshFleetCopies(): Promise<void> {
  if (typeof window === "undefined" || !navigator.onLine) return;
  const scope = fleetCacheScope();
  if (!scope) return;
  await loadLocalFleetDb();
  const groups = new Map<string, SyncTarget[]>();
  for (const target of syncTargets()) {
    const group = groups.get(target.url) || [];
    group.push(target);
    groups.set(target.url, group);
  }
  const pending = Array.from(groups.entries());
  const coreUrls = new Set(CORE_SYNCS.map((target) => target.url));
  // Bound concurrency, deduplicate aliases, and never overlap minute refreshes.
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let entry = pending.shift(); entry; entry = pending.shift()) {
      const [url, targets] = entry;
      try {
        const res = await fetch(coreUrls.has(url) ? url : liveUrl(url), {
          credentials: "include", cache: "no-store", signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok || res.headers.get("X-Fleet-Cached") === "1") continue;
        const data = await res.json();
        if (fleetCacheScope() !== scope) return;
        for (const target of targets) {
          writeCachedJson(target.cacheKey, data, target.ttlMs);
          publishCache(target.cacheKey, data);
        }
      } catch { /* Keep the saved copy on failure. */ }
    }
  }));
  if (fleetCacheScope() === scope) await pullServerSyncTime();
}

export async function storeFleetCopies(): Promise<void> {
  await refreshLocalFleetDb();
}

function publishCache(cacheKey: string, data: unknown) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("fleet-cache-updated", { detail: { cacheKey, data } }));
}

let syncing = false;

export function fleetViewPath(view: string): string {
  if (view === "overview") return "/";
  if (view === "reports") return "/reports";
  if (view === "finance") return "/finance";
  if (view === "payments") return "/payments";
  if (view === "map") return "/map";
  return `/?view=${view}`;
}

export function yieldFleetSync() {
  // Refreshes publish data without navigating or resetting the current page.
}

export async function syncFleetNow(options: { background?: boolean } = {}) {
  if (typeof window === "undefined" || window.location.pathname === "/login" || !fleetCacheScope() || syncing) return;
  syncing = true;
  let note = "Showing the saved copy.";
  window.dispatchEvent(new CustomEvent("fleet-sync-state", { detail: { syncing: true, note: "" } }));
  try {
    await loadLocalFleetDb();
    if (!navigator.onLine) return;
    if (!options.background) {
      const res = await fetch(`${API_BASE}/fleet/sync`, {
        method: "POST", credentials: "include", cache: "no-store",
        signal: AbortSignal.timeout(150_000),
      });
      if (!res.ok) throw new Error(`Sync failed (${res.status})`);
      const status = await res.json() as { live?: boolean; failed_count?: number };
      note = status.live
        ? (status.failed_count ? "Some data refreshed; unavailable data kept from the saved copy." : "Updated from Odoo.")
        : "Showing the saved copy. The live database did not answer.";
    } else {
      note = "";
    }
    await refreshLocalFleetDb();
  } catch {
    note = "Showing the saved copy. Sync could not finish.";
  } finally {
    syncing = false;
    window.dispatchEvent(new CustomEvent("fleet-sync-state", { detail: { syncing: false, note } }));
  }
}

function liveUrl(url: string): string {
  const [path, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.set("refresh", "true");
  return `${path}?${params}`;
}

export async function fetchCachedJson<T = unknown>(
  url: string,
  init?: RequestInit,
  options: CacheOptions = {}
): Promise<T> {
  const ttlMs = options.ttlMs ?? 60_000;
  const cacheKey = options.cacheKey || url;
  const canUseCache = typeof window !== "undefined" && (!init?.method || init.method.toUpperCase() === "GET");
  if (canUseCache) await loadLocalFleetDb();
  if (canUseCache && (!init?.method || init.method.toUpperCase() === "GET")) {
    rememberSyncTarget({ url, cacheKey, ttlMs });
  }

  const scope = fleetCacheScope();
  const staleData = canUseCache ? readCachedJson<T>(cacheKey, options.storage ?? "local") : undefined;
  if (canUseCache && staleData !== undefined && !options.forceRefresh) return staleData;

  try {
    const res = await fetch(options.forceRefresh ? liveUrl(url) : url, {
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...(options.forceRefresh ? { "X-Fleet-Sync": "1" } : {}),
      },
    });
    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error("Access denied. Sign in with an authorized account."), { accessDenied: true });
    }
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    if (fleetCacheScope() !== scope) throw Object.assign(new Error("Account changed"), { accessDenied: true });
    const fromSavedCopy = res.headers.get("X-Fleet-Cached") === "1";
    if (fromSavedCopy) throw new Error("Legacy shared cache ignored; use this account’s saved copy.");
    const data = await res.json() as T;
    if (fleetCacheScope() !== scope) throw Object.assign(new Error("Account changed"), { accessDenied: true });
    if (canUseCache && !fromSavedCopy) {
      writeCachedJson(cacheKey, data, ttlMs);
      publishCache(cacheKey, data);
    } else if (canUseCache && staleData === undefined) {
      writeCachedJson(cacheKey, data, ttlMs);
    }
    return data;
  } catch (error) {
    if (error && typeof error === "object" && "accessDenied" in error) throw error;
    if (fleetCacheScope() !== scope) throw error;
    if (staleData !== undefined) return staleData;
    throw error;
  }
}
