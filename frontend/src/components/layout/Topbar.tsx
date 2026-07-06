"use client";
import { Sun, Moon, Menu } from "lucide-react";
import type { DashboardMode } from "@/types/dashboard";

interface TopbarProps {
  title: string;
  subtitle: string;
  mode: DashboardMode;
  modeBadge?: string;
  modeWarning?: string;
  theme: "light" | "dark";
  onThemeToggle: () => void;
  onModeChange: (m: DashboardMode) => void;
  onMenuClick: () => void;
  searchValue: string;
  onSearchChange: (v: string) => void;
  onSearchChip: (v: string) => void;
}

const SEARCH_CHIPS = ["dispatched", "available", "done", "pending"];

export default function Topbar({
  title,
  subtitle,
  mode,
  modeBadge,
  modeWarning,
  theme,
  onThemeToggle,
  onModeChange,
  onMenuClick,
  searchValue,
  onSearchChange,
  onSearchChip,
}: TopbarProps) {
  const badgeClass = modeWarning
    ? "mode-badge warning"
    : mode === "demo"
    ? "mode-badge demo"
    : "mode-badge";

  return (
    <div className="fleet-topbar" style={{ gap: 12 }}>
      {/* Left: menu + title */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>

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
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {SEARCH_CHIPS.map((chip) => (
            <button
              key={chip}
              className="btn"
              style={{ minHeight: 36, fontSize: 12, padding: "4px 10px", whiteSpace: "nowrap" }}
              data-search-chip={chip}
              onClick={() => onSearchChip(chip)}
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* Right: mode badge + mode select + theme */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
        <span className={badgeClass} id="mode-badge">
          <span className="mode-dot" />
          <span id="mode-label">{modeWarning || (mode === "demo" ? "Demo DB" : "Live DB")}</span>
        </span>
        <select
          id="mode-select"
          className="fleet-input"
          style={{ minHeight: 36, width: "auto", paddingRight: 28 }}
          value={mode}
          onChange={(e) => onModeChange(e.target.value as DashboardMode)}
        >
          <option value="live">Live DB</option>
          <option value="demo">Demo DB</option>
        </select>
        <button className="btn" id="theme-toggle" onClick={onThemeToggle}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          <span id="theme-label">{theme === "dark" ? "Light" : "Dark"}</span>
        </button>
      </div>
    </div>
  );
}
