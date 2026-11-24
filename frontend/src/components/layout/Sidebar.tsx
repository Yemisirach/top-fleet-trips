"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  CreditCard,
  FileText,
  Wallet,
  LogOut,
  Menu,
  Truck,
  Map,
  MapPin,
  Users,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { yieldFleetSync, logoutFleetSession } from "@/lib/api";
import { storedFleetUser } from "@/lib/scope";

export type SidebarView =
  | "overview"
  | "trips"
  | "supervisors"
  | "payments"
  | "locations"
  | "reports"
  | "finance"
  | "map"
  | "planner";

interface SidebarProps {
  currentView: SidebarView;
  onViewChange: (view: SidebarView, status?: string) => void;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const NAV_ITEMS: {
  view: SidebarView;
  label: string;
  icon: React.ReactNode;
  status?: string;
  external?: string;
}[] = [
  { view: "overview", label: "Overview", icon: <LayoutDashboard size={18} /> },
  { view: "trips", label: "All Journeys", icon: <Truck size={18} /> },
  { view: "supervisors", label: "Supervisors", icon: <Users size={18} /> },
  { view: "map", label: "Map", icon: <Map size={18} /> },
  // Fleet Agent is paused for now. Keep the view type so the page can be re-enabled cleanly later.
];

export default function Sidebar({ currentView, onViewChange, mobileOpen, onCloseMobile }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [role, setRole] = useState("");
  const router = useRouter();
  const supervisor = role === "supervisor";

  useEffect(() => {
    const savedRole = storedFleetUser()?.role || "";
    if (savedRole) setRole(savedRole);
    let cancelled = false;
    const warm = (nextRole: string) => {
      if (!nextRole || cancelled) return;
      const hrefs = nextRole === "supervisor"
        ? ["/supervisor", "/supervisor?view=journeys", "/location", "/map"]
        : ["/", "/?view=trips", "/?view=supervisors", "/map", "/payments", "/finance", "/reports"];
      hrefs.forEach((href) => router.prefetch(href));
    };
    if (savedRole) warm(savedRole);
    fetch("/api/auth/me", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const nextRole = data?.user?.role || storedFleetUser()?.role || "";
        if (!cancelled) setRole(nextRole);
        warm(nextRole);
      })
      .catch(() => {
        const nextRole = storedFleetUser()?.role || "";
        if (!cancelled) setRole(nextRole);
        warm(nextRole);
      });
    const timer = window.setInterval(() => warm(storedFleetUser()?.role || ""), 4 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [router]);

  const handleLogout = useCallback(async () => {
    await logoutFleetSession();
    router.push("/login");
  }, [router]);

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}${mobileOpen ? " open" : ""}`}>
      {/* Brand */}
      <div className="sidebar-brand" style={{ justifyContent: collapsed ? "center" : "flex-start", padding: collapsed ? "18px 0" : "18px 16px", gap: collapsed ? 0 : 12 }}>
        {!collapsed && <img src="/top-logo-full.jpg" alt="TOP Fleet" />}
        {!collapsed && (
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-name">TOP Fleet</div>
            <div className="sidebar-brand-sub">Topwater Ethiopia</div>
          </div>
        )}
        <button
          className="btn"
          style={{ marginLeft: collapsed ? 0 : "auto", padding: "6px", minHeight: 32, minWidth: 32, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav" id="nav">
        {!collapsed && <div className="nav-section">{supervisor ? "Assigned vehicles" : "Dashboard"}</div>}
        {supervisor && (
          <>
            <Link href="/supervisor" prefetch className={`nav-btn${currentView === "overview" ? " active" : ""}`}>
              <LayoutDashboard size={18} />
              {!collapsed && <span className="nav-label">My vehicles</span>}
            </Link>
            <Link href="/supervisor?view=journeys" prefetch className={`nav-btn${currentView === "trips" ? " active" : ""}`}>
              <Truck size={18} />
              {!collapsed && <span className="nav-label">Journeys</span>}
            </Link>
            <Link href="/location" prefetch className={`nav-btn${currentView === "locations" ? " active" : ""}`}>
              <MapPin size={18} />
              {!collapsed && <span className="nav-label">Current location</span>}
            </Link>
            <Link href="/map" prefetch className={`nav-btn${currentView === "map" ? " active" : ""}`} onClick={() => yieldFleetSync()}>
              <Map size={18} />
              {!collapsed && <span className="nav-label">Map</span>}
            </Link>
          </>
        )}
        {!supervisor && NAV_ITEMS.map((item, i) => {
          const isActive =
            currentView === item.view &&
            (!item.status || item.status === "all");
          return (
            <button
              key={i}
              className={`nav-btn${isActive ? " active" : ""}`}
              onClick={() => {
                if (item.view === "map") yieldFleetSync();
                onViewChange(item.view, item.status);
                onCloseMobile?.();
              }}
              title={collapsed ? item.label : undefined}
            >
              {item.icon}
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </button>
          );
        })}
        {!supervisor && (
          <>
            <Link href="/payments" prefetch className={`nav-btn${currentView === "payments" ? " active" : ""}`} title={collapsed ? "Payment Requests" : undefined} onClick={() => yieldFleetSync()}>
              <CreditCard size={18} />
              {!collapsed && <span className="nav-label">Payment Requests</span>}
            </Link>
            <Link href="/finance" prefetch className={`nav-btn${currentView === "finance" ? " active" : ""}`} title={collapsed ? "Finance Summary" : undefined} onClick={() => yieldFleetSync()}>
              <Wallet size={18} />
              {!collapsed && <span className="nav-label">Finance Summary</span>}
            </Link>
            <Link href="/reports" prefetch className={`nav-btn${currentView === "reports" ? " active" : ""}`} title={collapsed ? "Reports" : undefined} onClick={() => yieldFleetSync()}>
              <FileText size={18} />
              {!collapsed && <span className="nav-label">Reports</span>}
            </Link>
          </>
        )}
      </nav>

      <div className="sidebar-logout">
        <button className="nav-btn" onClick={handleLogout} title={collapsed ? "Logout" : undefined}>
          <LogOut size={18} />
          {!collapsed && <span className="nav-label">Logout</span>}
        </button>
      </div>
    </aside>
  );
}

export function WindowLogout() {
  const router = useRouter();
  const logout = async () => {
    await logoutFleetSession();
    router.push("/login");
  };
  return (
    <button className="btn window-logout" type="button" onClick={logout} title="Logout">
      <LogOut size={16} /> Logout
    </button>
  );
}

/* Mobile hamburger button - used by the shell */
export function MenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn" style={{ padding: "8px" }} onClick={onClick}>
      <Menu size={18} />
    </button>
  );
}
