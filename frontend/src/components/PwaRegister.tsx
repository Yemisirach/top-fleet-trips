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
    const dropStackedShells = () => {
      const shells = document.querySelectorAll(".app-shell");
      if (shells.length > 1) {
        shells.forEach((node, index) => {
          if (index < shells.length - 1) node.remove();
        });
      }
      document.querySelectorAll("body > .leaflet-container, body > .leaflet-pane").forEach((node) => node.remove());
    };
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".nav-btn")) return;
      window.setTimeout(dropStackedShells, 350);
    });
    window.addEventListener("error", onError);
    if (!("serviceWorker" in navigator)) return () => window.removeEventListener("error", onError);

    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/service-worker")
        .then((registration) => {
          void registration.update();
          window.setInterval(() => { void registration.update(); }, 60_000);
        })
        .catch((error) => {
          console.warn("TOP Fleet service worker registration failed:", error);
        });
    });
    return () => window.removeEventListener("error", onError);
  }, []);

  return null;
}
