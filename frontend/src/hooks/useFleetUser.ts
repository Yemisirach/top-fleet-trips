"use client";

import { useEffect, useState } from "react";
import { rememberFleetUser, storedFleetUser, type FleetUser } from "@/lib/scope";

export function useFleetUser() {
  const [user, setUser] = useState<FleetUser | null>(null);

  useEffect(() => {
    const saved = storedFleetUser();
    if (saved) setUser(saved);
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        const next = data?.user || storedFleetUser() || { role: "" };
        rememberFleetUser(next);
        setUser(next);
      })
      .catch(() => {
        if (!cancelled) setUser(storedFleetUser() || { role: "" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return user;
}
