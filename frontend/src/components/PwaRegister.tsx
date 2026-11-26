"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    const reloadOnce = () => {
      const key = "fleet-chunk-reload";
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
      window.location.reload();
    };
    const onError = (event: ErrorEvent) => {
      const message = String(event.message || "");
      if (message.includes("ChunkLoadError") || message.includes("Failed to load chunk")) reloadOnce();
    };
    window.addEventListener("error", onError);
    let stopped = false;
    let timer: number | undefined;
    const warmCurrentPage = () => {
      if (stopped || !navigator.serviceWorker.controller || !navigator.onLine) return;
      // The first document and its chunks loaded before the worker took control.
      // Request them again so the first offline reload has a complete app shell.
      void fetch(window.location.href, { headers: { "X-Fleet-Page": "1" } }).catch(() => undefined);
      document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[rel="stylesheet"]').forEach((element) => {
        const url = element instanceof HTMLScriptElement ? element.src : element.href;
        if (new URL(url).origin === window.location.origin) void fetch(url).catch(() => undefined);
      });
    };
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("controllerchange", warmCurrentPage);
    const register = () => {
      if (!("serviceWorker" in navigator)) return;
      navigator.serviceWorker.register("/service-worker")
        .then((registration) => {
          if (stopped) return;
          warmCurrentPage();
          void registration.update().catch(() => undefined);
          timer = window.setInterval(() => {
            if (navigator.onLine) void registration.update().catch(() => undefined);
          }, 60_000);
        })
        .catch((error) => console.warn("TOP Fleet service worker registration failed:", error));
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("load", register);
      window.removeEventListener("error", onError);
      if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("controllerchange", warmCurrentPage);
    };
  }, []);

  return null;
}
