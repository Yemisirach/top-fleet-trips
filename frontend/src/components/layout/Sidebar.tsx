"use client";
import { useState, useCallback } from "react";
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
  Users,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

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
        {!collapsed && <div className="nav-section">Dashboard</div>}
        {NAV_ITEMS.map((item, i) => {
          const isActive =
            currentView === item.view &&
            (!item.status || item.status === "all");
          return (
            <button
              key={i}
              className={`nav-btn${isActive ? " active" : ""}`}
              onClick={() => {
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
        <Link href="/payments" className={`nav-btn${currentView === "payments" ? " active" : ""}`} title={collapsed ? "Payment Requests" : undefined}>
          <CreditCard size={18} />
          {!collapsed && <span className="nav-label">Payment Requests</span>}
        </Link>
        <Link href="/finance" className={`nav-btn${currentView === "finance" ? " active" : ""}`} title={collapsed ? "Finance Summary" : undefined}>
          <Wallet size={18} />
          {!collapsed && <span className="nav-label">Finance Summary</span>}
        </Link>
        <Link href="/reports" className={`nav-btn${currentView === "reports" ? " active" : ""}`} title={collapsed ? "Reports" : undefined}>
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
