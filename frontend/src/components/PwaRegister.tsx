"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/service-worker")
        .then((registration) => registration.update())
        .catch((error) => {
          console.warn("TOP Fleet service worker registration failed:", error);
        });
    });
  }, []);

  return null;
}
