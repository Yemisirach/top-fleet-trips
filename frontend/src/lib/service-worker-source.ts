export const serviceWorkerSource = String.raw`const CACHE_VERSION = "v8";
const STATIC_CACHE = "top-fleet-static-" + CACHE_VERSION;
const PAGE_CACHE = "top-fleet-pages-" + CACHE_VERSION;
const API_CACHE = "top-fleet-api-" + CACHE_VERSION;
const STATIC_EXTENSIONS = /\.(css|js|png|jpg|jpeg|svg|ico|webmanifest|woff2?)$/i;
const OFFLINE_HTML = "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>TOP Fleet offline</title></head><body style='margin:0;min-height:100vh;display:grid;place-items:center;background:#08101d;color:#fff;font-family:sans-serif'><main style='max-width:420px;padding:24px'><h1 style='margin:0 0 8px'>TOP Fleet is offline</h1><p>The last synced copy is still available. Open the app once while online, then search and the saved fleet data stay on this device.</p></main></body></html>";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll([
        "/manifest.webmanifest",
        "/favicon.ico",
        "/top-logo-full.jpg",
        "/pwa-icon-192.png",
        "/pwa-icon-512.png"
      ]).catch(() => undefined)
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  const keep = new Set([STATIC_CACHE, PAGE_CACHE, API_CACHE]);
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function fromCache(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request) || await cache.match(new URL(request.url).pathname);
  if (!cached || !cached.ok) return undefined;
  const headers = new Headers(cached.headers);
  headers.set("X-Fleet-Cached", "1");
  return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
}

function offlinePage() {
  return new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone()).catch(() => undefined);
    return fresh;
  } catch {
    const cached = await fromCache(cacheName, request);
    if (cached) return cached;
    if (request.mode === "navigate") return offlinePage();
    throw new Error("offline");
  }
}

function requestKind(request) {
  const url = new URL(request.url);
  if (request.headers.get("RSC") === "1" || request.headers.get("Next-Router-Prefetch") === "1" || url.searchParams.has("_rsc")) return "rsc";
  return "doc";
}

function savedKey(request) {
  const url = new URL(request.url);
  url.searchParams.delete("_rsc");
  return new Request(url.origin + "/__fleet_page_cache/" + requestKind(request) + url.pathname + url.search);
}

function bodyMatches(kind, response) {
  const type = (response.headers.get("content-type") || "").toLowerCase();
  if (kind === "rsc") return type.includes("text/x-component");
  return type.includes("text/html");
}

async function savedPageFirst(event, request) {
  const cache = await caches.open(PAGE_CACHE);
  const key = savedKey(request);
  const kind = requestKind(request);
  if (kind === "rsc") {
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok && bodyMatches(kind, fresh)) cache.put(key, fresh.clone()).catch(() => undefined);
      if (fresh) return fresh;
    } catch {
      const saved = await cache.match(key);
      if (saved && saved.ok && bodyMatches(kind, saved)) return saved;
      throw new Error("offline");
    }
  }
  const cached = await cache.match(key);
  const update = fetch(request).then((fresh) => {
    if (fresh && fresh.ok && bodyMatches(kind, fresh)) cache.put(key, fresh.clone()).catch(() => undefined);
    return fresh;
  }).catch(() => undefined);
  if (cached && cached.ok && bodyMatches(kind, cached)) {
    event.waitUntil(update);
    const headers = new Headers(cached.headers);
    headers.set("X-Fleet-Cached", "1");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }
  const fresh = await update;
  if (fresh) return fresh;
  if (request.mode === "navigate") return offlinePage();
  throw new Error("offline");
}

async function staticAsset(request) {
  const cached = await fromCache(STATIC_CACHE, request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, fresh.clone()).catch(() => undefined);
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/service-worker" || url.pathname === "/sw.js") return;
  if (url.pathname.startsWith("/api/auth/")) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || STATIC_EXTENSIONS.test(url.pathname)) {
    event.respondWith(staticAsset(request));
    return;
  }

  if (request.mode === "navigate" || url.searchParams.has("_rsc") || request.headers.get("RSC") === "1") {
    event.respondWith(savedPageFirst(event, request));
  }
});`;
