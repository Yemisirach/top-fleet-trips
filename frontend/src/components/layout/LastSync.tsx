"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { formatSyncTime, readLastSync, syncFleetNow } from "@/lib/api";
import type { Trip } from "@/types/trip";

export function tripLastSync(trip: Pick<Trip, "mayet_captured_at" | "write_date" | "departure_date" | "create_date">): string {
  return trip.mayet_captured_at || trip.write_date || trip.departure_date || trip.create_date || "";
}

export function useFleetSync() {
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const read = () => setSyncedAt(readLastSync());
    const onlineNow = () => setOnline(true);
    const offlineNow = () => setOnline(false);
    read();
    setOnline(window.navigator.onLine);
    window.addEventListener("fleet-synced", read);
    window.addEventListener("storage", read);
    window.addEventListener("online", onlineNow);
    window.addEventListener("offline", offlineNow);
    return () => {
      window.removeEventListener("fleet-synced", read);
      window.removeEventListener("storage", read);
      window.removeEventListener("online", onlineNow);
      window.removeEventListener("offline", offlineNow);
    };
  }, []);

  return {
    online,
    syncedAt,
    label: formatSyncTime(syncedAt),
  };
}

export function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<{ syncing?: boolean; note?: string }>).detail || {};
      setSyncing(Boolean(detail.syncing));
      if (!detail.syncing) setNote(detail.note || "");
    };
    window.addEventListener("fleet-sync-state", onState);
    return () => window.removeEventListener("fleet-sync-state", onState);
  }, []);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        className="btn"
        onClick={() => { void syncFleetNow(); }}
        disabled={syncing}
        aria-label="Sync fleet data"
      >
        <RefreshCw size={16} className={syncing ? "spin" : ""} />
        {syncing ? "Syncing" : "Sync"}
      </button>
      {note && <span className="muted" style={{ fontSize: 12 }}>{note}</span>}
    </span>
  );
}

export default function LastSyncLabel({ searching = false }: { searching?: boolean }) {
  const { online, label } = useFleetSync();
  return (
    <span className={`last-sync-label${searching ? " searching" : ""}${online ? "" : " offline"}`}>
      {online ? "Last sync" : "Offline · last sync"} {label}
    </span>
  );
}
