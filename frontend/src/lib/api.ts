import { idbAll, idbPut } from "@/lib/fleet-db";

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
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
    return res.status !== 401;
  } catch {
    return true;
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
const PAGE_SHELLS = ["/", "/finance", "/reports", "/payments", "/map", "/planner", "/detail"];

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
  storage?.setItem(LAST_SYNC_KEY, at);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("fleet-synced", { detail: at }));
  }
}

export async function pullServerSyncTime(): Promise<string | null> {
  return readLastSync();
}

export interface SharedCopy {
  revision?: string;
  report_date?: string | null;
  totals?: {
    revenue_total?: number;
    cost_total?: number;
    net_profit_total?: number;
    vehicle_count?: number;
  } | null;
  dashboard?: unknown;
}

let lastSharedRevision = "";

export function startSharedCopySync(): () => void {
  if (typeof window === "undefined") return () => undefined;
  let stopped = false;

  const tick = async () => {
    if (stopped || window.location.pathname === "/login") return;
    try {
      const res = await fetch(`${API_BASE}/fleet/shared-copy`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const copy = await res.json() as SharedCopy;
      window.dispatchEvent(new CustomEvent("fleet-shared-copy", { detail: copy }));
      if (copy.totals && copy.report_date) {
        const saved = { report_date: copy.report_date, totals: copy.totals, rows: [] };
        writeCachedJson(`reports:daily-profit:${copy.report_date}`, saved, 60_000);
        publishCache(`reports:daily-profit:${copy.report_date}`, saved);
      }
      const revision = copy.revision || "";
      if (!revision || revision === lastSharedRevision) return;
      const first = lastSharedRevision === "";
      lastSharedRevision = revision;
      if (first && !revision.replace(/\|/g, "")) return;
      const full = await fetch(`${API_BASE}/fleet/shared-copy?include=dashboard`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!full.ok) return;
      const body = await full.json() as SharedCopy;
      if (!body.dashboard) return;
      writeCachedJson(DASHBOARD_CACHE_KEY, body.dashboard, 6 * 60 * 60 * 1000);
      publishCache(DASHBOARD_CACHE_KEY, body.dashboard);
    } catch {
      // Keep the numbers already on screen. Do not move the header time.
    }
  };

  void tick();
  const timer = window.setInterval(() => { void tick(); }, 1000);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

export function readLastSync(): string | null {
  return getCacheStorage("local")?.getItem(LAST_SYNC_KEY) || null;
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
    const parsed = JSON.parse(storage.getItem(REGISTRY_KEY) || "[]") as SyncTarget[];
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
    storage.setItem(REGISTRY_KEY, JSON.stringify(saved.slice(-60)));
  } catch {
    // The core sync list still runs if the registry cannot be saved.
  }
}

function syncTargets(): SyncTarget[] {
  const byKey = new Map<string, SyncTarget>();
  [...CORE_SYNCS, ...readSavedTargets()].forEach((target) => byKey.set(target.cacheKey, target));
  return Array.from(byKey.values());
}

export function readCachedJson<T = unknown>(
  cacheKeyOrUrl: string,
  storageKind: "local" | "session" = "local"
): T | undefined {
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

function importBrowserCopies() {
  const storage = getCacheStorage("local");
  if (!storage) return;
  for (let index = 0; index < storage.length; index += 1) {
    const rawKey = storage.key(index);
    if (!rawKey?.startsWith("fleet-cache:")) continue;
    const cacheKey = rawKey.slice("fleet-cache:".length);
    if (memoryCache.has(cacheKey)) continue;
    const data = readCachedJson(cacheKey);
    if (data !== undefined) void idbPut(cacheKey, data).catch(() => undefined);
  }
}

export async function loadLocalFleetDb(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const rows = await idbAll();
    rows.forEach((row) => memoryCache.set(row.key, row.data));
  } catch {
    // Keep the browser copy already in memory.
  }
  importBrowserCopies();
  window.dispatchEvent(new CustomEvent("fleet-local-ready"));
  memoryCache.forEach((data, cacheKey) => publishCache(cacheKey, data));
}

export async function refreshLocalFleetDb(): Promise<void> {
  if (typeof window === "undefined") return;
  const quiet = quietPrefixes();
  for (const target of syncTargets()) {
    try {
      const res = await fetch(target.url, { credentials: "include", cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      writeCachedJson(target.cacheKey, data, target.ttlMs);
      const blocked = quiet.some((prefix) => target.url.startsWith(prefix));
      if (!blocked) publishCache(target.cacheKey, data);
    } catch {
      // Keep the IndexedDB copy. Do not move the header time.
    }
  }
}

export async function storeFleetCopies(): Promise<void> {
  await refreshLocalFleetDb();
}

function publishCache(cacheKey: string, data: unknown) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("fleet-cache-updated", { detail: { cacheKey, data } }));
}

let syncing = false;
let syncGeneration = 0;
let backgroundAbort: AbortController | null = null;

const QUIET_PAGE_PREFIXES: Record<string, string[]> = {
  "/map": ["/api/dashboard/"],
  "/payments": ["/api/reports/payment-requests"],
  "/finance": ["/api/reports/finance-", "/api/reports/income-statement", "/api/reports/daily-profit"],
  "/reports": ["/api/reports/"],
};

export function fleetViewPath(view: string): string {
  if (view === "overview") return "/";
  if (view === "reports") return "/reports";
  if (view === "finance") return "/finance";
  if (view === "payments") return "/payments";
  if (view === "map") return "/map";
  return `/?view=${view}`;
}

export function yieldFleetSync() {
  backgroundAbort?.abort();
}

function quietPrefixes(): string[] {
  const path = window.location.pathname;
  const page = Object.keys(QUIET_PAGE_PREFIXES).find((item) => path === item || path.startsWith(`${item}/`));
  return page ? QUIET_PAGE_PREFIXES[page] : [];
}

function currentPageTargets(): SyncTarget[] {
  const prefixes = quietPrefixes();
  const targets = syncTargets();
  if (!prefixes.length) return targets.filter((target) => target.url.startsWith("/api/dashboard/"));
  return targets.filter((target) => prefixes.some((prefix) => target.url.startsWith(prefix)));
}

async function publishCurrentPage() {
  const groups = new Map<string, SyncTarget[]>();
  currentPageTargets().forEach((target) => {
    const list = groups.get(target.url) || [];
    list.push(target);
    groups.set(target.url, list);
  });
  for (const [url, group] of groups) {
    try {
      const res = await fetch(url, { credentials: "include", cache: "no-store" });
      if (!res.ok) {
        group.forEach((target) => {
          const local = readCachedJson(target.cacheKey);
          if (local !== undefined) publishCache(target.cacheKey, local);
        });
        continue;
      }
      const data = await res.json();
      group.forEach((target) => {
        writeCachedJson(target.cacheKey, data, target.ttlMs);
        publishCache(target.cacheKey, data);
      });
    } catch {
      group.forEach((target) => {
        const local = readCachedJson(target.cacheKey);
        if (local !== undefined) publishCache(target.cacheKey, local);
      });
    }
  }
}

export async function syncFleetNow(options: { background?: boolean } = {}) {
  if (typeof window === "undefined") return;
  if (options.background) return;
  if (window.location.pathname === "/login") return;
  if (syncing) return;
  const generation = ++syncGeneration;
  syncing = true;
  window.dispatchEvent(new CustomEvent("fleet-sync-state", { detail: { syncing: true, note: "" } }));
  try {
    await loadLocalFleetDb();
    if (memoryCache.size === 0) await refreshLocalFleetDb();
    currentPageTargets().forEach((target) => {
      const local = readCachedJson(target.cacheKey);
      if (local !== undefined) publishCache(target.cacheKey, local);
    });
    if (generation !== syncGeneration) return;
  } finally {
    if (generation === syncGeneration) {
      syncing = false;
      window.dispatchEvent(new CustomEvent("fleet-sync-state", { detail: { syncing: false, note: "Showing the saved copy." } }));
    }
  }
}

export async function fetchCachedJson<T = unknown>(
  url: string,
  init?: RequestInit,
  options: CacheOptions = {}
): Promise<T> {
  const ttlMs = options.ttlMs ?? 60_000;
  const cacheKey = options.cacheKey || url;
  const storage = getCacheStorage(options.storage ?? "local");
  const canUseCache = !!storage && (!init?.method || init.method.toUpperCase() === "GET");
  if (canUseCache && (!init?.method || init.method.toUpperCase() === "GET")) {
    rememberSyncTarget({ url, cacheKey, ttlMs });
  }

  const staleData = canUseCache ? readCachedJson<T>(cacheKey, options.storage ?? "local") : undefined;
  if (canUseCache && staleData !== undefined && !options.forceRefresh) return staleData;

  try {
    const res = await fetch(url, {
      credentials: "include",
      cache: options.forceRefresh ? "no-store" : undefined,
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...(options.forceRefresh ? { "X-Fleet-Sync": "1" } : {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(text || `Request failed (${res.status})`);
    }
    const fromSavedCopy = res.headers.get("X-Fleet-Cached") === "1";
    const data = await res.json() as T;
    if (canUseCache && !fromSavedCopy) {
      writeCachedJson(cacheKey, data, ttlMs);
      publishCache(cacheKey, data);
    } else if (canUseCache && staleData === undefined) {
      writeCachedJson(cacheKey, data, ttlMs);
    }
    return data;
  } catch (error) {
    if (staleData !== undefined) return staleData;
    throw error;
  }
}
