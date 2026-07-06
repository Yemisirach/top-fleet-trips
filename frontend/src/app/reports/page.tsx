"use client";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from "recharts";
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutDashboard, Moon, Sun, Plus, RefreshCw, Menu } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import Sidebar, { type SidebarView } from "@/components/layout/Sidebar";
import { fetchJson, API_BASE } from "@/lib/api";
import { money, normalizeState, stateLabel } from "@/lib/formatters";
import type {
  LocationRow,
  LocationSummary,
  LocationSummaryGroup,
  FinanceSummary,
  DailyProfit,
  IncomeStatement,
  PaymentRequest,
} from "@/types/trip";

type Tab =
  | "current-location"
  | "location-summary"
  | "payment-requests"
  | "finance-summary"
  | "daily-profit"
  | "income-statement"
  | "whatsapp-reports"
  | "new-request";

const TABS: { id: Tab; label: string }[] = [
  { id: "current-location", label: "Current Location" },
  { id: "location-summary", label: "Location Summary" },
  { id: "payment-requests", label: "Payment Requests" },
  { id: "finance-summary", label: "Finance Summary" },
  { id: "daily-profit", label: "Daily Profit" },
  { id: "income-statement", label: "Income Statement" },
  { id: "whatsapp-reports", label: "WhatsApp Reports" },
  { id: "new-request", label: "+ New Request" },
];

export default function ReportsPage() {
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("current-location");
  const [loading, setLoading] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Data states
  const [locationRows, setLocationRows] = useState<LocationRow[]>([]);
  const [locationSummary, setLocationSummary] = useState<LocationSummary | null>(null);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [financeSummary, setFinanceSummary] = useState<FinanceSummary | null>(null);
  const [financePeriod, setFinancePeriod] = useState("daily");
  const [dailyProfit, setDailyProfit] = useState<DailyProfit | null>(null);
  const [dailyDate, setDailyDate] = useState("");
  const [whatsappFormat, setWhatsappFormat] = useState("default");
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatement | null>(null);
  const [whatsappSummary, setWhatsappSummary] = useState<{payment_requests_text: string, current_location_text: string, _warning?: string} | null>(null);
  const [filterText, setFilterText] = useState("");

  // New payment request form
  const [newRequestText, setNewRequestText] = useState("");
  const [newRequestName, setNewRequestName] = useState("");
  const [newRequestVehicle, setNewRequestVehicle] = useState("");
  const [newRequestAmount, setNewRequestAmount] = useState("");
  const [newRequestSubmitting, setNewRequestSubmitting] = useState(false);
  const [newRequestError, setNewRequestError] = useState("");
  const [newRequestSuccess, setNewRequestSuccess] = useState("");
  const [paymentFilterState, setPaymentFilterState] = useState("all");

  const exportPaymentRequests = useCallback(() => {
    const filtered = paymentRequests.filter(pr => 
      paymentFilterState === "all" || 
      (pr.state || "draft").toLowerCase() === paymentFilterState.toLowerCase()
    );
    
    // Additional text search filtering just like in the UI
    const finalRows = filterText 
      ? filtered.filter(r => JSON.stringify(r).toLowerCase().includes(filterText.toLowerCase()))
      : filtered;

    const headers = ["ID", "Name", "Vehicle", "Trip", "Date", "Approved Date", "State", "Requester", "Supervisor", "Total Amount"];
    const rows = finalRows.map(pr => [
      pr.id,
      `"${pr.name || ''}"`,
      `"${pr.vehicle_plate || ''}"`,
      `"${pr.trip_reference || ''}"`,
      pr.date || '',
      pr.approved_on || '',
      pr.state || 'draft',
      `"${pr.requester_name || ''}"`,
      `"${pr.supervisor_name || ''}"`,
      pr.total_amount
    ].join(","));

    // Add a total row at the bottom
    const sum = finalRows.reduce((acc, pr) => acc + (pr.total_amount || 0), 0);
    const totalsRow = ["", "", "", "", "", "", "", "", `"Total"`, sum].join(",");

    const csv = [
      `Payment Requests Report - ${paymentFilterState.toUpperCase()}`,
      "",
      headers.join(","),
      ...rows,
      "",
      totalsRow
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payment_requests_${paymentFilterState}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [paymentRequests, paymentFilterState, filterText]);

  const exportDailyProfit = useCallback(async () => {
    if (!dailyProfit) return;
    
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Daily Profit');

    // Add Title
    sheet.mergeCells('A1:I1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'Daily Cost and Profit Report';
    titleCell.font = { name: 'Times New Roman', size: 14, italic: true, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // Add Date
    sheet.mergeCells('A2:C2');
    const dateCell = sheet.getCell('A2');
    dateCell.value = `Date -${dailyProfit.report_date || "Latest"} E.C`;
    dateCell.font = { name: 'Times New Roman', size: 11, italic: true };
    dateCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // Header Row
    const headers = ["No", "Driver name", "Plate number", "Rent amount", "Daily Total cost", "Actual daily Total revenue", "Actual net profit", "Daily Net profit", "REMARK"];
    const headerRow = sheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Times New Roman', size: 11, italic: true, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
    });
    headerRow.height = 30;

    // Data Rows
    (dailyProfit.rows as any[]).forEach(r => {
      const row = sheet.addRow([
        r.no, r.driver_name, r.plate_number, r.rent_amount || '', r.daily_total_cost || '',
        r.actual_daily_total_revenue || '', r.actual_net_profit, r.daily_net_profit, r.remarks || ''
      ]);
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Times New Roman', size: 11, italic: true };
        cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
        
        // Align amounts to right, others to center/left
        if (colNumber >= 4 && colNumber <= 8) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '#,##0.00';
        } else if (colNumber === 1 || colNumber === 3) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
      });
    });

    // Totals Row
    const totalProfit = dailyProfit.totals.net_profit_total;
    const totalsRow = sheet.addRow(['', '', '', '', ``, '', '', ``, '']);
    
    // Merge cells for totals matching image (cols 4,5,6 and cols 7,8,9 approx)
    sheet.mergeCells(`D${totalsRow.number}:F${totalsRow.number}`);
    sheet.mergeCells(`G${totalsRow.number}:I${totalsRow.number}`);

    const actualProfitCell = sheet.getCell(`D${totalsRow.number}`);
    actualProfitCell.value = `Actual daily profit  ${totalProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    
    const totalProfitCell = sheet.getCell(`G${totalsRow.number}`);
    totalProfitCell.value = `Total daily profit  ${totalProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    [actualProfitCell, totalProfitCell].forEach(cell => {
      cell.font = { name: 'Times New Roman', size: 12, italic: true, bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } }; // Light green
      cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Set Column Widths
    sheet.columns = [
      { width: 5 },  // No
      { width: 20 }, // Driver
      { width: 15 }, // Plate
      { width: 15 }, // Rent
      { width: 15 }, // Daily cost
      { width: 18 }, // Revenue
      { width: 15 }, // Actual Net
      { width: 18 }, // Daily Net
      { width: 30 }, // Remark
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Daily_Cost_and_Profit_Report_${dailyProfit.report_date || "latest"}.xlsx`);
  }, [dailyProfit]);

  const load = useCallback(async (t: Tab = tab) => {
    setLoading(true);
    try {
      if (t === "current-location") {
        const rows = await fetchJson<LocationRow[]>(`${API_BASE}/reports/current-location`);
        setLocationRows(rows);
      } else if (t === "location-summary") {
        const data = await fetchJson<LocationSummary>(`${API_BASE}/reports/current-location-summary`);
        setLocationSummary(data);
      } else if (t === "payment-requests") {
        const rows = await fetchJson<PaymentRequest[]>(`${API_BASE}/reports/payment-requests`);
        setPaymentRequests(rows);
      } else if (t === "finance-summary") {
        const data = await fetchJson<FinanceSummary>(`${API_BASE}/reports/finance-summary?period=${financePeriod}`);
        setFinanceSummary(data);
      } else if (t === "daily-profit") {
        const url = dailyDate
          ? `${API_BASE}/reports/daily-profit?report_date=${dailyDate}`
          : `${API_BASE}/reports/daily-profit`;
        const data = await fetchJson<DailyProfit>(url);
        setDailyProfit(data);
      } else if (t === "income-statement") {
        const data = await fetchJson<IncomeStatement>(`${API_BASE}/reports/income-statement`);
        setIncomeStatement(data);
      } else if (t === "whatsapp-reports") {
        const data = await fetchJson<any>(`${API_BASE}/reports/whatsapp-summary?format=${whatsappFormat}`);
        setWhatsappSummary(data);
        // Also preload daily profit for the spreadsheet button
        if (!dailyProfit) {
            const dp = await fetchJson<DailyProfit>(`${API_BASE}/reports/daily-profit`);
            setDailyProfit(dp);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [tab, financePeriod, dailyDate, whatsappFormat]);

  useEffect(() => {
    // Auth guard
    fetchJson(`${API_BASE}/auth/me`).catch(() => router.push("/login"));
    // Load from hash
    if (typeof window !== "undefined" && window.location.hash === "#payment-requests") {
      setTab("payment-requests");
      load("payment-requests");
    } else {
      load("current-location");
    }
  }, []);

  const handleTabChange = (t: Tab) => {
    setTab(t);
    setFilterText("");
    load(t);
  };

  const handleNewRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewRequestSubmitting(true);
    setNewRequestError("");
    setNewRequestSuccess("");
    try {
      await fetchJson(`${API_BASE}/reports/payment-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newRequestName,
          vehicle_plate: newRequestVehicle,
          total_amount: parseFloat(newRequestAmount) || 0,
          request_text: newRequestText,
        }),
      } as RequestInit);
      setNewRequestSuccess("Payment request submitted successfully.");
      setNewRequestText("");
      setNewRequestName("");
      setNewRequestVehicle("");
      setNewRequestAmount("");
    } catch (err: unknown) {
      setNewRequestError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setNewRequestSubmitting(false);
    }
  };

  const filterRows = <T extends Record<string, unknown>>(rows: T[]): T[] => {
    if (!filterText) return rows;
    const q = filterText.toLowerCase();
    return rows.filter((r) =>
      Object.values(r).join(" ").toLowerCase().includes(q)
    );
  };

  return (
    <div className="app-shell">
      <div className={`overlay${mobileSidebarOpen ? " open" : ""}`} onClick={() => setMobileSidebarOpen(false)}></div>
      <Sidebar 
        currentView={"reports" as SidebarView}
        onViewChange={(v) => {
          if (v === "reports") { window.location.href = "/reports"; }
          else if (v === "map") { window.location.href = "/map"; }
          else { window.location.href = `/?view=${v}`; }
        }} 
        mobileOpen={mobileSidebarOpen} 
      />
      <div className="app-main" style={{ display: "flex", flexDirection: "column", height: "100vh", overflowY: "auto" }}>
        
        {/* Topbar */}
        <header className="fleet-topbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/static/fleet-trips-logo.svg" alt="Fleet Trips" style={{ width: 40, height: 40, borderRadius: 8, display: "none" }} />
            <div>
              <div style={{ fontWeight: 900, fontSize: 20 }}>Reports</div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>Fleet financial and location reports</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => load()}><RefreshCw size={16} /> Refresh</button>
          <button className="btn" id="theme-toggle" onClick={toggle}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="report-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`report-tab${tab === t.id ? " active" : ""}`}
            onClick={() => handleTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filter bar (shared) */}
      {tab !== "new-request" && tab !== "whatsapp-reports" && (
        <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line)", background: "var(--panel)", display: "flex", gap: 10, alignItems: "center" }}>
          <input
            className="fleet-input"
            placeholder="Filter rows…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={{ maxWidth: 320, minHeight: 36 }}
          />
          {tab === "finance-summary" && (
            <select
              className="fleet-input"
              style={{ width: "auto", minHeight: 36 }}
              value={financePeriod}
              onChange={(e) => { setFinancePeriod(e.target.value); load("finance-summary"); }}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          )}
          {tab === "daily-profit" && (
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="fleet-input"
                type="date"
                style={{ minHeight: 36, width: "auto" }}
                value={dailyDate}
                onChange={(e) => { setDailyDate(e.target.value); load("daily-profit"); }}
              />
              <button 
                className="fleet-btn fleet-btn-primary" 
                onClick={exportDailyProfit}
                disabled={!dailyProfit}
                style={{ padding: "0 16px", minHeight: 36 }}
              >
                Export CSV
              </button>
            </div>
          )}
          {loading && <span className="muted" style={{ fontSize: 13 }}>Loading…</span>}
        </div>
      )}

      {/* Content */}
      <div className="fleet-page">

        {/* ── Current Location ── */}
        {tab === "current-location" && (
          <div className="panel">
            <div className="panel-header"><div className="panel-title">Current Vehicle Locations</div></div>
            <div style={{ overflowX: "auto" }}>
              <table className="fleet-table">
                <thead>
                  <tr>
                    {["Vehicle", "Driver", "Departure", "Destination", "Current Location", "GPS Note", "Dep. Date", "State", "Days"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filterRows(locationRows as unknown as Record<string, unknown>[]).length === 0 ? (
                    <tr><td colSpan={9} className="empty">No records.</td></tr>
                  ) : (
                    (filterRows(locationRows as unknown as Record<string, unknown>[]) as unknown as LocationRow[]).map((r, i) => (
                      <tr key={i}>
                        <td>{r.vehicle_plate || "N/A"}</td>
                        <td>{r.driver_name || "Unassigned"}</td>
                        <td>{r.departure_name || "–"}</td>
                        <td>{r.destination_name || "–"}</td>
                        <td>{r.current_location_name || "–"}</td>
                        <td>{r.current_location_note || "–"}</td>
                        <td>{r.departure_date || "–"}</td>
                        <td><span className={`pill ${normalizeState(r.state)}`}>{stateLabel(r.state)}</span></td>
                        <td>{r.current_location_days ?? 0}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Location Summary ── */}
        {tab === "location-summary" && locationSummary && (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "flex", gap: 12 }}>
              <div className="card"><div className="card-label">Total Locations</div><div className="card-value">{locationSummary.total_locations}</div></div>
              <div className="card"><div className="card-label">Total Vehicles</div><div className="card-value">{locationSummary.total_vehicles}</div></div>
            </div>
            {(filterRows(locationSummary.locations as unknown as Record<string, unknown>[]) as unknown as LocationSummaryGroup[]).map((loc) => (
              <div key={loc.location_name} className="panel">
                <div className="panel-header">
                  <div className="panel-title">{loc.location_name}</div>
                  <span className="muted" style={{ fontSize: 13 }}>{loc.vehicle_count} vehicle{loc.vehicle_count === 1 ? "" : "s"}</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="fleet-table">
                    <thead>
                      <tr>{["Vehicle", "Driver", "Destination", "GPS Note", "Dep. Date", "State", "Days"].map((h) => <th key={h}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {loc.vehicles.map((v, i) => (
                        <tr key={i}>
                          <td>{v.vehicle_plate || "N/A"}</td>
                          <td>{v.driver_name || "Unassigned"}</td>
                          <td>{v.destination_name || "–"}</td>
                          <td>{v.current_location_note || "–"}</td>
                          <td>{v.departure_date || "–"}</td>
                          <td><span className={`pill ${normalizeState(v.state)}`}>{stateLabel(v.state)}</span></td>
                          <td>{v.days ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Payment Requests ── */}
        {tab === "payment-requests" && (
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">Payment Requests</div>
              <div style={{ display: "flex", gap: 8, marginLeft: "auto", marginRight: 16 }}>
                <select 
                  className="fleet-input" 
                  style={{ minHeight: 36 }}
                  value={paymentFilterState} 
                  onChange={(e) => setPaymentFilterState(e.target.value)}
                >
                  <option value="all">All States</option>
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                  <option value="paid">Paid</option>
                  <option value="confirmed">Confirmed</option>
                </select>
                <button className="fleet-btn fleet-btn-primary" onClick={exportPaymentRequests} style={{ padding: "0 16px", minHeight: 36 }}>
                  Export Excel
                </button>
              </div>
              <button className="fleet-btn" onClick={() => handleTabChange("new-request")}>
                <Plus size={16} /> New Request
              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="fleet-table" id="payment-requests-table">
                <thead>
                  <tr>{["ID", "Name", "Vehicle", "Trip", "Date", "Approved", "State", "Requester", "Supervisor", "Total"].map((h) => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {(filterRows(paymentRequests as unknown as Record<string, unknown>[]) as unknown as PaymentRequest[])
                    .filter(pr => paymentFilterState === "all" || (pr.state || "draft").toLowerCase() === paymentFilterState.toLowerCase())
                    .length === 0 ? (
                    <tr><td colSpan={10} className="empty">No payment requests found.</td></tr>
                  ) : (
                    (filterRows(paymentRequests as unknown as Record<string, unknown>[]) as unknown as PaymentRequest[])
                      .filter(pr => paymentFilterState === "all" || (pr.state || "draft").toLowerCase() === paymentFilterState.toLowerCase())
                      .map((pr) => (
                      <tr key={pr.id}>
                        <td>{String(pr.id)}</td>
                        <td>{pr.name || "–"}</td>
                        <td>{pr.vehicle_plate || "–"}</td>
                        <td>{pr.trip_reference || "–"}</td>
                        <td>{pr.date || "–"}</td>
                        <td>{pr.approved_on || "–"}</td>
                        <td><span className={`pill ${pr.state || "draft"}`}>{pr.state || "Draft"}</span></td>
                        <td>{pr.requester_name || "–"}</td>
                        <td>{pr.supervisor_name || "–"}</td>
                        <td className="green">{money(pr.total_amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Finance Summary ── */}
        {tab === "finance-summary" && financeSummary && (
          <div style={{ display: "grid", gap: 16 }}>
            {financeSummary._warning && (
              <div className="login-error">{financeSummary._warning}</div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 12 }}>
              <div className="card"><div className="card-label">Trips</div><div className="card-value">{financeSummary.totals.trip_count}</div></div>
              <div className="card"><div className="card-label">Revenue</div><div className="card-value green">{money(financeSummary.totals.revenue_total)}</div></div>
              <div className="card"><div className="card-label">Expense</div><div className="card-value red">{money(financeSummary.totals.expense_total)}</div></div>
              <div className="card"><div className="card-label">Profit</div><div className={`card-value ${financeSummary.totals.profit >= 0 ? "green" : "red"}`}>{money(financeSummary.totals.profit)}</div></div>
            </div>
            <div className="panel">
              <div className="panel-header"><div className="panel-title">By {financePeriod.charAt(0).toUpperCase() + financePeriod.slice(1)}</div></div>
              <div style={{ overflowX: "auto" }}>
                <table className="fleet-table">
                  <thead><tr>{["Period", "Trips", "Revenue", "Expense", "Profit"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {financeSummary.periods.map((p, i) => (
                      <tr key={i}>
                        <td>{p.period_start}</td>
                        <td>{p.trip_count}</td>
                        <td className="green">{money(p.revenue_total)}</td>
                        <td className="red">{money(p.expense_total)}</td>
                        <td className={p.profit >= 0 ? "green" : "red"}>{money(p.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Daily Profit ── */}
        {tab === "daily-profit" && dailyProfit && (
          <div style={{ display: "grid", gap: 16 }}>
            {dailyProfit._warning && <div className="login-error">{dailyProfit._warning}</div>}
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div className="card"><div className="card-label">Report Date</div><div className="card-value">{dailyProfit.report_date || "Latest"}</div></div>
              <div className="card"><div className="card-label">Vehicles</div><div className="card-value">{dailyProfit.totals.vehicle_count}</div></div>
              <div className="card"><div className="card-label">Revenue</div><div className="card-value green">{money(dailyProfit.totals.revenue_total)}</div></div>
              <div className="card"><div className="card-label">Net Profit</div><div className={`card-value ${dailyProfit.totals.net_profit_total >= 0 ? "green" : "red"}`}>{money(dailyProfit.totals.net_profit_total)}</div></div>
            </div>
            <div className="panel">
              <div className="panel-header"><div className="panel-title">Daily Vehicle Profit Report</div></div>
              <div style={{ padding: "16px 24px 0", fontStyle: "italic", fontWeight: "bold" }}>
                Date - {dailyProfit.report_date || "Latest"}
              </div>
              <div style={{ overflowX: "auto", padding: "16px 24px 24px" }}>
                <table className="fleet-table" style={{ border: "1px solid var(--border)", borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                  <thead>
                    <tr>
                      {["No", "Driver name", "Plate number", "Rent amount", "Daily Total cost", "Actual daily Total revenue", "Actual net profit", "Daily Net profit", "REMARK"].map((h) => (
                        <th key={h} style={{ border: "1px solid var(--border)", padding: "8px 12px", fontStyle: "italic", fontWeight: "normal", textAlign: "center", backgroundColor: "transparent" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(filterRows(dailyProfit.rows as unknown as Record<string, unknown>[]) as unknown as typeof dailyProfit.rows).map((r) => (
                      <tr key={r.no}>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px", textAlign: "center", fontStyle: "italic" }}>{r.no}</td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px" }}>{r.driver_name}</td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px" }}>{r.plate_number}</td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px", textAlign: "right" }}>{r.rent_amount ? money(r.rent_amount) : ""}</td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px", textAlign: "right" }}>{r.daily_total_cost ? money(r.daily_total_cost) : ""}</td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px", textAlign: "right" }}>{r.actual_daily_total_revenue ? money(r.actual_daily_total_revenue) : ""}</td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px", textAlign: "right", fontStyle: "italic" }}>{money(r.actual_net_profit)}</td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px", textAlign: "right", fontStyle: "italic" }}>{money(r.daily_net_profit)}</td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px", fontStyle: "italic" }}>{r.remarks}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} style={{ border: "0" }}></td>
                      <td colSpan={4} style={{ border: "1px solid var(--border)", padding: "8px 12px", backgroundColor: "#7fe57f", color: "#000", fontWeight: "bold", textAlign: "center", fontStyle: "italic" }}>
                        Actual daily profit {money(dailyProfit.totals.net_profit_total)}
                      </td>
                      <td colSpan={2} style={{ border: "1px solid var(--border)", padding: "8px 12px", backgroundColor: "#7fe57f", color: "#000", fontWeight: "bold", textAlign: "left", fontStyle: "italic" }}>
                        Total daily profit {money(dailyProfit.totals.net_profit_total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Income Statement ── */}
        {tab === "income-statement" && incomeStatement && (
          <div style={{ display: "grid", gap: 16 }}>
            {incomeStatement._warning && <div className="login-error">{incomeStatement._warning}</div>}
            <div className="panel">
              <div className="panel-header"><div className="panel-title">Income Statement</div></div>
              <div className="panel-body" style={{ display: "grid", gap: 12 }}>
                {(
                  [
                    ["Confirmed Receivables (Revenue)", money(incomeStatement.revenue_total), "green"],
                    ["Approved Expenses", money(incomeStatement.expense_total), "red"],
                    ["Net Profit", money(incomeStatement.profit), incomeStatement.profit >= 0 ? "green" : "red"],
                    ["Receivable Count", incomeStatement.receivable_count, ""],
                    ["Payment Request Count", incomeStatement.payment_request_count, ""],
                    ["Trip Count", incomeStatement.trip_count, ""],
                  ] as [string, string | number, string][]
                ).map(([label, value, tone]) => (
                  <div className="summary-row" key={label}>
                    <span className="muted">{label}</span>
                    <strong className={tone}>{String(value)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── WhatsApp Reports ── */}
        {tab === "whatsapp-reports" && (
          <div style={{ display: "grid", gap: 24, maxWidth: 800 }}>
            {whatsappSummary?._warning && <div className="login-error">{whatsappSummary._warning}</div>}
            
            <div className="panel">
              <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div className="panel-title">1. Supervisor Payment Requests</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select 
                    className="fleet-input" 
                    value={whatsappFormat} 
                    onChange={(e) => setWhatsappFormat(e.target.value)}
                    style={{ padding: "4px 8px", minHeight: "auto", fontSize: 14 }}
                  >
                    <option value="default">Default Text</option>
                    <option value="table">ASCII Table</option>
                    <option value="csv">CSV Raw</option>
                  </select>
                  <button 
                    className="fleet-btn fleet-btn-primary" 
                    onClick={() => {
                      navigator.clipboard.writeText(whatsappSummary?.payment_requests_text || "");
                      const btn = document.getElementById("copy-pr-btn");
                      if (btn) { btn.innerText = "Copied!"; setTimeout(() => btn.innerText = "Copy to WhatsApp", 2000); }
                    }}
                    id="copy-pr-btn"
                  >
                    Copy to WhatsApp
                  </button>
                </div>
              </div>
              <div className="panel-body" style={{ backgroundColor: theme === "dark" ? "#0b141a" : "#efeae2", padding: "32px 24px", borderRadius: "0 0 8px 8px" }}>
                <div style={{ 
                  backgroundColor: theme === "dark" ? "#056162" : "#dcf8c6", 
                  color: theme === "dark" ? "#e9edef" : "#111b21", 
                  padding: "12px 16px", 
                  borderRadius: 12, 
                  borderTopLeftRadius: 4, 
                  boxShadow: "0 1px 2px rgba(0,0,0,0.15)", 
                  maxWidth: "95%", 
                  fontFamily: "'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif", 
                  fontSize: 15, 
                  whiteSpace: "pre-wrap", 
                  lineHeight: 1.5 
                }}>
                  {whatsappSummary?.payment_requests_text || "Loading..."}
                  <div style={{ textAlign: "right", fontSize: 11, color: theme === "dark" ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.45)", marginTop: 6 }}>
                    {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </div>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="panel-title">2. Current Location Report</div>
                <button 
                  className="fleet-btn fleet-btn-primary" 
                  onClick={() => {
                    navigator.clipboard.writeText(whatsappSummary?.current_location_text || "");
                    const btn = document.getElementById("copy-loc-btn");
                    if (btn) { btn.innerText = "Copied!"; setTimeout(() => btn.innerText = "Copy to WhatsApp", 2000); }
                  }}
                  id="copy-loc-btn"
                >
                  Copy to WhatsApp
                </button>
              </div>
              <div className="panel-body" style={{ backgroundColor: theme === "dark" ? "#0b141a" : "#efeae2", padding: "32px 24px", borderRadius: "0 0 8px 8px" }}>
                <div style={{ 
                  backgroundColor: theme === "dark" ? "#056162" : "#dcf8c6", 
                  color: theme === "dark" ? "#e9edef" : "#111b21", 
                  padding: "12px 16px", 
                  borderRadius: 12, 
                  borderTopLeftRadius: 4, 
                  boxShadow: "0 1px 2px rgba(0,0,0,0.15)", 
                  maxWidth: "95%", 
                  fontFamily: "'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif", 
                  fontSize: 15, 
                  whiteSpace: "pre-wrap", 
                  lineHeight: 1.5 
                }}>
                  {whatsappSummary?.current_location_text || "Loading..."}
                  <div style={{ textAlign: "right", fontSize: 11, color: theme === "dark" ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.45)", marginTop: 6 }}>
                    {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </div>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="panel-title">3. Final Daily Revenue Expense Report</div>
                <button 
                  className="fleet-btn fleet-btn-primary" 
                  onClick={exportDailyProfit}
                  disabled={!dailyProfit}
                >
                  Download Spreadsheet
                </button>
              </div>
              <div className="panel-body">
                <p className="muted" style={{ margin: 0 }}>
                  This downloads the Daily Cost and Profit report in CSV format matching the standard spreadsheet layout.
                </p>
              </div>
            </div>

          </div>
        )}

        {/* ── New Request form ── */}
        {tab === "new-request" && (
          <div style={{ maxWidth: 560 }}>
            <div className="panel">
              <div className="panel-header"><div className="panel-title">New Payment Request</div></div>
              <div className="panel-body">
                {newRequestError && <div className="login-error" style={{ marginBottom: 16 }}>{newRequestError}</div>}
                {newRequestSuccess && <div style={{ background: "var(--secondary-soft)", border: "1px solid rgba(14,152,73,.3)", color: "var(--secondary)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>{newRequestSuccess}</div>}
                <form onSubmit={handleNewRequest} style={{ display: "grid", gap: 14 }}>
                  <div>
                    <label className="login-label" htmlFor="req-name">Request Name (optional)</label>
                    <input id="req-name" className="fleet-input" value={newRequestName} onChange={(e) => setNewRequestName(e.target.value)} placeholder="e.g. APP-PAY-20240601" />
                  </div>
                  <div>
                    <label className="login-label" htmlFor="req-vehicle">Vehicle Plate (optional)</label>
                    <input id="req-vehicle" className="fleet-input" value={newRequestVehicle} onChange={(e) => setNewRequestVehicle(e.target.value)} placeholder="e.g. AA-12345" />
                  </div>
                  <div>
                    <label className="login-label" htmlFor="req-amount">Total Amount (ETB)</label>
                    <input id="req-amount" className="fleet-input" type="number" min="0" step="1" value={newRequestAmount} onChange={(e) => setNewRequestAmount(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <label className="login-label" htmlFor="req-text">Request Details *</label>
                    <textarea
                      id="req-text"
                      className="fleet-input"
                      rows={5}
                      required
                      value={newRequestText}
                      onChange={(e) => setNewRequestText(e.target.value)}
                      placeholder="Describe the payment request with amounts…"
                      style={{ resize: "vertical" }}
                    />
                  </div>
                  <button type="submit" className="btn primary" disabled={newRequestSubmitting} id="submit-request">
                    {newRequestSubmitting ? "Submitting…" : <><Plus size={16} /> Submit Request</>}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
