"use client";

import { useEffect, useMemo, useState } from "react";
import * as ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { fetchCachedJson, API_BASE } from "@/lib/api";
import { ethiopianLabel } from "@/lib/ethiopianDate";
import { money } from "@/lib/formatters";
import type { DailyProfit, DailyProfitRow } from "@/types/trip";


const COMPANY = "TOP BEVERAGE INDUSTRIE";
const DAY_HEADERS = [
  "S/No",
  "Driver name",
  "Plate number",
  "Rent amount",
  "Daily Total cost",
  "Daily Vehicle rental Revenue",
  "Daily Vehicle rental net profit",
  "Actual Daily net profit",
  "REMARK",
];
const INCOME_HEADERS = ["N/o", "Driver name", "Plate number", "Total Revenu", "Total Expense", "profit /loss", "Remark"];

type DayCopy = { gregorian: string; rows: DailyProfitRow[] };

function addisToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Addis_Ababa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function eachDate(start: string, end: string) {
  if (!start || !end || start > end) return [];
  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end && dates.length < 31) {
    dates.push(cursor);
    cursor = shiftDate(cursor, 1);
  }
  return dates;
}

function amount(value?: number | null) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function blankZero(value: number) {
  return value ? value : "";
}

function storedRows(report: DailyProfit | null, gregorian: string) {
  if (!report || report.report_date !== gregorian) return [];
  return (report.rows || []).filter((row) => row.report_date === gregorian);
}

function remarkText(row: DailyProfitRow) {
  return String(row.remark ?? row.revenue_description ?? "").trim();
}

function vehicleKey(row: DailyProfitRow) {
  return String(row.plate_number || row.driver_name || "").trim().toLowerCase();
}

function cellStyle(sheet: ExcelJS.Worksheet, cell: ExcelJS.Cell, bold = false, align: "center" | "left" = "center") {
  cell.font = { name: "Roboto", size: 11, italic: false, bold };
  cell.alignment = { horizontal: align, vertical: "middle", wrapText: true };
  cell.border = {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  };
}

export default function WeeklyReport() {
  const today = addisToday();
  const [start, setStart] = useState(shiftDate(today, -6));
  const [end, setEnd] = useState(today);
  const [days, setDays] = useState<DayCopy[]>([]);

  useEffect(() => {
    const dates = eachDate(start, end);
    let cancelled = false;
    setDays(dates.map((gregorian) => ({ gregorian, rows: [] })));
    dates.forEach((gregorian) => {
      void fetchCachedJson<DailyProfit>(
        `${API_BASE}/reports/daily-profit?report_date=${gregorian}`,
        undefined,
        { ttlMs: 60_000, cacheKey: `reports:weekly-day:v1:${gregorian}`, forceRefresh: true }
      ).then((report) => {
        if (cancelled) return;
        setDays((current) => current.map((day) => (
          day.gregorian === gregorian ? { gregorian, rows: storedRows(report, gregorian) } : day
        )));
      }).catch(() => undefined);
    });
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ cacheKey: string; data: DailyProfit }>).detail;
      const gregorian = dates.find((day) => detail?.cacheKey === `reports:weekly-day:v1:${day}`);
      if (!gregorian || cancelled) return;
      setDays((current) => current.map((day) => day.gregorian === gregorian
        ? { gregorian, rows: storedRows(detail.data, gregorian) } : day));
    };
    window.addEventListener("fleet-cache-updated", onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener("fleet-cache-updated", onUpdate);
    };
  }, [start, end]);

  const incomeRows = useMemo(() => {
    const byVehicle = new Map<string, { driver: string; plate: string; revenue: number; cost: number; remarks: Set<string> }>();
    days.forEach((day) => {
      day.rows.forEach((row) => {
        const key = vehicleKey(row);
        if (!key) return;
        const current = byVehicle.get(key) || {
          driver: row.driver_name || "",
          plate: row.plate_number || "",
          revenue: 0,
          cost: 0,
          remarks: new Set<string>(),
        };
        current.revenue += amount(row.actual_daily_total_revenue);
        current.cost += amount(row.daily_total_cost);
        const note = remarkText(row);
        if (note) current.remarks.add(note);
        byVehicle.set(key, current);
      });
    });
    return Array.from(byVehicle.values()).sort((a, b) => a.driver.localeCompare(b.driver) || a.plate.localeCompare(b.plate));
  }, [days]);

  const summaryRows = useMemo(() => {
    const byRemark = new Map<string, { revenue: number; plates: Set<string> }>();
    days.forEach((day) => {
      day.rows.forEach((row) => {
        const note = remarkText(row);
        const revenue = amount(row.actual_daily_total_revenue);
        if (!note || !revenue) return;
        const current = byRemark.get(note) || { revenue: 0, plates: new Set<string>() };
        current.revenue += revenue;
        if (row.plate_number) current.plates.add(row.plate_number);
        byRemark.set(note, current);
      });
    });
    return Array.from(byRemark.entries())
      .map(([remark, value]) => ({ remark, revenue: value.revenue, vehicles: value.plates.size }))
      .sort((a, b) => b.revenue - a.revenue || a.remark.localeCompare(b.remark));
  }, [days]);

  const totals = useMemo(() => {
    const revenue = incomeRows.reduce((sum, row) => sum + row.revenue, 0);
    const cost = incomeRows.reduce((sum, row) => sum + row.cost, 0);
    return { revenue, cost, profit: revenue - cost };
  }, [incomeRows]);

  const startEc = ethiopianLabel(start);
  const endEc = ethiopianLabel(end);
  const title = `${startEc.replace(" E.C", "")}-${endEc} weekly Report`;
  const databaseRange = `Database Gregorian ${start} to ${end}`;

  const download = async () => {
    const workbook = new ExcelJS.Workbook();
    const income = workbook.addWorksheet("Income Statement");
    income.mergeCells("A1:G1");
    income.getCell("A1").value = COMPANY;
    income.mergeCells("A2:G2");
    income.getCell("A2").value = title;
    income.mergeCells("A3:G3");
    income.getCell("A3").value = databaseRange;
    [income.getCell("A1"), income.getCell("A2"), income.getCell("A3")].forEach((cell) => cellStyle(income, cell, true));
    const incomeHeader = income.addRow(INCOME_HEADERS);
    incomeHeader.eachCell((cell, column) => cellStyle(income, cell, true, column === 2 ? "left" : "center"));
    incomeRows.forEach((row, index) => {
      const added = income.addRow([
        index + 1,
        row.driver,
        row.plate,
        blankZero(row.revenue),
        blankZero(row.cost),
        row.revenue - row.cost,
        Array.from(row.remarks).join(" · "),
      ]);
      added.eachCell((cell, column) => cellStyle(income, cell, false, column === 2 ? "left" : "center"));
    });
    const incomeTotal = income.addRow(["TOTAL", "", "", blankZero(totals.revenue), blankZero(totals.cost), totals.profit, ""]);
    income.mergeCells(`A${incomeTotal.number}:C${incomeTotal.number}`);
    incomeTotal.eachCell((cell) => {
      cellStyle(income, cell, true);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF92D050" } };
    });
    income.columns = [{ width: 8 }, { width: 28 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 40 }];

    const daily = workbook.addWorksheet("Daily cost & revenue");
    days.forEach((day) => {
      const dateRow = daily.addRow(["", `Date - ${ethiopianLabel(day.gregorian)}`, "", `Gregorian ${day.gregorian}`]);
      daily.mergeCells(`B${dateRow.number}:C${dateRow.number}`);
      cellStyle(daily, dateRow.getCell(2), true);
      cellStyle(daily, dateRow.getCell(4), true);
      const header = daily.addRow(DAY_HEADERS);
      header.eachCell((cell, column) => cellStyle(daily, cell, true, column === 2 ? "left" : "center"));
      let cost = 0;
      let revenue = 0;
      day.rows.forEach((row, index) => {
        const rowRevenue = amount(row.actual_daily_total_revenue);
        const rowCost = amount(row.daily_total_cost);
        cost += rowCost;
        revenue += rowRevenue;
        const added = daily.addRow([
          index + 1,
          row.driver_name || "",
          row.plate_number || "",
          "",
          blankZero(rowCost),
          blankZero(rowRevenue),
          rowRevenue - rowCost,
          "",
          remarkText(row),
        ]);
        added.eachCell((cell, column) => cellStyle(daily, cell, false, column === 2 ? "left" : "center"));
      });
      const sum = daily.addRow(["", "", "", "", blankZero(cost), blankZero(revenue), revenue - cost, "", ""]);
      sum.eachCell((cell) => cellStyle(daily, cell, true));
      const actual = daily.addRow(["", "", "", "", "TOTAL ACTUAL DAILY PROFIT", "", "", "", ""]);
      daily.mergeCells(`E${actual.number}:G${actual.number}`);
      cellStyle(daily, actual.getCell(5), true);
      daily.addRow([]);
    });
    daily.addRow(["", "", "", "", "total actual revenue", blankZero(totals.revenue)]);
    daily.addRow(["", "", "", "", "total expense", blankZero(totals.cost)]);
    daily.addRow(["", "", "", "", "Profit", totals.profit]);
    daily.columns = [
      { width: 8 }, { width: 28 }, { width: 22 }, { width: 22 }, { width: 28 },
      { width: 28 }, { width: 30 }, { width: 24 }, { width: 42 },
    ];

    const summary = workbook.addWorksheet("summary ");
    summary.mergeCells("A1:D1");
    summary.getCell("A1").value = COMPANY;
    summary.mergeCells("A2:D2");
    summary.getCell("A2").value = title;
    summary.mergeCells("A3:D3");
    summary.getCell("A3").value = databaseRange;
    [summary.getCell("A1"), summary.getCell("A2"), summary.getCell("A3")].forEach((cell) => cellStyle(summary, cell, true));
    const summaryHeader = summary.addRow(["", "", "Expense", "Remark"]);
    summaryHeader.eachCell((cell) => cellStyle(summary, cell, true));
    summaryRows.forEach((row) => {
      const added = summary.addRow([row.remark, blankZero(row.revenue), "", `${row.vehicles} vehicles`]);
      added.eachCell((cell) => cellStyle(summary, cell));
    });
    const revenueRow = summary.addRow(["Total Revenue", blankZero(totals.revenue), "", ""]);
    const expenseRow = summary.addRow(["Total Expenses", "", blankZero(totals.cost), blankZero(totals.cost)]);
    const profitRow = summary.addRow(["profit", "", totals.profit, ""]);
    [revenueRow, expenseRow, profitRow].forEach((row) => row.eachCell((cell) => cellStyle(summary, cell, true)));
    summary.columns = [{ width: 62 }, { width: 18 }, { width: 18 }, { width: 18 }];

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Weekly_Report_${start}_to_${end}.xlsx`);
  };

  const box = {
    border: "1px solid var(--border)",
    padding: "8px 10px",
    textAlign: "center" as const,
    fontStyle: "normal" as const,
    fontFamily: "Arial, sans-serif",
  };
  const nameBox = { ...box, textAlign: "left" as const };

  return (
    <div className="fleet-report" style={{ display: "grid", gap: 16, fontStyle: "normal" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          From, Gregorian saved in database
          <input className="fleet-input" type="date" value={start} onChange={(event) => setStart(event.target.value)} style={{ minHeight: 36, width: "auto" }} />
          <span>{startEc}</span>
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          To, Gregorian saved in database
          <input className="fleet-input" type="date" value={end} onChange={(event) => setEnd(event.target.value)} style={{ minHeight: 36, width: "auto" }} />
          <span>{endEc}</span>
        </label>
        <button className="fleet-btn fleet-btn-primary" type="button" onClick={() => void download()} style={{ minHeight: 36 }}>
          Download sheet
        </button>
      </div>
      <div style={{ fontWeight: 700 }}>{COMPANY}</div>
      <div>{title}</div>
      <div>{databaseRange}</div>

      <div className="panel">
        <div className="panel-header"><div className="panel-title">Income Statement</div></div>
        <div style={{ overflowX: "auto", padding: "16px 24px 24px" }}>
          <table className="fleet-table" style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, fontStyle: "normal" }}>
            <thead>
              <tr>{INCOME_HEADERS.map((header) => <th key={header} style={header === "Driver name" ? nameBox : box}>{header}</th>)}</tr>
            </thead>
            <tbody>
              {incomeRows.length === 0 ? (
                <tr><td colSpan={7} style={box}>No stored rows for this range.</td></tr>
              ) : incomeRows.map((row, index) => (
                <tr key={`${row.plate}-${index}`}>
                  <td style={box}>{index + 1}</td>
                  <td style={nameBox}>{row.driver}</td>
                  <td style={box}>{row.plate}</td>
                  <td style={box}>{row.revenue ? money(row.revenue) : ""}</td>
                  <td style={box}>{row.cost ? money(row.cost) : ""}</td>
                  <td style={box}>{money(row.revenue - row.cost)}</td>
                  <td style={box}>{Array.from(row.remarks).join(" · ")}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} style={{ ...box, fontWeight: 700, background: "#92D050" }}>TOTAL</td>
                <td style={{ ...box, fontWeight: 700, background: "#92D050" }}>{totals.revenue ? money(totals.revenue) : ""}</td>
                <td style={{ ...box, fontWeight: 700, background: "#92D050" }}>{totals.cost ? money(totals.cost) : ""}</td>
                <td style={{ ...box, fontWeight: 700, background: "#92D050" }}>{money(totals.profit)}</td>
                <td style={{ ...box, background: "#92D050" }} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {days.map((day) => {
        const cost = day.rows.reduce((sum, row) => sum + amount(row.daily_total_cost), 0);
        const revenue = day.rows.reduce((sum, row) => sum + amount(row.actual_daily_total_revenue), 0);
        return (
          <div className="panel" key={day.gregorian}>
            <div className="panel-header"><div className="panel-title">Daily cost & revenue</div></div>
            <div style={{ padding: "16px 24px 0", fontWeight: 700 }}>
              Date - {ethiopianLabel(day.gregorian)} · Gregorian {day.gregorian}
            </div>
            <div style={{ overflowX: "auto", padding: "16px 24px 24px" }}>
              <table className="fleet-table" style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, fontStyle: "normal" }}>
                <thead>
                  <tr>{DAY_HEADERS.map((header) => <th key={header} style={header === "Driver name" ? nameBox : box}>{header}</th>)}</tr>
                </thead>
                <tbody>
                  {day.rows.length === 0 ? (
                    <tr><td colSpan={9} style={box}>No stored rows for this date.</td></tr>
                  ) : day.rows.map((row, index) => {
                    const rowRevenue = amount(row.actual_daily_total_revenue);
                    const rowCost = amount(row.daily_total_cost);
                    return (
                      <tr key={`${day.gregorian}-${row.trip_id || index}`}>
                        <td style={box}>{index + 1}</td>
                        <td style={nameBox}>{row.driver_name}</td>
                        <td style={box}>{row.plate_number}</td>
                        <td style={box} />
                        <td style={box}>{rowCost ? money(rowCost) : ""}</td>
                        <td style={box}>{rowRevenue ? money(rowRevenue) : ""}</td>
                        <td style={box}>{money(rowRevenue - rowCost)}</td>
                        <td style={box} />
                        <td style={box}>{remarkText(row)}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td colSpan={4} style={box} />
                    <td style={{ ...box, fontWeight: 700 }}>{cost ? money(cost) : ""}</td>
                    <td style={{ ...box, fontWeight: 700 }}>{revenue ? money(revenue) : ""}</td>
                    <td style={{ ...box, fontWeight: 700 }}>{money(revenue - cost)}</td>
                    <td style={box} />
                    <td style={box} />
                  </tr>
                  <tr>
                    <td colSpan={4} style={box} />
                    <td colSpan={3} style={{ ...box, fontWeight: 700 }}>TOTAL ACTUAL DAILY PROFIT</td>
                    <td style={box} />
                    <td style={box} />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div className="panel">
        <div className="panel-header"><div className="panel-title">summary</div></div>
        <div style={{ overflowX: "auto", padding: "16px 24px 24px" }}>
          <table className="fleet-table" style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, fontStyle: "normal" }}>
            <thead>
              <tr>
                <th style={box} />
                <th style={box} />
                <th style={box}>Expense</th>
                <th style={box}>Remark</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((row) => (
                <tr key={row.remark}>
                  <td style={box}>{row.remark}</td>
                  <td style={box}>{money(row.revenue)}</td>
                  <td style={box} />
                  <td style={box}>{row.vehicles} vehicles</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...box, fontWeight: 700 }}>Total Revenue</td>
                <td style={{ ...box, fontWeight: 700 }}>{money(totals.revenue)}</td>
                <td style={box} />
                <td style={box} />
              </tr>
              <tr>
                <td style={{ ...box, fontWeight: 700 }}>Total Expenses</td>
                <td style={box} />
                <td style={{ ...box, fontWeight: 700 }}>{money(totals.cost)}</td>
                <td style={{ ...box, fontWeight: 700 }}>{money(totals.cost)}</td>
              </tr>
              <tr>
                <td style={{ ...box, fontWeight: 700 }}>profit</td>
                <td style={box} />
                <td style={{ ...box, fontWeight: 700 }}>{money(totals.profit)}</td>
                <td style={box} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
