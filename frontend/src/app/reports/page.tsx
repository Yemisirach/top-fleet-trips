"use client";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from "recharts";
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutDashboard, Moon, Sun, Plus, RefreshCw, Menu, ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import Sidebar, { type SidebarView } from "@/components/layout/Sidebar";
import BackButton from "@/components/navigation/BackButton";
import { fetchCachedJson, fetchJson, readCachedJson, API_BASE } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cleanTripReference, money, normalizeState, stateLabel } from "@/lib/formatters";
import type {
  LocationRow,
  LocationSummary,
  LocationSummaryGroup,
  FinanceSummary,
  DailyProfit,
  DailyProfitRow,
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

type PaymentSubtab = "all" | "daily-supervisor" | "pscn";

interface WhatsappSummary {
  payment_requests_text: string;
  current_location_text: string;
  _warning?: string;
}

interface DailySupervisorRow {
  date: string;
  supervisor: string;
  vehicle: string;
  route: string;
  requestId: string | number;
  state: string;
  requester: string;
  item: string;
  description: string;
  quantity: number;
  amount: number;
  lineTotal: number;
  requestTotal: number;
}

interface PscnRow {
  customerId: string | number;
  customer: string;
  status: string;
  vehicle: string;
  trip: string;
  supervisor: string;
  requestId: string | number;
  requestName: string;
  requestState: string;
  customerPaid: number;
  customerPending: number;
  customerTotal: number;
  requestTotal: number;
  date: string;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "current-location", label: "Current Location" },
  { id: "location-summary", label: "Location Summary" },
  { id: "daily-profit", label: "Daily Profit" },
  { id: "income-statement", label: "Income Statement" },
  { id: "whatsapp-reports", label: "WhatsApp Reports" },
];

const todayIsoDate = () => new Date().toISOString().slice(0, 10);
const PAYMENT_REQUESTS_CACHE_KEY = "reports:payment-requests:odoo-db-v5";

export default function ReportsPage() {
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "current-location";
    if (window.location.hash === "#payment-requests") {
      window.location.replace("/payments");
    }
    return "current-location";
  });
  const [loading, setLoading] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Data states
  const [locationRows, setLocationRows] = useState<LocationRow[]>([]);
  const [locationSummary, setLocationSummary] = useState<LocationSummary | null>(null);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [financeSummary, setFinanceSummary] = useState<FinanceSummary | null>(null);
  const [financePeriod, setFinancePeriod] = useState("daily");
  const [financeGroupBy, setFinanceGroupBy] = useState("all");
  const [dailyProfit, setDailyProfit] = useState<DailyProfit | null>(null);
  const [dailyDate, setDailyDate] = useState("");
  const [whatsappFormat, setWhatsappFormat] = useState("default");
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatement | null>(null);
  const [whatsappSummary, setWhatsappSummary] = useState<WhatsappSummary | null>(null);
  const [filterText, setFilterText] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("all");
  const [selectedPrIds, setSelectedPrIds] = useState<string[]>([]);
  const [expandedPaymentIds, setExpandedPaymentIds] = useState<string[]>([]);
  const [editingPrId, setEditingPrId] = useState<string | null>(null);

  // New payment request form
  const [newRequestTripRef, setNewRequestTripRef] = useState("");
  const [newRequestName, setNewRequestName] = useState("");
  const [newRequestVehicle, setNewRequestVehicle] = useState("");
  const [newRequestSupervisor, setNewRequestSupervisor] = useState("");
  const [newRequestLines, setNewRequestLines] = useState([{ item: "", description: "", amount: 0, quantity: 1 }]);
  const [newRequestSubmitting, setNewRequestSubmitting] = useState(false);
  const [newRequestError, setNewRequestError] = useState("");
  const [newRequestSuccess, setNewRequestSuccess] = useState("");
  const [paymentFilterState, setPaymentFilterState] = useState("all");
  const [paymentFilterDate, setPaymentFilterDate] = useState(() => todayIsoDate());
  const [paymentSubtab, setPaymentSubtab] = useState<PaymentSubtab>("all");
  const [paymentStatusUpdating, setPaymentStatusUpdating] = useState<string | null>(null);

  const requestLines = (pr: PaymentRequest) => {
    if (Array.isArray(pr.line_items) && pr.line_items.length) return pr.line_items;
    if (pr.request_text) {
      return pr.request_text.split("\n").filter(Boolean).map((line, index) => ({
        item: `Line ${index + 1}`,
        description: line,
        amount: 0,
        quantity: 1,
        total: 0,
      }));
    }
    return [{
      item: "Total",
      description: pr.name || pr.reference || "Payment request",
      amount: Number(pr.total_amount || 0),
      quantity: 1,
      total: Number(pr.total_amount || 0),
    }];
  };

  const paymentItemName = (item?: string, description?: string) => {
    const itemText = String(item || "").trim();
    const descriptionText = String(description || "").trim();
    const raw = /^line\s+\d+$/i.test(itemText)
      ? descriptionText
      : itemText || descriptionText || "Item";
    return raw
      .replace(/^cancelled\s+request:\s*/i, "")
      .replace(/\s*-\s*(cancelled|canceled|posted|done)\b/gi, "")
      .trim() || "Item";
  };

  const paymentRequestDateValue = (pr: PaymentRequest) => String(pr.date || pr.approved_on || "").slice(0, 10);

  const paymentRouteName = useCallback((pr: PaymentRequest) => {
    const explicitRoute = String(pr.route_name || "").trim();
    if (explicitRoute) return explicitRoute;
    const origin = String(pr.origin || "").trim();
    const destination = String(pr.destination || "").trim();
    if (origin && destination) return `${origin} to ${destination}`;
    return cleanTripReference(pr.trip_reference, "No route");
  }, []);

  const customerPaymentStatus = useCallback((pr: PaymentRequest) => {
    const total = Number(pr.customer_receivable_total || 0);
    const paid = Number(pr.customer_paid_amount || 0);
    const pending = Number(pr.customer_pending_amount || 0);
    if (total > 0 && pending <= 0) return "Paid";
    if (paid > 0 && pending > 0) return "Partial";
    if (pending > 0) return "Pending";
    return stateLabel(pr.state || "draft");
  }, []);

  const selectedPaymentRequests = useCallback(() => {
    return paymentRequests.length > 0
      ? paymentRequests.filter((pr) => selectedPrIds.length === 0 || selectedPrIds.includes(String(pr.id)))
      : [];
  }, [paymentRequests, selectedPrIds]);

  const buildPaymentWhatsappText = useCallback((requests: PaymentRequest[]) => {
    if (!requests.length) return "No payment requests loaded yet. Please refresh.";
    const supervisorGroups = new Map<string, PaymentRequest[]>();
    requests.forEach((pr) => {
      const supervisor = pr.supervisor_name || "Unassigned supervisor";
      supervisorGroups.set(supervisor, [...(supervisorGroups.get(supervisor) || []), pr]);
    });

    const lines: string[] = ["1. Supervisor Payment Requests", ""];
    let grandTotal = 0;
    Array.from(supervisorGroups.entries()).forEach(([supervisor, supervisorRequests], supervisorIndex) => {
      const supervisorTotal = supervisorRequests.reduce((sum, pr) => sum + Number(pr.total_amount || 0), 0);
      grandTotal += supervisorTotal;
      lines.push(`${supervisorIndex + 1}. Assigned Supervisor: ${supervisor}`);

      const driverGroups = new Map<string, PaymentRequest[]>();
      supervisorRequests.forEach((pr) => {
        const driver = pr.driver_name || pr.requester_name || pr.supervisor_name || "Unassigned driver";
        driverGroups.set(driver, [...(driverGroups.get(driver) || []), pr]);
      });

      Array.from(driverGroups.entries()).forEach(([driver, driverRequests]) => {
        const driverTotal = driverRequests.reduce((sum, pr) => sum + Number(pr.total_amount || 0), 0);
        lines.push(`Driver: ${driver}`);
        driverRequests.forEach((pr) => {
          lines.push(`  ${pr.vehicle_plate || "No Plate"} | ${pr.date?.split("T")[0] || "No date"} | ${stateLabel(pr.state || "draft")}`);
          requestLines(pr).forEach((line) => {
            const item = line.item || line.description || "Item";
            const qty = Number(line.quantity || 1);
            const total = Number(line.total ?? ((line.amount || 0) * qty));
            lines.push(`    - ${item}: ${qty} x ${money(line.amount || 0)} = ${money(total)}`);
          });
          lines.push(`    Request Total: ${money(pr.total_amount || 0)}`);
        });
        lines.push(`  Driver Total: ${money(driverTotal)}`);
      });
      lines.push(`Supervisor Total: ${money(supervisorTotal)}`, "");
    });
    lines.push(`Requested Payment Grand Total: ${money(grandTotal)}`);
    return lines.join("\n");
  }, []);

  const copyWithButtonFeedback = async (text: string, buttonId: string, label: string) => {
    const copied = await copyTextToClipboard(text);
    const btn = document.getElementById(buttonId);
    if (btn) {
      btn.innerText = copied ? "Copied!" : "Copy failed";
      window.setTimeout(() => { btn.innerText = label; }, 2000);
    }
  };

  const updatePaymentStatus = async (pr: PaymentRequest, state: string) => {
    const id = String(pr.id);
    setPaymentStatusUpdating(id);
    try {
      await fetchJson(`${API_BASE}/reports/payment-request/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      } as RequestInit);
      setPaymentRequests((current) =>
        current.map((item) =>
          String(item.id) === id
            ? { ...item, state, approved_on: ["approved", "paid", "done", "posted"].includes(state) ? todayIsoDate() : item.approved_on }
            : item
        )
      );
      setWhatsappSummary(null);
      void load("payment-requests", true, true);
    } finally {
      setPaymentStatusUpdating(null);
    }
  };

  const togglePaymentExpanded = (id: string | number) => {
    const key = String(id);
    setExpandedPaymentIds((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  };

  const filteredPaymentRequests = useMemo(() => {
    const q = filterText.toLowerCase().trim();
    return paymentRequests
      .filter((pr) => {
        if (!q) return true;
        return Object.values(pr as unknown as Record<string, unknown>)
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .filter((pr) => (
        paymentFilterState === "all" ||
        (pr.state || "draft").toLowerCase() === paymentFilterState.toLowerCase()
      ))
      .filter((pr) => {
        if (!paymentFilterDate) return true;
        return paymentRequestDateValue(pr) === paymentFilterDate;
      });
  }, [filterText, paymentFilterDate, paymentFilterState, paymentRequests]);

  const paymentRequestStats = useMemo(() => {
    const total = filteredPaymentRequests.reduce((sum, pr) => sum + Number(pr.total_amount || 0), 0);
    return {
      count: filteredPaymentRequests.length,
      total,
      date: paymentFilterDate || todayIsoDate(),
    };
  }, [filteredPaymentRequests, paymentFilterDate]);

  const dailySupervisorRows = useMemo<DailySupervisorRow[]>(() => {
    return filteredPaymentRequests
      .flatMap((pr) => requestLines(pr).map((line) => ({
        date: (pr.date || pr.approved_on || new Date().toISOString()).slice(0, 10),
        supervisor: pr.supervisor_name || pr.requester_name || "Unassigned",
        vehicle: pr.vehicle_plate || "",
        route: paymentRouteName(pr),
        requestId: pr.id,
        state: pr.state || "draft",
        requester: pr.requester_name || "",
        item: line.item || "",
        description: line.description || "",
        quantity: line.quantity || 1,
        amount: line.amount || 0,
        lineTotal: line.total ?? ((line.amount || 0) * (line.quantity || 1)),
        requestTotal: pr.total_amount || 0,
      })))
      .sort((a, b) =>
        b.date.localeCompare(a.date) ||
        a.supervisor.localeCompare(b.supervisor) ||
        a.vehicle.localeCompare(b.vehicle)
      );
  }, [filteredPaymentRequests, paymentRouteName]);

  const dailySupervisorTotal = dailySupervisorRows.reduce((sum, row) => sum + Number(row.lineTotal || 0), 0);

  const pscnRows = useMemo<PscnRow[]>(() => {
    return filteredPaymentRequests
      .map((pr) => ({
        customerId: pr.customer_id || pr.trip_id || "–",
        customer: pr.customer_name || pr.requester_name || "Unknown customer",
        status: customerPaymentStatus(pr),
        vehicle: pr.vehicle_plate || "No vehicle",
        trip: pr.trip_reference || paymentRouteName(pr),
        supervisor: pr.supervisor_name || "Unassigned",
        requestId: pr.id,
        requestName: pr.name || `Request #${pr.id}`,
        requestState: pr.state || "draft",
        customerPaid: Number(pr.customer_paid_amount || 0),
        customerPending: Number(pr.customer_pending_amount || 0),
        customerTotal: Number(pr.customer_receivable_total || 0),
        requestTotal: Number(pr.total_amount || 0),
        date: paymentRequestDateValue(pr) || "No date",
      }))
      .sort((a, b) =>
        a.customer.localeCompare(b.customer) ||
        a.status.localeCompare(b.status) ||
        b.date.localeCompare(a.date)
      );
  }, [customerPaymentStatus, filteredPaymentRequests, paymentRouteName]);

  const pscnFilteredRows = pscnRows;

  const pscnKpis = useMemo(() => {
    const customerNames = new Set(pscnFilteredRows.map((row) => row.customer));
    const paidRows = pscnFilteredRows.filter((row) => row.status.toLowerCase() === "paid");
    const partialRows = pscnFilteredRows.filter((row) => row.status.toLowerCase() === "partial");
    const pendingRows = pscnFilteredRows.filter((row) => row.status.toLowerCase() === "pending");
    return {
      customers: customerNames.size,
      trips: pscnFilteredRows.length,
      paidCount: paidRows.length,
      partialCount: partialRows.length,
      pendingCount: pendingRows.length,
      paidAmount: pscnFilteredRows.reduce((sum, row) => sum + row.customerPaid, 0),
      pendingAmount: pscnFilteredRows.reduce((sum, row) => sum + row.customerPending, 0),
      requestAmount: pscnFilteredRows.reduce((sum, row) => sum + row.requestTotal, 0),
    };
  }, [pscnFilteredRows]);

  const exportDailySupervisorPaymentRequests = useCallback(async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Daily Supervisor");

    sheet.mergeCells("A1:J1");
    const titleCell = sheet.getCell("A1");
    titleCell.value = "Daily Supervisor Payment Requests";
    titleCell.font = { name: "Times New Roman", size: 14, italic: true, bold: true };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };

    sheet.mergeCells("A2:C2");
    const dateCell = sheet.getCell("A2");
    dateCell.value = `Date - ${paymentFilterDate || todayIsoDate()}`;
    dateCell.font = { name: "Times New Roman", size: 11, italic: true };
    dateCell.alignment = { horizontal: "center", vertical: "middle" };

    const headers = ["No", "Supervisor", "Plate number", "Route", "Item / Asked For", "Qty", "Asked Price", "Line Total", "REMARK"];
    const headerRow = sheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { name: "Times New Roman", size: 11, italic: false, bold: false };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { top: {style:"thin"}, left: {style:"thin"}, bottom: {style:"thin"}, right: {style:"thin"} };
    });
    headerRow.height = 30;

    dailySupervisorRows.forEach((row, index) => {
      const dataRow = sheet.addRow([
        index + 1,
        row.supervisor,
        row.vehicle,
        row.route,
        row.item || row.description || "",
        row.quantity,
        row.amount,
        row.lineTotal,
        `${row.state || "draft"} / Request ${row.requestId}`,
      ]);
      dataRow.eachCell((cell, colNumber) => {
        cell.font = { name: "Times New Roman", size: 11 };
        cell.border = { top: {style:"thin"}, left: {style:"thin"}, bottom: {style:"thin"}, right: {style:"thin"} };
        if ([7, 8].includes(colNumber)) {
          cell.alignment = { horizontal: "right", vertical: "middle" };
          cell.numFmt = "#,##0.00";
        } else if ([1, 3, 6].includes(colNumber)) {
          cell.alignment = { horizontal: "center", vertical: "middle" };
        } else {
          cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
        }
      });
    });

    const totalRow = sheet.addRow(["", "", "", "", "", "", "", "Total", dailySupervisorTotal]);
    sheet.mergeCells(`A${totalRow.number}:G${totalRow.number}`);
    const totalLabelCell = sheet.getCell(`H${totalRow.number}`);
    const totalValueCell = sheet.getCell(`I${totalRow.number}`);
    [totalLabelCell, totalValueCell].forEach((cell) => {
      cell.font = { name: "Times New Roman", size: 12, italic: false, bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF92D050" } };
      cell.border = { top: {style:"thin"}, left: {style:"thin"}, bottom: {style:"thin"}, right: {style:"thin"} };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    totalValueCell.numFmt = "#,##0.00";

    sheet.columns = [
      { width: 6 },
      { width: 22 },
      { width: 16 },
      { width: 24 },
      { width: 38 },
      { width: 8 },
      { width: 14 },
      { width: 16 },
      { width: 28 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(
      new Blob([buffer]),
      `Daily_Supervisor_Payment_Requests_${paymentFilterDate || new Date().toISOString().slice(0, 10)}.xlsx`
    );
  }, [dailySupervisorRows, dailySupervisorTotal, paymentFilterDate]);

  const exportDailyProfit = useCallback(async () => {
    if (!dailyProfit) return;
    
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Daily Profit');

    // Add Title
    sheet.mergeCells('A1:G1');
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
    const headers = ["No", "Driver name", "Plate number", "Route", "Revenue", "Cost", "Result"];
    const headerRow = sheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Times New Roman', size: 11, italic: true, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
    });
    headerRow.height = 30;

    // Data Rows
    dailyProfit.rows.forEach((r: DailyProfitRow) => {
      const row = sheet.addRow([
        r.no,
        r.driver_name,
        r.plate_number,
        r.remarks || '',
        r.receivable_posted ? r.actual_daily_total_revenue : '',
        r.daily_total_cost || '',
        r.receivable_posted ? r.actual_net_profit : 'Receivable not posted',
      ]);
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Times New Roman', size: 11 };
        cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
        
        if (colNumber >= 5 && colNumber <= 7 && r.receivable_posted) {
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
    const pendingCost = dailyProfit.totals.pending_cost_total || 0;
    const totalsRow = sheet.addRow(['', '', '', '', '', '', '']);
    sheet.mergeCells(`A${totalsRow.number}:G${totalsRow.number}`);

    const actualProfitCell = sheet.getCell(`A${totalsRow.number}`);
    actualProfitCell.value = `Posted profit  ${totalProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}${pendingCost ? `   |   Waiting for receivable  ${pendingCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : ''}`;
    const totalProfitCell = actualProfitCell;

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

  const load = useCallback(async (t: Tab = tab, force = false, silent = false) => {
    // Avoid re-fetching if data is already present and not forced
    const hasData = (() => {
      if (t === "current-location") return locationRows.length > 0;
      if (t === "location-summary") return !!locationSummary;
      if (t === "payment-requests") return paymentRequests.length > 0;
      if (t === "finance-summary") return !!financeSummary;
      if (t === "daily-profit") return !!dailyProfit;
      if (t === "income-statement") return !!incomeStatement;
      return false; // whatsapp reports always recalculate 
    })();

    if (!force && hasData && t !== "whatsapp-reports") return;

    let showedCachedData = false;
    const showCached = <T,>(cacheKey: string, setter: (data: T) => void) => {
      if (force) return;
      const cached = readCachedJson<T>(cacheKey);
      if (cached === undefined) return;
      setter(cached);
      showedCachedData = true;
    };

    if (t === "current-location") {
      showCached<LocationRow[]>("reports:current-location-supervised-v2", setLocationRows);
    } else if (t === "location-summary") {
      showCached<LocationSummary>("reports:current-location-summary-supervised-v2", setLocationSummary);
    } else if (t === "payment-requests") {
      showCached<PaymentRequest[]>(PAYMENT_REQUESTS_CACHE_KEY, setPaymentRequests);
    } else if (t === "finance-summary") {
      showCached<FinanceSummary>(`reports:finance-summary-v4:${financePeriod}:${financeGroupBy}`, setFinanceSummary);
    } else if (t === "daily-profit") {
      showCached<DailyProfit>(`reports:daily-profit-v4:${dailyDate || "latest"}`, setDailyProfit);
    } else if (t === "income-statement") {
      showCached<IncomeStatement>("reports:income-statement", setIncomeStatement);
    } else if (t === "whatsapp-reports") {
      showCached<PaymentRequest[]>(PAYMENT_REQUESTS_CACHE_KEY, setPaymentRequests);
      showCached<WhatsappSummary>(
        `reports:whatsapp-summary:${whatsappFormat}:${selectedPrIds.join("-") || "none"}`,
        setWhatsappSummary
      );
    }

    if (!silent) setLoading(!showedCachedData);
    try {
      if (t === "current-location") {
        const rows = await fetchCachedJson<LocationRow[]>(`${API_BASE}/reports/current-location`, undefined, { ttlMs: 600_000, cacheKey: "reports:current-location-supervised-v2", forceRefresh: force });
        setLocationRows(rows);
      } else if (t === "location-summary") {
        const data = await fetchCachedJson<LocationSummary>(`${API_BASE}/reports/current-location-summary`, undefined, { ttlMs: 600_000, cacheKey: "reports:current-location-summary-supervised-v2", forceRefresh: force });
        setLocationSummary(data);
      } else if (t === "payment-requests") {
        const rows = await fetchCachedJson<PaymentRequest[]>(`${API_BASE}/reports/payment-requests`, undefined, { ttlMs: 600_000, cacheKey: PAYMENT_REQUESTS_CACHE_KEY, forceRefresh: force });
        setPaymentRequests(rows);
      } else if (t === "finance-summary") {
        const data = await fetchCachedJson<FinanceSummary>(
          `${API_BASE}/reports/finance-summary?period=${financePeriod}&group_by=${financeGroupBy}`,
          undefined,
          { ttlMs: 600_000, cacheKey: `reports:finance-summary-v4:${financePeriod}:${financeGroupBy}`, forceRefresh: force }
        );
        setFinanceSummary(data);
      } else if (t === "daily-profit") {
        const url = dailyDate
          ? `${API_BASE}/reports/daily-profit?report_date=${dailyDate}`
          : `${API_BASE}/reports/daily-profit`;
        const data = await fetchCachedJson<DailyProfit>(url, undefined, { ttlMs: 600_000, cacheKey: `reports:daily-profit-v4:${dailyDate || "latest"}`, forceRefresh: force });
        setDailyProfit(data);
      } else if (t === "income-statement") {
        const data = await fetchCachedJson<IncomeStatement>(`${API_BASE}/reports/income-statement`, undefined, { ttlMs: 600_000, cacheKey: "reports:income-statement", forceRefresh: force });
        setIncomeStatement(data);
      } else if (t === "whatsapp-reports") {
        let prs = paymentRequests;
        if (!prs.length || force) {
            prs = await fetchCachedJson<PaymentRequest[]>(`${API_BASE}/reports/payment-requests`, undefined, { ttlMs: 600_000, cacheKey: PAYMENT_REQUESTS_CACHE_KEY, forceRefresh: force });
            setPaymentRequests(prs);
        }
        
        let idsToFetch = selectedPrIds;
        // Auto-select today's pending if nothing is selected yet and not initialized
        if (selectedPrIds.length === 0 && !window.sessionStorage.getItem('whatsapp-initialized')) {
            const todayStr = new Date().toISOString().split("T")[0];
            idsToFetch = prs
                .filter(p => (p.date || "").startsWith(todayStr) && p.state === "draft")
                .map(p => String(p.id));
            if (idsToFetch.length > 0) {
               setSelectedPrIds(idsToFetch);
            }
            window.sessionStorage.setItem('whatsapp-initialized', 'true');
        }

        const url = `${API_BASE}/reports/whatsapp-summary?format=${whatsappFormat}` + 
                    (idsToFetch.length > 0 ? `&pr_ids=${idsToFetch.join(",")}` : "&pr_ids=none");
        const data = await fetchCachedJson<WhatsappSummary>(url, undefined, { ttlMs: 600_000, cacheKey: `reports:whatsapp-summary:${whatsappFormat}:${idsToFetch.join("-") || "none"}`, forceRefresh: force });
        setWhatsappSummary(data);
        // Also preload daily profit for the spreadsheet button
        if (!dailyProfit) {
            const dp = await fetchCachedJson<DailyProfit>(`${API_BASE}/reports/daily-profit`, undefined, { ttlMs: 600_000, cacheKey: "reports:daily-profit-v4:latest" });
            setDailyProfit(dp);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [
    tab,
    financePeriod,
    financeGroupBy,
    dailyDate,
    whatsappFormat,
    selectedPrIds,
    paymentRequests,
    locationRows.length,
    locationSummary,
    financeSummary,
    dailyProfit,
    incomeStatement,
  ]);

  useEffect(() => {
    // Auth guard
    fetchJson(`${API_BASE}/auth/me`).catch(() => router.push("/login"));
  }, [router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      load(tab);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [tab]);

  useEffect(() => {
    if (tab !== "finance-summary") return;
    setFinanceSummary(null);
    const timeout = window.setTimeout(() => {
      load("finance-summary", true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [financeGroupBy, financePeriod, tab]);

  useEffect(() => {
    if (tab !== "daily-profit") return;
    setDailyProfit(null);
    const timeout = window.setTimeout(() => {
      load("daily-profit", true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [dailyDate, tab]);

  useEffect(() => {
    const preloadTabs: Tab[] = [
      "location-summary",
      "finance-summary",
      "daily-profit",
      "income-statement",
    ];
    const timeout = window.setTimeout(() => {
      preloadTabs
        .filter((nextTab) => nextTab !== tab)
        .forEach((nextTab) => void load(nextTab, false, true));
    }, 700);
    return () => window.clearTimeout(timeout);
  }, []);

  // Auto-select all draft payment requests when WhatsApp tab is open
  useEffect(() => {
    if (tab === "whatsapp-reports" && paymentRequests.length > 0) {
      const draftIds = paymentRequests
        .filter(pr => (pr.total_amount || 0) > 0 && pr.state === "draft")
        .map(pr => String(pr.id));

      if (draftIds.length > 0 && selectedPrIds.length === 0) {
        queueMicrotask(() => setSelectedPrIds(draftIds));
      }
    }
  }, [tab, paymentRequests, selectedPrIds.length]);

  const handleTabChange = (t: Tab) => {
    setTab(t);
    setFilterText("");
  };

  const handleNewRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewRequestSubmitting(true);
    setNewRequestError("");
    setNewRequestSuccess("");
    const validLines = newRequestLines.filter(l => l.item.trim() || l.description.trim() || l.amount > 0);
    try {
      if (editingPrId) {
        await fetchJson(`${API_BASE}/reports/payment-request/${editingPrId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newRequestName,
            trip_reference: newRequestTripRef,
            vehicle_plate: newRequestVehicle,
            supervisor_name: newRequestSupervisor,
            line_items: validLines,
          }),
        } as RequestInit);
        setNewRequestSuccess("Payment request updated successfully.");
      } else {
        await fetchJson(`${API_BASE}/reports/payment-request`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newRequestName,
            trip_reference: newRequestTripRef,
            vehicle_plate: newRequestVehicle,
            supervisor_name: newRequestSupervisor,
            line_items: validLines,
          }),
        } as RequestInit);
        setNewRequestSuccess("Payment request submitted successfully.");
      }
      setNewRequestTripRef("");
      setNewRequestName("");
      setNewRequestVehicle("");
      setNewRequestSupervisor("");
      setNewRequestLines([{ item: "", description: "", amount: 0, quantity: 1 }]);
      setEditingPrId(null);
    } catch (err: unknown) {
      setNewRequestError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setNewRequestSubmitting(false);
    }
  };

  const startEditPaymentRequest = (pr: PaymentRequest) => {
    const lines = requestLines(pr).map((line) => ({
      item: paymentItemName(line.item, line.description),
      description: line.description || "",
      amount: Number(line.amount || line.total || pr.total_amount || 0),
      quantity: Number(line.quantity || 1),
    }));
    setEditingPrId(String(pr.id));
    setNewRequestName(pr.name || pr.reference || "");
    setNewRequestVehicle(pr.vehicle_plate || "");
    setNewRequestSupervisor(pr.supervisor_name || pr.requester_name || "");
    setNewRequestTripRef(pr.trip_reference || paymentRouteName(pr));
    setNewRequestLines(lines.length ? lines : [{ item: "", description: "", amount: 0, quantity: 1 }]);
    setNewRequestError("");
    setNewRequestSuccess("");
    setTab("new-request");
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  };

  const filterRows = <T extends Record<string, unknown>>(rows: T[]): T[] => {
    const locationFilterActive = selectedLocation !== "all" && (tab === "current-location" || tab === "location-summary");
    let nextRows = rows;
    if (locationFilterActive) {
      nextRows = nextRows.filter((row) => {
        const rowLocation = String(row.current_location_name || row.location_name || "Unknown").trim() || "Unknown";
        return rowLocation === selectedLocation;
      });
    }
    if (!filterText) return nextRows;
    const q = filterText.toLowerCase();
    return nextRows.filter((r) =>
      Object.values(r).join(" ").toLowerCase().includes(q)
    );
  };

  const availableLocations = useMemo(() => {
    const names = new Set<string>();
    locationRows.forEach((row) => {
      const name = String(row.current_location_name || "Unknown").trim() || "Unknown";
      names.add(name);
    });
    locationSummary?.locations?.forEach((group) => {
      const name = String(group.location_name || "Unknown").trim() || "Unknown";
      names.add(name);
    });
    return Array.from(names).sort((a, b) => {
      const aUnknown = a.toLowerCase() === "unknown";
      const bUnknown = b.toLowerCase() === "unknown";
      if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
      return a.localeCompare(b);
    });
  }, [locationRows, locationSummary]);

  const compactGpsNote = (value?: string | null) => {
    const note = String(value || "").trim();
    if (!note) return <span className="muted">–</span>;
    const words = note.split(/\s+/);
    if (words.length <= 2 && note.length <= 24) return <span>{note}</span>;
    return (
      <details className="gps-note-compact">
        <summary>{words.slice(0, 2).join(" ")}...</summary>
        <div>{note}</div>
      </details>
    );
  };

  const exportCurrentLocations = async () => {
    const rows = filterRows(locationRows as unknown as Record<string, unknown>[]) as unknown as LocationRow[];
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Current Location");

    sheet.mergeCells("A1:J1");
    const titleCell = sheet.getCell("A1");
    titleCell.value = "Current Vehicle Locations Report";
    titleCell.font = { name: "Times New Roman", size: 14, italic: true, bold: true };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };

    sheet.mergeCells("A2:J2");
    const dateCell = sheet.getCell("A2");
    dateCell.value = `Generated - ${new Date().toISOString().slice(0, 10)}`;
    dateCell.font = { name: "Times New Roman", size: 11, italic: true };
    dateCell.alignment = { horizontal: "center", vertical: "middle" };

    const headers = ["No", "Vehicle", "Supervisor", "Driver", "Departure", "Destination", "Current Location", "DB Note", "State", "Days"];
    const headerRow = sheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { name: "Times New Roman", size: 11, italic: true, bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { top: {style:"thin"}, left: {style:"thin"}, bottom: {style:"thin"}, right: {style:"thin"} };
    });
    headerRow.height = 30;

    rows.forEach((row, index) => {
      const dataRow = sheet.addRow([
        index + 1,
        row.vehicle_plate || "N/A",
        row.supervisor_name || "Unassigned",
        row.driver_name || "Unassigned",
        row.departure_name || "",
        row.destination_name || "",
        row.current_location_name || "",
        row.current_location_note || "",
        stateLabel(row.state),
        row.current_location_days ?? 0,
      ]);
      dataRow.eachCell((cell, colNumber) => {
        cell.font = { name: "Times New Roman", size: 11 };
        cell.border = { top: {style:"thin"}, left: {style:"thin"}, bottom: {style:"thin"}, right: {style:"thin"} };
        cell.alignment = colNumber === 1 || colNumber === 10
          ? { horizontal: "center", vertical: "middle" }
          : { horizontal: "left", vertical: "middle", wrapText: true };
      });
    });

    sheet.columns = [
      { width: 6 },
      { width: 16 },
      { width: 24 },
      { width: 20 },
      { width: 22 },
      { width: 24 },
      { width: 32 },
      { width: 32 },
      { width: 14 },
      { width: 8 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Current_Location_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportLocationSummary = async () => {
    if (!locationSummary) return;

    const groups = filterRows(locationSummary.locations as unknown as Record<string, unknown>[]) as unknown as LocationSummaryGroup[];
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Location Summary");

    sheet.mergeCells("A1:I1");
    const titleCell = sheet.getCell("A1");
    titleCell.value = "Current Location Summary Report";
    titleCell.font = { name: "Times New Roman", size: 14, italic: true, bold: true };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };

    sheet.mergeCells("A2:I2");
    const dateCell = sheet.getCell("A2");
    dateCell.value = `Generated - ${new Date().toISOString().slice(0, 10)}`;
    dateCell.font = { name: "Times New Roman", size: 11, italic: true };
    dateCell.alignment = { horizontal: "center", vertical: "middle" };

    sheet.mergeCells("A3:I3");
    const totalCell = sheet.getCell("A3");
    totalCell.value = `Total Locations: ${groups.length}   Total Vehicles: ${groups.reduce((sum, group) => sum + Number(group.vehicle_count || 0), 0)}`;
    totalCell.font = { name: "Times New Roman", size: 11, italic: true, bold: true };
    totalCell.alignment = { horizontal: "center", vertical: "middle" };

    const headers = ["No", "Location", "Vehicle", "Supervisor", "Driver", "Destination", "DB Note", "State", "Days"];
    const headerRow = sheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { name: "Times New Roman", size: 11, italic: true, bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { top: {style:"thin"}, left: {style:"thin"}, bottom: {style:"thin"}, right: {style:"thin"} };
    });
    headerRow.height = 30;

    let rowNumber = 1;
    groups.forEach((group) => {
      const groupRow = sheet.addRow([
        "",
        `${group.location_name || "Unknown"} (${group.vehicle_count || 0} vehicle${Number(group.vehicle_count || 0) === 1 ? "" : "s"})`,
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
      sheet.mergeCells(groupRow.number, 2, groupRow.number, 9);
      groupRow.eachCell((cell) => {
        cell.font = { name: "Times New Roman", size: 11, italic: true, bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
        cell.border = { top: {style:"thin"}, left: {style:"thin"}, bottom: {style:"thin"}, right: {style:"thin"} };
      });

      group.vehicles.forEach((vehicle) => {
        const dataRow = sheet.addRow([
          rowNumber,
          group.location_name || "Unknown",
          vehicle.vehicle_plate || "N/A",
          vehicle.supervisor_name || "Unassigned",
          vehicle.driver_name || "Unassigned",
          vehicle.destination_name || "",
          vehicle.current_location_note || "",
          stateLabel(vehicle.state),
          vehicle.current_location_days ?? vehicle.days ?? 0,
        ]);
        dataRow.eachCell((cell, colNumber) => {
          cell.font = { name: "Times New Roman", size: 11 };
          cell.border = { top: {style:"thin"}, left: {style:"thin"}, bottom: {style:"thin"}, right: {style:"thin"} };
          cell.alignment = colNumber === 1 || colNumber === 9
            ? { horizontal: "center", vertical: "middle" }
            : { horizontal: "left", vertical: "middle", wrapText: true };
        });
        rowNumber += 1;
      });
    });

    sheet.columns = [
      { width: 6 },
      { width: 24 },
      { width: 16 },
      { width: 24 },
      { width: 20 },
      { width: 22 },
      { width: 32 },
      { width: 14 },
      { width: 8 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Location_Summary_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="app-shell">
      <div className={`overlay${mobileSidebarOpen ? " open" : ""}`} onClick={() => setMobileSidebarOpen(false)}></div>
      <Sidebar 
        currentView={"reports" as SidebarView}
        onViewChange={(v) => {
          if (v === "overview") { window.location.href = "/"; }
          else if (v === "reports") { window.location.href = "/reports"; }
          else if (v === "finance") { window.location.href = "/finance"; }
          else if (v === "payments") { window.location.href = "/payments"; }
          else if (v === "map") { window.location.href = "/map"; }
          else { window.location.href = `/?view=${v}`; }
        }} 
        mobileOpen={mobileSidebarOpen} 
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />
      <div className="app-main" style={{ display: "flex", flexDirection: "column", height: "100vh", overflowY: "hidden" }}>
        
        {/* Topbar */}
        <header className="fleet-topbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="btn md-hidden" onClick={() => setMobileSidebarOpen(true)} aria-label="Open menu">
              <Menu size={18} />
            </button>
            <img src="/top-logo-full.jpg" alt="TOP Fleet" style={{ width: 40, height: 40, borderRadius: 8, display: "none" }} />
            <div>
              <div style={{ fontWeight: 900, fontSize: 20 }}>Reports</div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>Fleet financial and location reports</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <BackButton />
          <button className="btn" onClick={() => load(tab, true)}><RefreshCw size={16} /> Refresh</button>
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
      {tab !== "payment-requests" && tab !== "new-request" && tab !== "whatsapp-reports" && (
        <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line)", background: "var(--panel)", display: "flex", gap: 10, alignItems: "center" }}>
          <input
            className="fleet-input"
            placeholder="Filter rows…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={{ maxWidth: 320, minHeight: 36 }}
          />
          {(tab === "current-location" || tab === "location-summary") && (
            <select
              className="fleet-input"
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              style={{ width: "auto", minHeight: 36, minWidth: 220 }}
            >
              <option value="all">All locations</option>
              {availableLocations.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}
          {tab === "daily-profit" && (
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="fleet-input"
                type="date"
                style={{ minHeight: 36, width: "auto" }}
                value={dailyDate}
                onChange={(e) => setDailyDate(e.target.value)}
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
          {tab === "current-location" && (
            <button
              className="fleet-btn fleet-btn-primary"
              onClick={exportCurrentLocations}
              disabled={!locationRows.length}
              style={{ padding: "0 16px", minHeight: 36 }}
            >
              Export XLSX
            </button>
          )}
          {tab === "location-summary" && (
            <button
              className="fleet-btn fleet-btn-primary"
              onClick={exportLocationSummary}
              disabled={!locationSummary?.locations?.length}
              style={{ padding: "0 16px", minHeight: 36 }}
            >
              Export XLSX
            </button>
          )}
          {loading && <span className="muted" style={{ fontSize: 13 }}>Loading…</span>}
        </div>
      )}

      {/* Content */}
      <div className="fleet-page" style={{ flex: 1, overflowY: "auto", paddingBottom: 40 }}>

        {/* ── Current Location ── */}
        {tab === "current-location" && (
          <div className="panel">
            <div className="panel-header"><div className="panel-title">DB Current Locations</div></div>
            <div className="report-location-table-scroll">
              <table className="fleet-table">
                <thead>
                  <tr>
                    {["Vehicle", "Supervisor", "Driver", "Departure", "Destination", "Current Location", "DB Note", "Dep. Date", "State", "Days"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filterRows(locationRows as unknown as Record<string, unknown>[]).length === 0 ? (
                    <tr><td colSpan={10} className="empty">No records.</td></tr>
                  ) : (
                    (filterRows(locationRows as unknown as Record<string, unknown>[]) as unknown as LocationRow[]).map((r, i) => (
                      <tr key={i}>
                        <td>{r.vehicle_plate || "N/A"}</td>
                        <td>{r.supervisor_name || "Unassigned"}</td>
                        <td>{r.driver_name || "Unassigned"}</td>
                        <td>{r.departure_name || "–"}</td>
                        <td>{r.destination_name || "–"}</td>
                        <td>{r.current_location_name || "–"}</td>
                        <td className="gps-note-cell">{compactGpsNote(r.current_location_note)}</td>
                        <td className="location-date-cell">{r.departure_date || "–"}</td>
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
                  <table className="fleet-table" style={{ fontStyle: 'normal' }}>
                    <thead>
                      <tr>{["Vehicle", "Supervisor", "Driver", "Destination", "DB Note", "Dep. Date", "State", "Days"].map((h) => <th key={h}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {loc.vehicles.map((v, i) => (
                        <tr key={i}>
                          <td>{v.vehicle_plate || "N/A"}</td>
                          <td>{v.supervisor_name || "Unassigned"}</td>
                          <td>{v.driver_name || "Unassigned"}</td>
                          <td>{v.destination_name || "–"}</td>
                          <td className="gps-note-cell">{compactGpsNote(v.current_location_note)}</td>
                          <td className="location-date-cell">{v.departure_date || "–"}</td>
                          <td><span className={`pill ${normalizeState(v.state)}`}>{stateLabel(v.state)}</span></td>
                          <td>{v.current_location_days ?? v.days ?? 0}</td>
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
          <div className="panel report-payment-panel">
            <div className="panel-header report-payment-header">
              <div className="payment-page-hero">
                <div className="panel-title">Payment Requests</div>
              </div>
              <div className="payment-summary-strip">
                <div className="payment-summary-chip">
                  <span>Visible</span>
                  <strong>{paymentRequestStats.count}</strong>
                </div>
                <div className="payment-summary-chip">
                  <span>Total</span>
                  <strong>{money(paymentRequestStats.total)}</strong>
                </div>
                <div className="payment-summary-chip">
                  <span>Date</span>
                  <strong>{paymentRequestStats.date}</strong>
                </div>
              </div>
            </div>
            <div className="payment-toolbar">
              <div className="payment-toolbar-filters">
                <select
                  className="fleet-input"
                  value={paymentFilterState}
                  onChange={(e) => setPaymentFilterState(e.target.value)}
                  style={{ minHeight: 34 }}
                >
                  <option value="all">All States</option>
                  <option value="draft">Draft</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="approved">Approved</option>
                  <option value="paid">Paid</option>
                </select>
                <input
                  className="fleet-input"
                  type="date"
                  value={paymentFilterDate}
                  onChange={(e) => setPaymentFilterDate(e.target.value || todayIsoDate())}
                  aria-label="Filter payment requests by day"
                  style={{ minHeight: 34 }}
                />
                {paymentFilterDate !== todayIsoDate() && (
                  <button className="fleet-btn" onClick={() => setPaymentFilterDate(todayIsoDate())}>Today</button>
                )}
              </div>
              <div className="payment-toolbar-actions">
                <button className="fleet-btn fleet-btn-primary" onClick={exportDailySupervisorPaymentRequests}>
                  Daily Supervisor XLSX
                </button>
              </div>
            </div>
            <div className="payment-subtabs" role="tablist" aria-label="Payment request views">
              <button
                className={`payment-subtab${paymentSubtab === "all" ? " active" : ""}`}
                onClick={() => setPaymentSubtab("all")}
                type="button"
              >
                All Requests
              </button>
              <button
                className={`payment-subtab${paymentSubtab === "daily-supervisor" ? " active" : ""}`}
                onClick={() => setPaymentSubtab("daily-supervisor")}
                type="button"
              >
                Daily Supervisor
              </button>
              <button
                className={`payment-subtab${paymentSubtab === "pscn" ? " active" : ""}`}
                onClick={() => setPaymentSubtab("pscn")}
                type="button"
              >
                PSCN
              </button>
            </div>
            {paymentSubtab === "all" && (
            <div className="payment-preview-panel payment-table-section">
              <div className="payment-preview-head">
                <div className="panel-title">All Requests</div>
                <input
                  className="fleet-input payment-row-search"
                  placeholder="Search rows..."
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                  aria-label="Search payment request rows"
                />
              </div>
            <div className="report-table-wrap payment-table-wrap">
              <table className="fleet-table" id="payment-requests-table">
                <thead>
	                  <tr>{["Request", "Vehicle / Trip", "Items", "Date", "Supervisor", "State", "Total"].map((h) => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {filteredPaymentRequests.length === 0 ? (
                    <tr>
	                      <td colSpan={7} className="empty">
                        <div className="payment-empty-state">
                          <strong>No payment requests found.</strong>
                          <span>Today has no matching live Odoo payment requests yet.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredPaymentRequests.map((pr) => {
                      const lines = requestLines(pr);
                      const isExpanded = expandedPaymentIds.includes(String(pr.id));
                      return (
                      <Fragment key={pr.id}>
                        <tr
                          key={pr.id}
                          className={`payment-clickable-row${isExpanded ? " expanded active-row" : ""}` }
                          onClick={() => togglePaymentExpanded(pr.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              togglePaymentExpanded(pr.id);
                            }
                          }}
                          tabIndex={0}
                          aria-expanded={isExpanded}
                        >
                          <td data-label="Request" className="payment-request-cell" style={{ minWidth: 220 }}>
                            <div className="payment-request-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <button
                                className="payment-row-toggle"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  togglePaymentExpanded(pr.id);
                                }}
                                aria-label={isExpanded ? "Hide payment items" : "Show payment items"}
                              >
                                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </button>
                              <strong style={{ wordBreak: 'break-word' }}>{pr.name || `Request #${pr.id}`}</strong>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                              #{String(pr.id)} {pr.requester_name ? `• ${pr.requester_name}` : ''}
                            </div>
                          </td>
                          <td data-label="Vehicle / Trip" className="payment-request-cell">
                            <strong>{pr.vehicle_plate || "No vehicle"}</strong>
                            <span>{paymentRouteName(pr)}</span>
                          </td>
	                          <td data-label="Items" className="payment-items-cell">
	                            <div className="payment-items-list">
	                              <strong>{lines.length} item{lines.length === 1 ? "" : "s"}</strong>
	                            </div>
	                          </td>
                          <td data-label="Date" className="payment-request-cell">
                            <strong>{pr.date || "–"}</strong>
                            {pr.approved_on && <span>Approved {pr.approved_on}</span>}
                          </td>
                          <td data-label="Supervisor">{pr.supervisor_name || "–"}</td>
                          <td data-label="State" onClick={(event) => event.stopPropagation()}>
                            <select
                              className="fleet-input payment-state-select"
                              value={pr.state || "draft"}
                              disabled={paymentStatusUpdating === String(pr.id)}
                              onChange={(event) => void updatePaymentStatus(pr, event.target.value)}
                              aria-label={`Update payment status for ${pr.name || pr.id}`}
                            >
                              {["draft", "confirmed", "approved", "paid", "posted", "done", "cancelled"].map((state) => (
                                <option key={state} value={state}>{stateLabel(state)}</option>
                              ))}
                            </select>
                          </td>
                          <td data-label="Total" className="green">{money(pr.total_amount)}</td>
	                        </tr>
	                        {isExpanded && (
	                          <tr key={`${pr.id}-expanded`} className="payment-expanded-row">
                            <td colSpan={7}>
                              <div className="payment-expanded">
                                <div className="payment-expanded-head">
                                  <button
                                    type="button"
                                    className="fleet-btn"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      startEditPaymentRequest(pr);
                                    }}
                                  >
                                    <Pencil size={14} /> Edit
                                  </button>
                                </div>
                                <div className="payment-expanded-summary">
                                  <div>
                                    <span className="muted">Route</span>
                                    <strong>{paymentRouteName(pr)}</strong>
                                  </div>
                                  <div>
                                    <span className="muted">Vehicle</span>
                                    <strong>{pr.vehicle_plate || "No vehicle"}</strong>
                                  </div>
                                  <div>
                                    <span className="muted">Supervisor</span>
                                    <strong>{pr.supervisor_name || "Unassigned"}</strong>
                                  </div>
                                  <div>
                                    <span className="muted">Requester</span>
                                    <strong>{pr.requester_name || "–"}</strong>
                                  </div>
                                </div>
                                <div className="payment-timeline">
                                  <div><span>Requested</span><strong>{pr.date || "–"}</strong></div>
                                  <div><span>Approved</span><strong>{pr.approved_on || "Pending"}</strong></div>
                                  <div><span>Status</span><strong>{stateLabel(pr.state || "draft")}</strong></div>
                                  <div><span>Total</span><strong>{money(pr.total_amount)}</strong></div>
                                </div>
                                <div className="report-table-wrap">
                                  <div className="payment-expanded-title">Payment request item list</div>
                                  <table className="fleet-table payment-expanded-items">
                                    <thead>
	                                      <tr>{["Item", "Qty", "Asked Price", "Line Total"].map((h) => <th key={h}>{h}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                      {lines.map((line, index) => (
                                        <tr key={`${pr.id}-expanded-line-${index}`}>
	                                          <td data-label="Item">{paymentItemName(line.item, line.description)}</td>
	                                          <td data-label="Qty">{line.quantity || 1}</td>
	                                          <td data-label="Asked Price">{money(line.amount || 0)}</td>
	                                          <td data-label="Line Total" className="green">{money(line.total ?? ((line.amount || 0) * (line.quantity || 1)))}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            </div>
            )}
            {paymentSubtab === "daily-supervisor" && (
            <div className="payment-preview-panel">
              <div className="payment-preview-head">
                <div>
                  <div className="panel-title">Daily Supervisor Payment Requests</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                    {dailySupervisorRows.length} lines · Total {money(dailySupervisorTotal)} · {paymentFilterDate || todayIsoDate()}
                  </div>
                </div>
                <input
                  className="fleet-input payment-row-search"
                  placeholder="Search rows..."
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                  aria-label="Search daily supervisor rows"
                />
              </div>
              <div className="daily-supervisor-report-sheet">
                <div className="daily-supervisor-report-title">Daily Supervisor Payment Requests</div>
                <div className="daily-supervisor-report-date">Date - {paymentFilterDate || todayIsoDate()}</div>
                <table className="fleet-table daily-supervisor-preview-table daily-report-preview-table" style={{ fontStyle: 'normal' }}>
                  <thead>
                    <tr>
                      {["No", "Supervisor", "Plate number", "Route", "Item / Asked For", "Qty", "Asked Price", "Line Total", "REMARK"].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dailySupervisorRows.length === 0 ? (
                      <tr><td colSpan={9} className="empty">No preview rows for this filter.</td></tr>
                    ) : (
                      dailySupervisorRows.slice(0, 80).map((row, index) => (
                        <tr key={`${row.requestId}-${index}`}>
                          <td>{index + 1}</td>
                          <td>{row.supervisor || "Unassigned"}</td>
                          <td>{row.vehicle || "–"}</td>
                          <td>{row.route || "–"}</td>
                          <td>{row.item || row.description || "–"}</td>
                          <td>{row.quantity}</td>
                          <td>{money(row.amount)}</td>
                          <td className="green">{money(row.lineTotal)}</td>
                          <td>{row.state || "draft"} / Request {String(row.requestId)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {dailySupervisorRows.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={7}></td>
                        <td className="daily-report-total-label">Total</td>
                        <td className="daily-report-total-value">{money(dailySupervisorTotal)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {dailySupervisorRows.length > 80 && (
                <div className="muted" style={{ fontSize: 12, paddingTop: 8 }}>
                  Showing first 80 preview rows. Daily Supervisor XLSX includes all {dailySupervisorRows.length} rows.
                </div>
              )}
            </div>
            )}
            {paymentSubtab === "pscn" && (
            <div className="payment-preview-panel">
              <div className="payment-preview-head">
                <div>
                  <div className="panel-title">PSCN - Payment Status with Customer Name</div>
                </div>
              </div>
              <div className="pscn-kpi-strip">
                <div><strong>{pscnKpis.customers}</strong><span>Customers</span></div>
                <div><strong>{pscnKpis.trips}</strong><span>Order trips</span></div>
                <div><strong>{money(pscnKpis.requestAmount)}</strong><span>Request total</span></div>
                <div><strong className="green">{pscnKpis.paidCount}</strong><span>Paid</span></div>
                <div><strong className="amber">{pscnKpis.partialCount}</strong><span>Partial</span></div>
                <div><strong className="red">{pscnKpis.pendingCount}</strong><span>Pending</span></div>
                <div><strong className="red">{money(pscnKpis.pendingAmount)}</strong><span>Pending ETB</span></div>
              </div>
              <div className="payment-table-toolbar centered">
                <input
                  className="fleet-input payment-row-search"
                  placeholder="Search rows..."
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                  aria-label="Search PSCN rows"
                />
              </div>
              <div className="report-table-wrap payment-table-wrap">
                <table className="fleet-table" id="payment-status-customer-table">
                  <thead>
                    <tr>
                      {["Customer", "Payment Status", "Paid", "Pending", "Request Total", "Customer Order Trip", "Supervisor"].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pscnFilteredRows.length === 0 ? (
                      <tr><td colSpan={7} className="empty">No customer payment status rows for this filter.</td></tr>
                    ) : (
                      pscnFilteredRows.map((row) => (
                        <tr key={`${row.requestId}-${row.customerId}`}>
                          <td>
                            <strong>{row.customer}</strong>
                            <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>Customer {String(row.customerId)}</div>
                          </td>
                          <td>
                            <span className={`pill ${normalizeState(row.status)}`}>{row.status}</span>
                            <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
                              Request {stateLabel(row.requestState)}
                            </div>
                          </td>
                          <td className="green">{money(row.customerPaid)}</td>
                          <td className={row.customerPending > 0 ? "amber" : "green"}>{money(row.customerPending)}</td>
                          <td className="green">{money(row.requestTotal)}</td>
                          <td>
                            <strong>{row.vehicle}</strong>
                            <div className="muted" style={{ fontSize: 12 }}>{row.trip}</div>
                            <div className="muted" style={{ fontSize: 11 }}>{row.requestName} · {row.date} · #{String(row.requestId)}</div>
                          </td>
                          <td>{row.supervisor}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            )}
          </div>
        )}

        {/* ── Daily Profit ── */}
        {tab === "daily-profit" && dailyProfit && (
          <div style={{ display: "grid", gap: 16 }}>
            {dailyProfit._warning && <div className="login-error">{dailyProfit._warning}</div>}
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
              Profit is customer receivable minus trip cost. Cost is counted once. Waiting means the receivable is not posted yet, so it is not a loss.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 12 }}>
              <div className="card"><div className="card-label">Report Date</div><div className="card-value">{dailyProfit.report_date || "No financial date"}</div></div>
              <div className="card"><div className="card-label">Vehicles</div><div className="card-value">{dailyProfit.totals.vehicle_count}</div></div>
              <div className="card"><div className="card-label">Posted Revenue</div><div className="card-value green">{money(dailyProfit.totals.revenue_total)}</div></div>
              <div className="card"><div className="card-label">Cost</div><div className="card-value">{money(dailyProfit.totals.cost_total)}</div></div>
              <div className="card"><div className="card-label">Posted Profit</div><div className={`card-value ${dailyProfit.totals.net_profit_total >= 0 ? "green" : "red"}`}>{money(dailyProfit.totals.net_profit_total)}</div></div>
              <div className="card"><div className="card-label">Waiting Receivable</div><div className="card-value">{money(dailyProfit.totals.pending_cost_total || 0)}</div></div>
            </div>
            <div className="panel">
              <div className="panel-header"><div className="panel-title">Daily Vehicle Profit</div></div>
              <div style={{ padding: "16px 24px 0", fontStyle: "italic", fontWeight: "bold" }}>
                Date - {dailyProfit.report_date || "No financial date"}
              </div>
              <div style={{ overflowX: "auto", padding: "16px 24px 24px" }}>
                <table className="fleet-table" style={{ border: "1px solid var(--border)", borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                  <thead>
                    <tr>
                      {["No", "Driver", "Plate", "Route", "Revenue", "Cost", "Result"].map((h) => (
                        <th key={h} style={{ border: "1px solid var(--border)", padding: "8px 12px", fontStyle: "italic", fontWeight: "normal", textAlign: "center", backgroundColor: "transparent" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(filterRows(dailyProfit.rows as unknown as Record<string, unknown>[]) as unknown as typeof dailyProfit.rows).length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          style={{
                            border: "1px solid var(--border)",
                            padding: "18px 12px",
                            textAlign: "center",
                            fontStyle: "italic",
                            color: "var(--muted)",
                          }}
                        >
                          No revenue or expense rows found for this date.
                        </td>
                      </tr>
                    ) : (filterRows(dailyProfit.rows as unknown as Record<string, unknown>[]) as unknown as typeof dailyProfit.rows).map((r) => (
                      <tr key={r.no}>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px", textAlign: "center", fontStyle: "italic" }}>{r.no}</td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px" }}>{r.driver_name}</td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px" }}>{r.plate_number}</td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px", fontStyle: "italic" }}>{r.remarks}</td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px", textAlign: "right" }}>{r.receivable_posted ? money(r.actual_daily_total_revenue) : "—"}</td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px", textAlign: "right" }}>{r.daily_total_cost ? money(r.daily_total_cost) : "—"}</td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 12px", textAlign: "right", fontStyle: "italic" }} className={r.receivable_posted ? (r.actual_net_profit >= 0 ? "green" : "red") : ""}>
                          {r.receivable_posted ? money(r.actual_net_profit) : "Waiting"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {dailyProfit.rows.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={7} style={{ border: "1px solid var(--border)", padding: "8px 12px", backgroundColor: "#7fe57f", color: "#000", fontWeight: "bold", textAlign: "left", fontStyle: "italic" }}>
                          Posted profit {money(dailyProfit.totals.net_profit_total)}
                          {(dailyProfit.totals.pending_cost_total || 0) > 0 ? ` · Waiting for receivable ${money(dailyProfit.totals.pending_cost_total || 0)}` : ""}
                        </td>
                      </tr>
                    </tfoot>
                  )}
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
              <div className="muted" style={{ padding: "12px 24px 0", fontSize: 13 }}>
                Confirmed receivables against approved payment requests. This is the books view, not the daily trip sheet.
              </div>
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
              <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="panel-title">Current Location Report</div>
                <button 
                  className="fleet-btn fleet-btn-primary" 
                  onClick={() => void copyWithButtonFeedback(whatsappSummary?.current_location_text || "", "copy-loc-btn", "Copy to WhatsApp")}
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

          </div>
        )}

        {/* ── New Request form ── */}
        {tab === "new-request" && (
          <div className="new-request-shell">
            <div className="panel">
              <div className="panel-header"><div className="panel-title">{editingPrId ? `Edit Payment Request #${editingPrId}` : "New Payment Request"}</div></div>
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
                    <label className="login-label" htmlFor="req-supervisor">Assigned Supervisor</label>
                    <input id="req-supervisor" className="fleet-input" value={newRequestSupervisor} onChange={(e) => setNewRequestSupervisor(e.target.value)} placeholder="Supervisor name" />
                  </div>
                  <div>
                    <label className="login-label" htmlFor="req-trip-ref">Trip Reference (Source Doc) *</label>
                    <input id="req-trip-ref" className="fleet-input" required value={newRequestTripRef} onChange={(e) => setNewRequestTripRef(e.target.value)} placeholder="e.g. Dire Dawa Trip" />
                  </div>
                  <div>
                    <label className="login-label">Expense Lines</label>
                    <div className="new-request-lines">
                      {newRequestLines.map((line, idx) => (
                        <div key={idx} className="payment-line-grid">
                          <input className="fleet-input" placeholder="Item (e.g. Fuel)" value={line.item} onChange={(e) => {
                            const newLines = [...newRequestLines];
                            newLines[idx].item = e.target.value;
                            setNewRequestLines(newLines);
                          }} />
                          <input className="fleet-input" placeholder="Description" value={line.description} onChange={(e) => {
                            const newLines = [...newRequestLines];
                            newLines[idx].description = e.target.value;
                            setNewRequestLines(newLines);
                          }} />
                          <input className="fleet-input" type="number" placeholder="Qty" min="1" value={line.quantity || 1} onChange={(e) => {
                            const newLines = [...newRequestLines];
                            newLines[idx].quantity = parseFloat(e.target.value) || 0;
                            setNewRequestLines(newLines);
                          }} />
                          <input className="fleet-input" type="number" placeholder="Amount" value={line.amount || 0} onChange={(e) => {
                            const newLines = [...newRequestLines];
                            newLines[idx].amount = parseFloat(e.target.value) || 0;
                            setNewRequestLines(newLines);
                          }} />
                          <div className="payment-line-total">
                            {((line.amount || 0) * (line.quantity || 1)).toLocaleString()}
                          </div>
                          {newRequestLines.length > 1 && (
                            <button type="button" onClick={() => setNewRequestLines(newRequestLines.filter((_, i) => i !== idx))} style={{ color: "var(--red)", background: "none", border: "none", cursor: "pointer", padding: 4 }}>×</button>
                          )}
                        </div>
                      ))}
                      <button type="button" className="payment-add-line" onClick={() => setNewRequestLines([...newRequestLines, { item: "", description: "", amount: 0, quantity: 1 }])}>
                        <Plus size={14} /> Add Line Item
                      </button>
                    </div>
                  </div>
                  <div className="new-request-footer">
                    <div style={{ fontWeight: "bold", fontSize: 16 }}>
                      Total: {newRequestLines.reduce((acc, l) => acc + ((l.amount || 0) * (l.quantity || 1)), 0).toLocaleString()} Birr
                    </div>
                    <div style={{ display: "flex", gap: 12 }}>
                      {editingPrId && (
                        <button type="button" className="fleet-btn fleet-btn-secondary" onClick={() => {
                          setEditingPrId(null);
                          setNewRequestTripRef("");
                          setNewRequestName("");
                          setNewRequestVehicle("");
                          setNewRequestSupervisor("");
                          setNewRequestLines([{ item: "", description: "", amount: 0, quantity: 1 }]);
                          setTab("payment-requests");
                        }}>Cancel</button>
                      )}
                      <button type="submit" className="fleet-btn fleet-btn-primary" disabled={newRequestSubmitting}>
                        {newRequestSubmitting ? (editingPrId ? "Updating..." : "Submitting...") : (editingPrId ? "Save Changes" : "Submit Request")}
                      </button>
                    </div>
                  </div>
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
