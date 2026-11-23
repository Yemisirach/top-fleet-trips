"use client";

import { useEffect } from "react";
import { loadLocalFleetDb, refreshLocalFleetDb, startSharedCopySync } from "@/lib/api";

export default function FleetSync() {
  useEffect(() => {
    let stopped = false;
    const boot = async () => {
      await loadLocalFleetDb();
      if (!stopped && window.location.pathname !== "/login") await refreshLocalFleetDb();
    };
    void boot();
    const minute = window.setInterval(() => {
      if (window.location.pathname !== "/login") void refreshLocalFleetDb();
    }, 60_000);
    const stopShared = startSharedCopySync();
    return () => {
      stopped = true;
      window.clearInterval(minute);
      stopShared();
    };
  }, []);
  return null;
}
