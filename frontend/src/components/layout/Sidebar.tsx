"use client";
import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Truck,
  CreditCard,
  FileText,
  Map,
  Users,
  BarChart2,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
} from "lucide-react";

export type SidebarView =
  | "overview"
  | "trips"
  | "payments"
  | "locations"
  | "graphs"
  | "reports"
  | "map";

interface SidebarProps {
  currentView: SidebarView;
  onViewChange: (view: SidebarView, status?: string) => void;
  mobileOpen?: boolean;
}

const NAV_ITEMS: {
  view: SidebarView;
  label: string;
  icon: React.ReactNode;
  status?: string;
  external?: string;
}[] = [
  { view: "overview", label: "Overview", icon: <LayoutDashboard size={18} /> },
  { view: "trips", status: "active", label: "Active Journeys", icon: <Truck size={18} /> },
  { view: "trips", label: "All Journeys", icon: <Truck size={18} /> },
  { view: "graphs", label: "Analytics", icon: <BarChart2 size={18} /> },
  { view: "map", label: "Mayet Map", icon: <Map size={18} /> },
];

export default function Sidebar({ currentView, onViewChange, mobileOpen }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const router = useRouter();

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    router.push("/login");
  }, [router]);

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}${mobileOpen ? " open" : ""}`}>
      {/* Brand */}
      <div className="sidebar-brand" style={{ justifyContent: collapsed ? "center" : "flex-start", padding: collapsed ? "18px 0" : "18px 16px", gap: collapsed ? 0 : 12 }}>
        {!collapsed && <img src="/static/fleet-trips-logo.svg" alt="Fleet Trips" />}
        {!collapsed && (
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-name">Fleet Trips</div>
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
        {!collapsed && <div className="nav-section">Dashboard</div>}
        {NAV_ITEMS.map((item, i) => {
          const isActive =
            currentView === item.view &&
            (!item.status || item.status === "all");
          return (
            <button
              key={i}
              className={`nav-btn${isActive ? " active" : ""}`}
              onClick={() => onViewChange(item.view, item.status)}
              title={collapsed ? item.label : undefined}
            >
              {item.icon}
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </button>
          );
        })}
        <Link href="/reports" className="nav-btn" title={collapsed ? "Reports" : undefined}>
          <FileText size={18} />
          {!collapsed && <span className="nav-label">Reports</span>}
        </Link>
      </nav>

      {/* Logout */}
      <div style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
        <button className="nav-btn" onClick={handleLogout} title={collapsed ? "Logout" : undefined}>
          <LogOut size={18} />
          {!collapsed && <span className="nav-label">Logout</span>}
        </button>
      </div>
    </aside>
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
