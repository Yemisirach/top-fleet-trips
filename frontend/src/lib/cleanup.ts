import { idbClear } from "./fleet-db";

export async function clearFleetLocalData(): Promise<void> {
  console.log("[Cleanup] Starting fleet local data cleanup...");

  // 1. Clear IndexedDB
  try {
    await idbClear();
    console.log("[Cleanup] IndexedDB cleared");
  } catch (e) {
    console.warn("[Cleanup] IndexedDB clear failed:", e);
  }

  // 2. Clear localStorage (fleet-related keys)
  const fleetKeys = Object.keys(localStorage).filter((k) =>
    k.startsWith("fleet") || k.startsWith("top-fleet")
  );
  fleetKeys.forEach((k) => localStorage.removeItem(k));
  console.log("[Cleanup] localStorage cleared:", fleetKeys.length, "keys");

  // 3. Clear sessionStorage (fleet-related keys)
  const sessionKeys = Object.keys(sessionStorage).filter((k) =>
    k.startsWith("fleet") || k.startsWith("top-fleet")
  );
  sessionKeys.forEach((k) => sessionStorage.removeItem(k));
  console.log("[Cleanup] sessionStorage cleared:", sessionKeys.length, "keys");

  // 4. Unregister service workers and clear caches
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const reg of registrations) {
      await reg.unregister();
      console.log("[Cleanup] Service worker unregistered:", reg.scope);
    }
  }

  if ("caches" in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
    console.log("[Cleanup] Cache storage cleared:", cacheNames.length, "caches");
  }

  console.log("[Cleanup] Fleet local data cleanup complete. Reload the page to start fresh.");
}

// Auto-run if called directly in console
if (typeof window !== "undefined") {
  (window as any).clearFleetLocalData = clearFleetLocalData;
}