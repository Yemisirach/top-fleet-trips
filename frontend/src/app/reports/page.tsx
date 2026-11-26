"use client";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from "recharts";
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { Fragment, useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutDashboard, Moon, Sun, Plus, RefreshCw, Menu, ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useFleetUser } from "@/hooks/useFleetUser";
import { isManager } from "@/lib/scope";
import Sidebar, { type SidebarView } from "@/components/layout/Sidebar";
import BackButton from "@/components/navigation/BackButton";
import GpsLocationList, { type GpsPlace } from "@/components/reports/GpsLocationList";
import LocationCompare from "@/components/reports/LocationCompare";
import LocationDaysDetail from "@/components/reports/LocationDaysDetail";
import WeeklyReport from "@/components/reports/WeeklyReport";
import YearlyReport from "@/components/reports/YearlyReport";
import { fetchCachedJson, fetchJson, readCachedJson, sessionIsActive, API_BASE } from "@/lib/api";
import LastSyncLabel, { SyncButton } from "@/components/layout/LastSync";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cleanTripReference, money, normalizeState, paymentRequestItemLines, repeatedGroupSpan, stateLabel } from "@/lib/formatters";
import type {
  LocationRow,
  LocationSummary,
  LocationSummaryGroup,
  FinanceSummary,
  DailyProfit,
  DailyProfitRow,
  MayetVehicle,
  PaymentRequest,
} from "@/types/trip";

type Tab =
  | "location-summary"
  | "payment-requests"
  | "finance-summary"
  | "daily-profit"
  | "weekly-report"
  | "yearly-report"
  | "whatsapp-reports"
  | "new-request";

type LocationView = "summary" | "gps" | "compare";

type PaymentSubtab = "all" | "daily-supervisor" | "pscn";

const HIDDEN_SHEET_PHRASES = [
  "Border entry fees into Dire Dawa (Unloaded)",
  "Border entry fees into Djibouti",
  "Charges paid at weigh stations to verify truck weight",
  "Fee for vehicle security service",
  "Fixed daily allowance for basic employee travel expenses",
  "Labor costs for cargo loading assistants at the Djibouti port",
  "Reimbursed costs for employee mobile phone airtime and data",
  "Toll payments for using high-speed highways",
  "Total fuel costs allocated for a complete two-way journey",
];

function sheetDisplayText(value?: string | null) {
  let text = String(value || "");
  for (const phrase of HIDDEN_SHEET_PHRASES) {
    text = text.split(phrase).join("");
  }
  return text
    .replace(/\bPYR-01146\b/g, "")
    .replace(/(?:\s*·\s*){2,}/g, " · ")
    .replace(/^(?:\s*·\s*)+|(?:\s*·\s*)+$/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();
}

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
  { id: "location-summary", label: "Current location" },
  { id: "daily-profit", label: "Daily Profit" },
  { id: "weekly-report", label: "Weekly Report" },
  { id: "yearly-report", label: "Yearly report" },
  { id: "whatsapp-reports", label: "WhatsApp Reports" },
];

const todayIsoDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Addis_Ababa", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const PAYMENT_REQUESTS_CACHE_KEY = "reports:payment-requests:odoo-db-v5";

export default function ReportsPage() {
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "location-summary";
    if (window.location.hash === "#payment-requests") {
      window.location.replace("/payments");
    }
    return "location-summary";
  });
  const [loading, setLoading] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Data states
  const [locationSummary, setLocationSummary] = useState<LocationSummary | null>(null);
  const [locationView, setLocationView] = useState<LocationView>("summary");
  const [gpsVehicles, setGpsVehicles] = useState<MayetVehicle[]>([]);
  const [gpsPlaces, setGpsPlaces] = useState<GpsPlace[]>([]);
  const [gpsPlacesPending, setGpsPlacesPending] = useState(0);
  const [gpsError, setGpsError] = useState("");
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [financeSummary, setFinanceSummary] = useState<FinanceSummary | null>(null);
  const [financePeriod, setFinancePeriod] = useState("daily");
  const [financeGroupBy, setFinanceGroupBy] = useState("all");
  const [dailyProfit, setDailyProfit] = useState<DailyProfit | null>(null);
  const [dailyDate, setDailyDate] = useState("");
  const fleetUser = useFleetUser();
  const isMgr = isManager(fleetUser);
  const [customSaveStatus, setCustomSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [whatsappFormat, setWhatsappFormat] = useState("default");
  const [whatsappSummary, setWhatsappSummary] = useState<WhatsappSummary | null>(null);
  const [filterText, setFilterText] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("all");
  const [selectedPrIds, setSelectedPrIds] = useState<string[]>([]);
  const [expandedPaymentIds, setExpandedPaymentIds] = useState<string[]>([]);
  const [expandedLocationNames, setExpandedLocationNames] = useState<string[]>([]);
  const [expandedLocationRows, setExpandedLocationRows] = useState<string[]>([]);
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
        const lines = requestLines(pr).map((line) => `${line.item || ""} ${line.description || ""}`).join(" ");
        return `${Object.values(pr as unknown as Record<string, unknown>).join(" ")} ${lines}`.toLowerCase().includes(q);
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

  const approvedPaymentRequest = (pr: PaymentRequest) => {
    const state = String(pr.state || "").toLowerCase();
    if (state === "cancelled" || state === "canceled") return false;
    return Boolean(pr.approved_on) || ["approved", "paid", "posted", "done"].includes(state);
  };

  const paymentRequestStats = useMemo(() => {
    const rows = paymentSubtab === "daily-supervisor"
      ? filteredPaymentRequests.filter(approvedPaymentRequest)
      : filteredPaymentRequests;
    const total = rows.reduce((sum, pr) => sum + Number(pr.total_amount || 0), 0);
    return {
      count: rows.length,
      total,
      date: paymentFilterDate || todayIsoDate(),
    };
  }, [filteredPaymentRequests, paymentFilterDate, paymentSubtab]);

  const dailySupervisorRows = useMemo<DailySupervisorRow[]>(() => {
    return filteredPaymentRequests
      .filter(approvedPaymentRequest)
      .flatMap((pr) => requestLines(pr).map((line) => ({
        date: (pr.date || pr.approved_on || new Date().toISOString()).slice(0, 10),
        supervisor: pr.supervisor_name || pr.requester_name || "Unassigned",
        vehicle: pr.vehicle_plate || "",
        route: paymentRouteName(pr),
        requestId: pr.id,
        state: pr.state || "draft",
        requester: pr.requester_name || "",
        item: paymentItemName(line.item, line.description),
        description: line.description || "",
        quantity: line.quantity || 1,
        amount: line.amount || 0,
        lineTotal: line.total ?? ((line.amount || 0) * (line.quantity || 1)),
        requestTotal: pr.total_amount || 0,
      })))
      .sort((a, b) =>
        b.date.localeCompare(a.date) ||
        a.supervisor.localeCompare(b.supervisor) ||
        a.vehicle.localeCompare(b.vehicle) ||
        a.route.localeCompare(b.route) ||
        String(a.requestId).localeCompare(String(b.requestId))
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
        paymentRequestItemLines(row.item, row.description).join("\n"),
        row.quantity,
        row.amount,
        row.lineTotal,
        "",
      ]);
      dataRow.eachCell((cell, colNumber) => {
        cell.font = { name: "Times New Roman", size: 11 };
        cell.border = { top: {style:"thin"}, left: {style:"thin"}, bottom: {style:"thin"}, right: {style:"thin"} };
        if ([7, 8].includes(colNumber)) {
          cell.alignment = { horizontal: "right", vertical: "middle" };
          cell.numFmt = "#,##0.00";
        } else if ([1, 2, 3, 4, 6].includes(colNumber)) {
          cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        } else {
          cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
        }
      });
    });

    const mergeRepeated = (column: number, keyOf: (row: DailySupervisorRow) => string) => {
      let start = 0;
      while (start < dailySupervisorRows.length) {
        const key = keyOf(dailySupervisorRows[start]);
        let end = start + 1;
        while (end < dailySupervisorRows.length && keyOf(dailySupervisorRows[end]) === key) end += 1;
        if (end > start + 1) {
          sheet.mergeCells(4 + start, column, 3 + end, column);
          sheet.getCell(4 + start, column).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        }
        start = end;
      }
    };
    mergeRepeated(2, (row) => row.supervisor || "Unassigned");
    mergeRepeated(3, (row) => `${row.supervisor}|${row.vehicle}`);
    mergeRepeated(4, (row) => `${row.supervisor}|${row.vehicle}|${row.route}`);

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

  const updateDailyProfitCell = useCallback((rowKey: string, field: "actual" | "remark", value: string) => {
    setDailyProfit((prev) => {
      if (!prev) return prev;
      const nextRows = prev.rows.map((row) => {
        const rk = row.row_key || `${row.plate_number}:${row.trip_id || row.no}`;
        if (rk === rowKey) {
          return { ...row, [field]: value };
        }
        return row;
      });
      const actualNums = nextRows
        .map((r) => r.actual)
        .filter((v) => v !== undefined && v !== null && String(v).trim() !== "")
        .map((v) => parseFloat(String(v).replace(/,/g, "").trim()))
        .filter((n) => !isNaN(n));
      const actualTotal = actualNums.length > 0 ? actualNums.reduce((a, b) => a + b, 0) : 0;
      return {
        ...prev,
        rows: nextRows,
        totals: {
          ...prev.totals,
          actual_total: actualTotal,
        },
      };
    });
  }, []);

  const saveDailyCustomRow = useCallback(async (row: DailyProfitRow) => {
    if (!isMgr || !dailyProfit) return;
    const reportDate = dailyProfit.report_date || dailyDate || new Date().toISOString().slice(0, 10);
    const rowKey = row.row_key || `${row.plate_number}:${row.trip_id || row.no}`;
    setCustomSaveStatus("saving");
    try {
      await fetchJson(`${API_BASE}/reports/daily-profit/custom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_date: reportDate,
          row_key: rowKey,
          actual: row.actual !== undefined && row.actual !== null ? String(row.actual) : null,
          remark: row.remark !== undefined && row.remark !== null ? String(row.remark) : null,
          plate_number: row.plate_number,
          trip_id: row.trip_id,
        }),
      });
      setCustomSaveStatus("saved");
      setTimeout(() => setCustomSaveStatus("idle"), 2500);
    } catch (err) {
      console.error("Failed to save daily custom entry to VPS", err);
      setCustomSaveStatus("error");
    }
  }, [isMgr, dailyProfit, dailyDate]);

  const saveAllDailyCustomRows = useCallback(async () => {
    if (!isMgr || !dailyProfit || !dailyProfit.rows.length) return;
    const reportDate = dailyProfit.report_date || dailyDate || new Date().toISOString().slice(0, 10);
    setCustomSaveStatus("saving");
    try {
      const updates = dailyProfit.rows.map((r) => ({
        row_key: r.row_key || `${r.plate_number}:${r.trip_id || r.no}`,
        actual: r.actual !== undefined && r.actual !== null ? String(r.actual) : null,
        remark: r.remark !== undefined && r.remark !== null ? String(r.remark) : null,
        plate_number: r.plate_number,
        trip_id: r.trip_id,
      }));
      await fetchJson(`${API_BASE}/reports/daily-profit/custom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_date: reportDate,
          updates,
        }),
      });
      setCustomSaveStatus("saved");
      setTimeout(() => setCustomSaveStatus("idle"), 2500);
    } catch (err) {
      console.error("Failed to save all custom entries to VPS", err);
      setCustomSaveStatus("error");
    }
  }, [isMgr, dailyProfit, dailyDate]);

  const exportDailyProfit = useCallback(async () => {
    if (!dailyProfit) return;
    
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Daily Profit');

    // Add Title
    sheet.mergeCells('A1:H1');
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
    const headers = ["No", "Driver name", "Plate number", "Route", "Total Daily Revenue", "Cost", "Actual Daily Revenue", "Remark"];
    const headerRow = sheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Times New Roman', size: 11, italic: true, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
    });
    headerRow.height = 30;

    // Data Rows
    dailyProfit.rows.forEach((r: DailyProfitRow) => {
      const actualVal = r.actual !== undefined && r.actual !== null && String(r.actual).trim() !== ""
        ? (isNaN(Number(r.actual)) ? r.actual : Number(r.actual))
        : '';
      const remarkVal = r.remark !== undefined && r.remark !== null && String(r.remark).trim() !== ""
        ? r.remark
        : (r.revenue_description || '');
      const row = sheet.addRow([
        r.no,
        r.driver_name,
        r.plate_number,
        r.remarks || '',
        r.actual_daily_total_revenue || '',
        r.daily_total_cost || '',
        actualVal,
        remarkVal,
      ]);
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Times New Roman', size: 11 };
        cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
        
        if (colNumber >= 5 && colNumber <= 7) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          if (typeof cell.value === 'number') {
            cell.numFmt = '#,##0.00';
          }
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
    const totalsRow = sheet.addRow(['', '', '', '', '', '', '', '']);
    sheet.mergeCells(`A${totalsRow.number}:H${totalsRow.number}`);

    const actualProfitCell = sheet.getCell(`A${totalsRow.number}`);
    const formattedProfit = totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    actualProfitCell.value = `Profit  ${formattedProfit}`;
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
      { width: 18 }, // Route
      { width: 22 }, // Total Daily Revenue
      { width: 15 }, // Cost
      { width: 22 }, // Actual Daily Revenue
      { width: 30 }, // Remark
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Daily_Cost_and_Profit_Report_${dailyProfit.report_date || "latest"}.xlsx`);
  }, [dailyProfit]);

  const load = useCallback(async (t: Tab = tab, force = false, silent = false) => {
    if (t === "weekly-report" || t === "yearly-report") return;
    // Avoid re-fetching if data is already present and not forced
    const hasData = (() => {
      if (t === "location-summary") return !!locationSummary;
      if (t === "payment-requests") return paymentRequests.length > 0;
      if (t === "finance-summary") return !!financeSummary;
      if (t === "daily-profit") return !!dailyProfit;
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

    if (t === "location-summary") {
      showCached<LocationSummary>("reports:current-location-summary-supervised-v5", setLocationSummary);
    } else if (t === "payment-requests") {
      showCached<PaymentRequest[]>(PAYMENT_REQUESTS_CACHE_KEY, setPaymentRequests);
    } else if (t === "finance-summary") {
      showCached<FinanceSummary>(`reports:finance-summary-v7:${financePeriod}:${financeGroupBy}`, setFinanceSummary);
    } else if (t === "daily-profit") {
      showCached<DailyProfit>(`reports:daily-profit-v11:${dailyDate || "latest"}`, setDailyProfit);
    } else if (t === "whatsapp-reports") {
      showCached<PaymentRequest[]>(PAYMENT_REQUESTS_CACHE_KEY, setPaymentRequests);
      showCached<WhatsappSummary>(
        `reports:whatsapp-summary:v4:${whatsappFormat}:${selectedPrIds.join("-") || "none"}`,
        setWhatsappSummary
      );
    }

    if (!silent) setLoading(!showedCachedData);
    try {
      if (t === "location-summary") {
        const data = await fetchCachedJson<LocationSummary>(`${API_BASE}/reports/current-location-summary`, undefined, { ttlMs: 1_000, cacheKey: "reports:current-location-summary-supervised-v5", forceRefresh: force });
        setLocationSummary(data);
      } else if (t === "payment-requests") {
        const rows = await fetchCachedJson<PaymentRequest[]>(`${API_BASE}/reports/payment-requests`, undefined, { ttlMs: 60_000, cacheKey: PAYMENT_REQUESTS_CACHE_KEY, forceRefresh: force });
        setPaymentRequests(rows);
      } else if (t === "finance-summary") {
        const data = await fetchCachedJson<FinanceSummary>(
          `${API_BASE}/reports/finance-summary?period=${financePeriod}&group_by=${financeGroupBy}`,
          undefined,
          { ttlMs: 60_000, cacheKey: `reports:finance-summary-v7:${financePeriod}:${financeGroupBy}`, forceRefresh: force }
        );
        setFinanceSummary(data);
      } else if (t === "daily-profit") {
        const url = dailyDate
          ? `${API_BASE}/reports/daily-profit?report_date=${dailyDate}`
          : `${API_BASE}/reports/daily-profit`;
        const data = await fetchCachedJson<DailyProfit>(url, undefined, { ttlMs: 60_000, cacheKey: `reports:daily-profit-v11:${dailyDate || "latest"}`, forceRefresh: force });
        setDailyProfit(data);
      } else if (t === "whatsapp-reports") {
        let prs = paymentRequests;
        if (!prs.length) {
            prs = await fetchCachedJson<PaymentRequest[]>(`${API_BASE}/reports/payment-requests`, undefined, { ttlMs: 60_000, cacheKey: PAYMENT_REQUESTS_CACHE_KEY, forceRefresh: force });
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
        const data = await fetchCachedJson<WhatsappSummary>(url, undefined, { ttlMs: 1_000, cacheKey: `reports:whatsapp-summary:v4:${whatsappFormat}:${idsToFetch.join("-") || "none"}`, forceRefresh: force });
        setWhatsappSummary(data);
        // Also preload daily profit for the spreadsheet button
        if (!dailyProfit) {
            const dp = await fetchCachedJson<DailyProfit>(`${API_BASE}/reports/daily-profit`, undefined, { ttlMs: 60_000, cacheKey: "reports:daily-profit-v11:latest" });
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
    locationSummary,
    financeSummary,
    dailyProfit,
  ]);

  useEffect(() => {
    // Auth guard
    void sessionIsActive().then((active) => { if (!active) router.push("/login"); });
  }, [router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      load(tab);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [tab]);

  const loadRef = useRef(load);
  loadRef.current = load;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ cacheKey?: string; data?: unknown }>).detail;
      if (!detail?.cacheKey || detail.data === undefined) return;
      const key = detail.cacheKey;
      if (key === "reports:current-location-summary-supervised-v5") setLocationSummary(detail.data as LocationSummary);
      else if (key === PAYMENT_REQUESTS_CACHE_KEY) setPaymentRequests(detail.data as PaymentRequest[]);
      else if (key === `reports:finance-summary-v7:${financePeriod}:${financeGroupBy}`) setFinanceSummary(detail.data as FinanceSummary);
      else if (key === `reports:daily-profit-v11:${dailyDate || "latest"}`) setDailyProfit(detail.data as DailyProfit);
      else if (key === "dashboard:mayet:vehicles") {
        const catalog = detail.data as { vehicles?: MayetVehicle[] };
        setGpsVehicles(Array.isArray(catalog.vehicles) ? catalog.vehicles : []);
      }
    };
    window.addEventListener("fleet-cache-updated", onUpdate);
    return () => window.removeEventListener("fleet-cache-updated", onUpdate);
  }, [dailyDate, financeGroupBy, financePeriod]);

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

  useEffect(() => {
    if (tab !== "location-summary" || locationView === "summary") return;
    let cancelled = false;
    const pullGps = () => {
      fetchCachedJson<{ vehicles?: MayetVehicle[]; message?: string }>(
        `${API_BASE}/dashboard/mayet/vehicles`,
        undefined,
        { ttlMs: 60_000, cacheKey: "dashboard:mayet:vehicles" }
      )
        .then((catalog) => {
          if (cancelled) return;
          setGpsVehicles(Array.isArray(catalog.vehicles) ? catalog.vehicles : []);
          setGpsError(catalog.vehicles?.length ? "" : (catalog.message || ""));
        })
        .catch((error: unknown) => {
          const saved = readCachedJson<{ vehicles?: MayetVehicle[] }>("dashboard:mayet:vehicles");
          if (!cancelled && saved?.vehicles?.length) {
            setGpsVehicles(saved.vehicles);
            setGpsError("");
            return;
          }
          if (!cancelled) setGpsError(error instanceof Error ? error.message : "Could not load GPS locations");
        });
    };
    pullGps();
    const timer = window.setInterval(pullGps, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tab, locationView]);

  useEffect(() => {
    if (tab !== "location-summary" || locationView === "summary") return;
    let cancelled = false;
    let timer = 0;
    const loadPlaces = () => {
      const savedPlaces = readCachedJson<{ places?: GpsPlace[]; pending?: number }>("dashboard:gps-places");
      if (savedPlaces) setGpsPlaces(Array.isArray(savedPlaces.places) ? savedPlaces.places : []);
      fetchCachedJson<{ places?: GpsPlace[]; pending?: number }>(`${API_BASE}/dashboard/gps-places`, undefined, { ttlMs: 60_000, cacheKey: "dashboard:gps-places" })
        .then((data) => {
          if (cancelled) return;
          const pending = data.pending || 0;
          setGpsPlaces(Array.isArray(data.places) ? data.places : []);
          setGpsPlacesPending(pending);
          if (pending > 0) timer = window.setTimeout(loadPlaces, 4000);
        })
        .catch(() => {
          if (!cancelled) setGpsPlacesPending(0);
        });
    };
    loadPlaces();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tab, locationView]);


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
    const locationFilterActive = selectedLocation !== "all" && tab === "location-summary";
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
  }, [locationSummary]);

  const isPendingPlace = (value?: string | null) => /^\*\s*pending/i.test(String(value || "").trim());
  const placeName = (value?: string | null) => {
    const name = String(value || "").trim();
    return name && !isPendingPlace(name) ? name : "";
  };
  const openTripLabel = (row: LocationRow) => {
    const trip = String(row.reference || "").trim();
    const from = placeName(row.departure_name);
    const to = placeName(row.destination_name);
    const route = from && to ? `${from} → ${to}` : to || from;
    return [trip, route].filter(Boolean).join(" · ");
  };
  const locationEvidence = (row: LocationRow) => {
    const note = String(row.current_location_note || "").trim();
    if (note && !isPendingPlace(note)) return note;
    return openTripLabel(row);
  };

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

    const headers = ["No", "Location", "Vehicle", "Supervisor", "Driver", "Open trip", "Evidence", "State", "Days"];
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
          openTripLabel(vehicle),
          locationEvidence(vehicle),
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
          router.push(v === "overview" ? "/" : v === "reports" ? "/reports" : v === "finance" ? "/finance" : v === "payments" ? "/payments" : v === "map" ? "/map" : `/?view=${v}`);
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
          <SyncButton />
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
      {tab !== "payment-requests" && tab !== "new-request" && tab !== "whatsapp-reports" && tab !== "weekly-report" && tab !== "yearly-report" && (
        <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line)", background: "var(--panel)", display: "flex", gap: 10, alignItems: "center" }}>
          <input
            className="fleet-input"
            placeholder={tab === "location-summary" && locationView !== "summary" ? "Search plate, driver, place, destination…" : "Filter rows…"}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={{ maxWidth: 320, minHeight: 36 }}
          />
          {filterText.trim() && <LastSyncLabel searching />}
          {tab === "location-summary" && locationView === "summary" && (
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

        </div>
      )}

      {/* Content */}
      <div className="fleet-page" style={{ flex: 1, overflowY: "auto", paddingBottom: 40 }}>

        {/* ── Location Summary ── */}
        {tab === "location-summary" && locationSummary && (
          <div style={{ display: "grid", gap: 16 }}>
            <div className="report-tabs" style={{ padding: 0 }}>
              <button type="button" className={`report-tab${locationView === "summary" ? " active" : ""}`} onClick={() => setLocationView("summary")}>By location</button>
              <button type="button" className={`report-tab${locationView === "gps" ? " active" : ""}`} onClick={() => setLocationView("gps")}>GPS current location list</button>
              <button type="button" className={`report-tab${locationView === "compare" ? " active" : ""}`} onClick={() => setLocationView("compare")}>Compare</button>
            </div>
            {locationView === "compare" ? (
              <LocationCompare
                trips={locationSummary.locations.flatMap((group) => group.vehicles.map((vehicle) => ({ ...vehicle, current_location_name: vehicle.current_location_name || group.location_name })))}
                gpsVehicles={gpsVehicles}
                places={gpsPlaces}
                query={filterText}
                error={gpsError}
              />
            ) : locationView === "gps" ? (
              <GpsLocationList
                trips={locationSummary.locations.flatMap((group) => group.vehicles)}
                gpsVehicles={gpsVehicles}
                places={gpsPlaces}
                query={filterText}
                error={gpsError}
              />
            ) : (
            <>
            <div style={{ display: "flex", gap: 12 }}>
              <div className="card"><div className="card-label">Total Locations</div><div className="card-value">{locationSummary.total_locations}</div></div>
              <div className="card"><div className="card-label">Total Vehicles</div><div className="card-value">{locationSummary.total_vehicles}</div></div>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>Click a location to open its vehicles. Click a vehicle to see how days is calculated.</p>
            {(filterRows(locationSummary.locations as unknown as Record<string, unknown>[]) as unknown as LocationSummaryGroup[]).map((loc) => {
              const locationOpen = expandedLocationNames.includes(loc.location_name);
              return (
              <div key={loc.location_name} className={`panel${locationOpen ? " selected" : ""}`}>
                <button
                  type="button"
                  className="panel-header"
                  onClick={() => setExpandedLocationNames((current) => current.includes(loc.location_name) ? current.filter((name) => name !== loc.location_name) : [...current, loc.location_name])}
                  aria-expanded={locationOpen}
                  style={{ width: "100%", border: 0, background: "transparent", color: "inherit", font: "inherit", cursor: "pointer", textAlign: "left" }}
                >
                  <div className="panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {locationOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    {loc.location_name}
                  </div>
                  <span className="muted" style={{ fontSize: 13 }}>{loc.vehicle_count} vehicle{loc.vehicle_count === 1 ? "" : "s"}</span>
                </button>
                {locationOpen && (
                <div style={{ overflowX: "auto" }}>
                  <table className="fleet-table" style={{ fontStyle: 'normal' }}>
                    <thead>
                      <tr>{["", "Vehicle", "Supervisor", "Driver", "Open trip", "Evidence", "Dep. Date", "State", "Days"].map((h) => <th key={h || "expand"}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {loc.vehicles.map((v, i) => {
                        const rowKey = `${loc.location_name}:${v.vehicle_id || v.vehicle_plate || i}`;
                        const rowOpen = expandedLocationRows.includes(rowKey);
                        return (
                          <Fragment key={rowKey}>
                            <tr className={`payment-clickable-row${rowOpen ? " expanded" : ""}`} onClick={() => setExpandedLocationRows((current) => current.includes(rowKey) ? current.filter((key) => key !== rowKey) : [...current, rowKey])}>
                              <td>{rowOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                              <td>{v.vehicle_plate || "N/A"}</td>
                              <td>{v.supervisor_name || "Unassigned"}</td>
                              <td>{v.driver_name || "Unassigned"}</td>
                              <td>
                                {v.trip_id ? (
                                  <Link href={`/detail?journey_id=${encodeURIComponent(String(v.trip_id))}`} onClick={(event) => event.stopPropagation()}>
                                    {openTripLabel(v) || `Trip ${v.trip_id}`}
                                  </Link>
                                ) : (
                                  openTripLabel(v) || "No open trip"
                                )}
                              </td>
                              <td className="gps-note-cell">{locationEvidence(v) || "No location note"}</td>
                              <td className="location-date-cell">{v.departure_date || "–"}</td>
                              <td><span className={`pill ${normalizeState(v.state)}`}>{stateLabel(v.state)}</span></td>
                              <td>{v.current_location_days ?? v.days ?? 0}</td>
                            </tr>
                            {rowOpen && (
                              <tr>
                                <td colSpan={9} style={{ background: "var(--panel-2)", padding: 12 }}>
                                  <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                                    <strong>{openTripLabel(v) || "No open trip"}</strong>
                                    <span>{locationEvidence(v) || "No descriptive location note on this trip."}</span>
                                  </div>
                                  <LocationDaysDetail row={v} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                )}
              </div>
              );
            })}
            </>
            )}
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
                      dailySupervisorRows.map((row, index, rows) => {
                        const supervisorSpan = repeatedGroupSpan(rows, index, (item) => item.supervisor || "Unassigned");
                        const plateSpan = repeatedGroupSpan(rows, index, (item) => `${item.supervisor}|${item.vehicle}`);
                        const routeSpan = repeatedGroupSpan(rows, index, (item) => `${item.supervisor}|${item.vehicle}|${item.route}`);
                        return (
                        <tr key={`${row.requestId}-${index}`}>
                          <td className="daily-report-no">{index + 1}</td>
                          {supervisorSpan > 0 && <td className="daily-report-span" rowSpan={supervisorSpan}>{row.supervisor || "Unassigned"}</td>}
                          {plateSpan > 0 && <td className="daily-report-span" rowSpan={plateSpan}>{row.vehicle || "–"}</td>}
                          {routeSpan > 0 && <td className="daily-report-span" rowSpan={routeSpan}>{row.route || "–"}</td>}
                          <td>{paymentRequestItemLines(row.item, row.description).map((line, lineIndex) => <div key={lineIndex}>{line}</div>)}</td>
                          <td className="daily-report-center">{row.quantity}</td>
                          <td className="daily-report-money">{money(row.amount)}</td>
                          <td className="daily-report-money green">{money(row.lineTotal)}</td>
                          <td></td>
                        </tr>
                        );
                      })
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
        {tab === "weekly-report" && (
          <WeeklyReport />
        )}

        {tab === "yearly-report" && (
          <YearlyReport />
        )}

        {tab === "daily-profit" && dailyProfit && (
          <div style={{ display: "grid", gap: 16 }}>
            {dailyProfit._warning && <div className="login-error">{dailyProfit._warning}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 12 }}>
              <div className="card"><div className="card-label">Report Date</div><div className="card-value">{dailyProfit.report_date || "No financial date"}</div></div>
              <div className="card"><div className="card-label">Vehicles</div><div className="card-value">{dailyProfit.totals.vehicle_count}</div></div>
              <div className="card"><div className="card-label">Revenue</div><div className="card-value green">{money(dailyProfit.totals.revenue_total)}</div></div>
              {dailyProfit.totals.actual_total !== undefined && dailyProfit.totals.actual_total > 0 && (
                <div className="card"><div className="card-label">Actual Revenue</div><div className="card-value green">{money(dailyProfit.totals.actual_total)}</div></div>
              )}
              <div className="card"><div className="card-label">Unconfirmed</div><div className="card-value">{money(dailyProfit.totals.unconfirmed_total || 0)}</div></div>
              <div className="card"><div className="card-label">Cost</div><div className="card-value">{money(dailyProfit.totals.cost_total)}</div></div>
              <div className="card"><div className="card-label">Posted Profit</div><div className={`card-value ${dailyProfit.totals.net_profit_total >= 0 ? "green" : "red"}`}>{money(dailyProfit.totals.net_profit_total)}</div></div>
            </div>
            <div className="panel">
              <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div className="panel-title">Daily Vehicle Profit</div>
                {isMgr && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {customSaveStatus === "saving" && (
                      <span style={{ fontSize: 12, color: "var(--primary)", display: "flex", alignItems: "center", gap: 4 }}>
                        <RefreshCw size={13} className="spin" /> Saving to VPS...
                      </span>
                    )}
                    {customSaveStatus === "saved" && (
                      <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>✓ Saved to VPS</span>
                    )}
                    {customSaveStatus === "error" && (
                      <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 600 }}>⚠ Save failed</span>
                    )}
                    <button
                      className="fleet-btn fleet-btn-secondary"
                      style={{ padding: "4px 12px", fontSize: 12, minHeight: 30 }}
                      onClick={saveAllDailyCustomRows}
                      disabled={customSaveStatus === "saving"}
                    >
                      Save All Changes
                    </button>
                  </div>
                )}
              </div>
              <div style={{ padding: "16px 24px 0", fontStyle: "italic", fontWeight: "bold" }}>
                Date - {dailyProfit.report_date || "No financial date"}
              </div>
              <div style={{ overflowX: "auto", padding: "16px 24px 24px" }}>
                <table className="fleet-table" style={{ border: "1px solid var(--border)", borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                  <thead>
                    <tr>
                      {["No", "Driver", "Plate", "Route", "Total Daily Revenue", "Cost", "Actual Daily Revenue", "Remark"].map((h, index) => (
                        <th key={`${h}-${index}`} style={{ border: "1px solid var(--border)", padding: "8px 12px", fontStyle: "italic", fontWeight: "normal", textAlign: index === 1 ? "left" : "center", backgroundColor: "transparent" }}>
                          {h}
                          {isMgr && (index === 6 || index === 7) && (
                            <Pencil size={11} style={{ display: "inline", marginLeft: 4, opacity: 0.6 }} />
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(filterRows(dailyProfit.rows as unknown as Record<string, unknown>[]) as unknown as typeof dailyProfit.rows).length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
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
                    ) : (filterRows(dailyProfit.rows as unknown as Record<string, unknown>[]) as unknown as typeof dailyProfit.rows).map((r) => {
                      const rowKey = r.row_key || `${r.plate_number}:${r.trip_id || r.no}`;
                      return (
                        <tr key={rowKey}>
                          <td style={{ border: "1px solid var(--border)", padding: "6px 12px", textAlign: "center", fontStyle: "italic" }}>{r.no}</td>
                          <td style={{ border: "1px solid var(--border)", padding: "6px 12px" }}>{r.driver_name}</td>
                          <td style={{ border: "1px solid var(--border)", padding: "6px 12px" }}>{r.plate_number}</td>
                          <td style={{ border: "1px solid var(--border)", padding: "6px 12px", fontStyle: "italic" }}>{r.remarks}</td>
                          <td style={{ border: "1px solid var(--border)", padding: "6px 12px", textAlign: "right" }}>
                            {money(r.rent_amount || 0)}
                            {(r.unconfirmed_amount || 0) > 0 && (
                              <div className="muted" style={{ fontSize: 11 }}>Unconfirmed {money(r.unconfirmed_amount || 0)}</div>
                            )}
                          </td>
                          <td style={{ border: "1px solid var(--border)", padding: "6px 12px", textAlign: "right" }}>{r.daily_total_cost ? money(r.daily_total_cost) : "—"}</td>
                          <td style={{ border: "1px solid var(--border)", padding: isMgr ? "4px 8px" : "6px 12px", textAlign: "right" }}>
                            {isMgr ? (
                              <input
                                type="text"
                                className="fleet-input"
                                value={r.actual ?? ""}
                                placeholder="0.00"
                                onChange={(e) => updateDailyProfitCell(rowKey, "actual", e.target.value)}
                                onBlur={() => saveDailyCustomRow(r)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                                style={{
                                  width: "100%",
                                  minWidth: 90,
                                  padding: "4px 8px",
                                  fontSize: 12,
                                  textAlign: "right",
                                  minHeight: 28,
                                  height: 28,
                                }}
                              />
                            ) : (
                              r.actual !== undefined && r.actual !== null && String(r.actual).trim() !== ""
                                ? (isNaN(Number(r.actual)) ? r.actual : money(Number(r.actual)))
                                : "—"
                            )}
                          </td>
                          <td style={{ border: "1px solid var(--border)", padding: isMgr ? "4px 8px" : "6px 12px", fontStyle: isMgr ? "normal" : "italic" }}>
                            {isMgr ? (
                              <input
                                type="text"
                                className="fleet-input"
                                value={r.remark ?? r.revenue_description ?? ""}
                                placeholder="Remark..."
                                onChange={(e) => updateDailyProfitCell(rowKey, "remark", e.target.value)}
                                onBlur={() => saveDailyCustomRow(r)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                                style={{
                                  width: "100%",
                                  minWidth: 140,
                                  padding: "4px 8px",
                                  fontSize: 12,
                                  minHeight: 28,
                                  height: 28,
                                }}
                              />
                            ) : (
                              r.remark || r.revenue_description || ""
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {dailyProfit.rows.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={8} style={{ border: "1px solid var(--border)", padding: "8px 12px", backgroundColor: "#7fe57f", color: "#000", fontWeight: "bold", textAlign: "left", fontStyle: "italic" }}>
                          Profit {money(dailyProfit.totals.net_profit_total)}
                          {dailyProfit.totals.actual_total ? `  |  Actual Revenue Total: ${money(dailyProfit.totals.actual_total)}` : ""}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
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
