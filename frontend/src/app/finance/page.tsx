"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, Moon, RefreshCw, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import Sidebar, { type SidebarView } from "@/components/layout/Sidebar";
import BackButton from "@/components/navigation/BackButton";
import FinanceSummaryPanel from "@/components/reports/FinanceSummaryPanel";
import { fetchJson, API_BASE } from "@/lib/api";

export default function FinancePage() {
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetchJson(`${API_BASE}/auth/me`).catch(() => router.push("/login"));
  }, [router]);

  return (
    <div className="app-shell">
      <div className={`overlay${mobileSidebarOpen ? " open" : ""}`} onClick={() => setMobileSidebarOpen(false)}></div>
      <Sidebar
        currentView={"finance" as SidebarView}
        onViewChange={(view) => {
          if (view === "overview") window.location.href = "/";
          else if (view === "reports") window.location.href = "/reports";
          else if (view === "payments") window.location.href = "/payments";
          else if (view === "finance") window.location.href = "/finance";
          else if (view === "map") window.location.href = "/map";
          else window.location.href = `/?view=${view}`;
        }}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />
      <div className="app-main" style={{ display: "flex", flexDirection: "column", height: "100vh", overflowY: "hidden" }}>
        <header className="fleet-topbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="btn md-hidden" onClick={() => setMobileSidebarOpen(true)} aria-label="Open menu">
              <Menu size={18} />
            </button>
            <div>
              <div style={{ fontWeight: 900, fontSize: 20 }}>Finance Summary</div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>Daily, weekly, and monthly posted profit</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <BackButton />
            <button className="btn" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={16} /> Refresh</button>
            <button className="btn" onClick={toggle}>
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              {theme === "dark" ? "Light" : "Dark"}
            </button>
          </div>
        </header>
        <div style={{ overflowY: "auto", padding: 24 }}>
          <FinanceSummaryPanel key={refreshKey} />
        </div>
      </div>
    </div>
  );
}
