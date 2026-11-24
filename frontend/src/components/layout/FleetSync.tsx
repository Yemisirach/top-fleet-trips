"use client";

import { useEffect } from "react";
import { storedFleetUser } from "@/lib/scope";
import { loadLocalFleetDb, syncFleetNow, sessionIsActive } from "@/lib/api";

export default function FleetSync() {
  useEffect(() => {
    let stopped = false;
    const boot = async () => {
      if (window.location.pathname === "/login") return;
      if (!await sessionIsActive()) { window.location.replace("/login"); return; }
      await loadLocalFleetDb();
      if (!stopped && window.location.pathname !== "/login") await syncFleetNow({ background: true });
    };
    void boot();
    const minute = window.setInterval(() => {
      if (window.location.pathname !== "/login") {
        if (!storedFleetUser()) { window.location.replace("/login"); return; }
        void sessionIsActive().then((active) => {
          if (active) void syncFleetNow({ background: true });
          else window.location.replace("/login");
        });
      }
    }, 60_000);
    const reconnect = () => { void syncFleetNow({ background: true }); };
    const checkAccount = () => {
      if (window.location.pathname !== "/login" && !storedFleetUser()) window.location.replace("/login");
    };
    window.addEventListener("storage", checkAccount);
    window.addEventListener("online", reconnect);
    return () => {
      stopped = true;
      window.clearInterval(minute);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("storage", checkAccount);
    };
  }, []);
  return null;
}
