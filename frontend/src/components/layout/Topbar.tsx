"use client";
import { Sun, Moon, Menu } from "lucide-react";

interface TopbarProps {
  title: string;
  subtitle: string;
  modeLabel?: string;
  modeWarning?: string;
  theme: "light" | "dark";
  onThemeToggle: () => void;
  onMenuClick: () => void;
  searchValue: string;
  onSearchChange: (v: string) => void;
}

export default function Topbar({
  title,
  subtitle,
  modeLabel,
  modeWarning,
  theme,
  onThemeToggle,
  onMenuClick,
  searchValue,
  onSearchChange,
}: TopbarProps) {
  const badgeClass = modeWarning ? "mode-badge warning" : "mode-badge";

  return (
    <div className="fleet-topbar" style={{ gap: 12 }}>
      {/* Left: menu + title */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <button
          type="button"
          className="btn md-hidden"
          onClick={onMenuClick}
          aria-label="Open menu"
          style={{ minHeight: 36, minWidth: 36, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        >
          <Menu size={18} />
        </button>

        <div style={{ minWidth: 0 }}>
          <div
            style={{ fontWeight: 900, fontSize: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            id="page-title"
          >
            {title}
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12 }} id="page-subtitle">
            {subtitle}
          </div>
        </div>
      </div>

      {/* Centre: search */}
      <div style={{ flex: 1, maxWidth: 640, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input
          id="global-search"
          className="fleet-input"
          placeholder="Search plate, driver, customer…"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{ minHeight: 36, flex: 1, width: "auto", minWidth: 200 }}
        />
      </div>

      {/* Right: data source badge + theme */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
        <span className={badgeClass} id="mode-badge">
          <span className="mode-dot" />
          <span id="mode-label">{modeWarning || modeLabel || "Live Odoo"}</span>
        </span>
        <button className="btn" id="theme-toggle" onClick={onThemeToggle}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          <span id="theme-label">{theme === "dark" ? "Light" : "Dark"}</span>
        </button>
      </div>
    </div>
  );
}
