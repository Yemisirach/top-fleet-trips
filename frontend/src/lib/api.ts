export const API_BASE = "/api";

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

interface CacheOptions {
  ttlMs?: number;
  cacheKey?: string;
  storage?: "local" | "session";
  forceRefresh?: boolean;
}

const getCacheStorage = (kind: "local" | "session" = "local") => {
  if (typeof window === "undefined") return null;
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

export function readCachedJson<T = unknown>(
  cacheKeyOrUrl: string,
  storageKind: "local" | "session" = "local"
): T | undefined {
  const storage = getCacheStorage(storageKind);
  if (!storage) return undefined;
  const cacheKey = cacheKeyOrUrl.startsWith("fleet-cache:")
    ? cacheKeyOrUrl
    : `fleet-cache:${cacheKeyOrUrl}`;
  try {
    const raw = storage.getItem(cacheKey);
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as { data: T };
    return cached.data;
  } catch {
    storage.removeItem(cacheKey);
    return undefined;
  }
}

export async function fetchCachedJson<T = unknown>(
  url: string,
  init?: RequestInit,
  options: CacheOptions = {}
): Promise<T> {
  const ttlMs = options.ttlMs ?? 60_000;
  const cacheKey = `fleet-cache:${options.cacheKey || url}`;
  let staleData: T | undefined;
  const storage = getCacheStorage(options.storage ?? "local");
  const canUseCache =
    !!storage &&
    (!init?.method || init.method.toUpperCase() === "GET");

  if (canUseCache) {
    try {
      const raw = storage.getItem(cacheKey);
      if (raw) {
        const cached = JSON.parse(raw) as { expiresAt: number; data: T };
        staleData = cached.data;
        if (!options.forceRefresh && cached.expiresAt > Date.now()) return cached.data;
      }
    } catch {
      storage.removeItem(cacheKey);
    }
  }

  let data: T;
  try {
    data = await fetchJson<T>(url, init);
  } catch (error) {
    if (canUseCache && staleData !== undefined) return staleData;
    throw error;
  }
  if (canUseCache) {
    try {
      storage.setItem(
        cacheKey,
        JSON.stringify({ expiresAt: Date.now() + ttlMs, data })
      );
    } catch {
      // Ignore storage quota/private-mode failures; network data still works.
    }
  }
  return data;
}
