"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import * as ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { fetchCachedJson, API_BASE } from "@/lib/api";
import { repeatedGroupSpan } from "@/lib/formatters";
import {
  ETHIOPIAN_MONTHS,
  ethiopianMonthLength,
  ethiopianToGregorianIso,
  formatEthiopian,
  gregorianToEthiopian,
} from "@/lib/ethiopianDate";

const COMPANY = "TOP BEVERAGE INDUSTRIE";

type TripRow = {
  trip_id: number;
  remark?: string | null;
  vehicle_id?: number;
  trip_day: string;
  driver_name: string;
  plate_number: string;
  vehicle_type: string;
  supervisor_name: string;
  revenue_total: number;
  cost_total: number;
};

type VehicleRecord = {
  vehicle_id: number;
  plate_number: string;
  vehicle_type: string;
  driver_name: string;
  supervisor_name: string;
};

type YearPayload = {
  ethiopian_year: number;
  gregorian_start: string;
  gregorian_end: string;
  rows: TripRow[];
  vehicles?: VehicleRecord[];
  _warning?: string;
};

type Bucket = { cost: number; revenue: number };
type VehicleLine = {
  key: string;
  remarks?: string[];
  supervisor: string;
  driver: string;
  plate: string;
  vehicleType: string;
  buckets: Bucket[];
};

function addisToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Addis_Ababa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function amount(value?: number) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function plain(value: number) {
  if (!value) return "";
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

const HEADER_GRAY = "FFD9D9D9";
const REVENUE_PEACH = "FFFAC090";
const EMPTY_GRAY = "FF808080";

function paint(cell: ExcelJS.Cell, argb: string) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function placedDate(row: TripRow, year: number) {
  const date = gregorianToEthiopian(String(row.trip_day || "").slice(0, 10));
  if (!date || date.year !== year) return null;
  return date;
}

function emptyBuckets(count: number): Bucket[] {
  return Array.from({ length: count }, () => ({ cost: 0, revenue: 0 }));
}

function lineSort(a: VehicleLine, b: VehicleLine) {
  if (!a.supervisor && b.supervisor) return 1;
  if (a.supervisor && !b.supervisor) return -1;
  return a.supervisor.localeCompare(b.supervisor) || a.driver.localeCompare(b.driver) || a.plate.localeCompare(b.plate);
}

function buildLines(rows: TripRow[], vehicles: VehicleRecord[], year: number, month: number | null) {
  const columnCount = month ? ethiopianMonthLength(year, month) : 13;
  const byVehicle = new Map<string, VehicleLine>();
  vehicles.forEach((vehicle) => {
    const key = `vehicle:${vehicle.vehicle_id}`;
    byVehicle.set(key, {
      key,
      supervisor: (vehicle.supervisor_name || "").trim(),
      driver: (vehicle.driver_name || "").trim(),
      plate: (vehicle.plate_number || "").trim(),
      vehicleType: (vehicle.vehicle_type || "").trim(),
      buckets: emptyBuckets(columnCount),
    });
  });
  rows.forEach((row) => {
    const date = placedDate(row, year);
    if (!date || (month && date.month !== month)) return;
    const index = month ? date.day - 1 : date.month - 1;
    if (index < 0 || index >= columnCount) return;
    const supervisor = (row.supervisor_name || "").trim();
    const driver = (row.driver_name || "").trim();
    const plate = (row.plate_number || "").trim();
    const key = row.vehicle_id ? `vehicle:${row.vehicle_id}` : [supervisor, driver, plate || String(row.trip_id)].join("|").toLowerCase();
    const existing = byVehicle.get(key);
    if (!existing && vehicles.length) return;
    const current = existing || {
      key,
      supervisor,
      driver,
      plate,
      vehicleType: (row.vehicle_type || "").trim(),
      buckets: emptyBuckets(columnCount),
    };
    if (!current.driver && driver) current.driver = driver;
    if (!current.supervisor && supervisor) current.supervisor = supervisor;
    if (!current.plate && plate) current.plate = plate;
    if (!current.vehicleType && row.vehicle_type) current.vehicleType = row.vehicle_type.trim();
    if (row.remark?.trim()) current.remarks = Array.from(new Set([...(current.remarks || []), row.remark.trim()]));
    current.buckets[index].cost += amount(row.cost_total);
    current.buckets[index].revenue += amount(row.revenue_total);
    byVehicle.set(key, current);
  });
  return Array.from(byVehicle.values()).sort(lineSort);
}

function isSunday(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay() === 0;
}

function periodHeaders(year: number, month: number | null) {
  if (!month) {
    return ETHIOPIAN_MONTHS.map((name, index) => {
      const monthNumber = index + 1;
      const length = ethiopianMonthLength(year, monthNumber);
      return {
        ethiopian: `${name} ${monthNumber}/${year}`,
        gregorian: `${ethiopianToGregorianIso(year, monthNumber, 1)} to ${ethiopianToGregorianIso(year, monthNumber, length)}`,
        sunday: false,
      };
    });
  }
  return Array.from({ length: ethiopianMonthLength(year, month) }, (_, index) => {
    const day = index + 1;
    const gregorian = ethiopianToGregorianIso(year, month, day);
    return {
      ethiopian: formatEthiopian({ year, month, day }),
      gregorian,
      sunday: isSunday(gregorian),
    };
  });
}

function lineTotals(line: VehicleLine) {
  return line.buckets.reduce((sum, bucket) => ({
    cost: sum.cost + bucket.cost,
    revenue: sum.revenue + bucket.revenue,
  }), { cost: 0, revenue: 0 });
}

function cellStyle(cell: ExcelJS.Cell, bold = false, align: "center" | "left" | "right" = "center") {
  cell.font = { name: "Calibri", size: 11, italic: false, bold };
  cell.alignment = { horizontal: align, vertical: "middle", wrapText: false };
  cell.border = {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  };
}

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  title: string,
  rangeLabel: string,
  headers: { ethiopian: string; gregorian: string; sunday: boolean }[],
  lines: VehicleLine[],
) {
  const sheet = workbook.addWorksheet(name);
  const width = 5 + headers.length * 2 + 3;
  const lastColumn = sheet.getColumn(width).letter;
  sheet.mergeCells(`A1:${lastColumn}1`);
  sheet.getCell("A1").value = COMPANY;
  sheet.mergeCells(`A2:${lastColumn}2`);
  sheet.getCell("A2").value = "SUMMARY PAYMENT";
  sheet.mergeCells(`A3:${lastColumn}3`);
  sheet.getCell("A3").value = title;
  sheet.mergeCells(`A4:${lastColumn}4`);
  sheet.getCell("A4").value = rangeLabel;
  [1, 2, 3, 4].forEach((row) => {
    for (let column = 1; column <= width; column += 1) {
      const cell = sheet.getCell(row, column);
      cellStyle(cell, row <= 2);
      paint(cell, HEADER_GRAY);
      cell.font = { name: "Calibri", size: row <= 2 ? 14 : 16, italic: false, bold: row <= 2, color: { argb: "FF000000" } };
    }
  });
  sheet.getRow(1).height = 27;
  sheet.getRow(2).height = 22;
  sheet.getRow(3).height = 24;
  sheet.getRow(4).height = 24;

  const identity = ["N/O", "Supervisor", "Driver name", "", "Vehicle Type"];
  identity.forEach((label, index) => {
    sheet.mergeCells(5, index + 1, 7, index + 1);
    sheet.getCell(5, index + 1).value = label;
  });
  headers.forEach((header, index) => {
    const start = 6 + index * 2;
    sheet.mergeCells(5, start, 6, start + 1);
    const dateCell = sheet.getCell(5, start);
    dateCell.value = header.ethiopian;
    dateCell.alignment = { horizontal: "center", vertical: "middle", textRotation: 45, wrapText: false };
    sheet.getCell(7, start).value = "cost";
    sheet.getCell(7, start + 1).value = "Revenue";
  });
  sheet.getRow(5).height = 55;
  sheet.getRow(6).height = 20;
  sheet.getRow(7).height = 20;
  const totalStart = 6 + headers.length * 2;
  ["TOTAL REVENUE", "TOTAL COST", "profit/loss"].forEach((label, index) => {
    sheet.mergeCells(5, totalStart + index, 7, totalStart + index);
    sheet.getCell(5, totalStart + index).value = label;
  });
  for (let row = 5; row <= 7; row += 1) {
    for (let column = 1; column <= width; column += 1) {
      const cell = sheet.getCell(row, column);
      cellStyle(cell, true, column === 3 ? "left" : "center");
      paint(cell, HEADER_GRAY);
      cell.font = { name: "Calibri", size: 12, italic: false, bold: true, color: { argb: "FF000000" } };
    }
  }
  headers.forEach((header, index) => {
    const start = 6 + index * 2;
    const dateCell = sheet.getCell(5, start);
    dateCell.alignment = { horizontal: "center", vertical: "bottom", textRotation: 45, wrapText: false };
    dateCell.font = { name: "Calibri", size: 12, italic: false, bold: true, color: { argb: "FF000000" } };
    const costHeader = sheet.getCell(7, start);
    const revenueHeader = sheet.getCell(7, start + 1);
    costHeader.font = { name: "Calibri", size: 14, italic: false, bold: false, color: { argb: "FF000000" } };
    revenueHeader.font = { name: "Calibri", size: 14, italic: false, bold: false, color: { argb: "FF000000" } };
    const headerFill = header.sunday ? EMPTY_GRAY : HEADER_GRAY;
    paint(dateCell, headerFill);
    paint(sheet.getCell(6, start), headerFill);
    paint(sheet.getCell(6, start + 1), headerFill);
    paint(costHeader, headerFill);
    paint(revenueHeader, header.sunday ? EMPTY_GRAY : REVENUE_PEACH);
  });

  const firstDataRow = (sheet.lastRow?.number || 7) + 1;
  lines.forEach((line, index) => {
    const totals = lineTotals(line);
    const values: Array<string | number> = [index + 1, line.supervisor, [line.driver, ...(line.remarks || []).map((remark) => `Remark: ${remark}`)].join("\n"), line.plate, line.vehicleType];
    line.buckets.forEach((bucket, bucketIndex) => {
      const sunday = headers[bucketIndex]?.sunday;
      values.push(sunday && !bucket.cost ? "" : (bucket.cost || ""));
      values.push(sunday && !bucket.revenue ? "" : (bucket.revenue || ""));
    });
    values.push(totals.revenue || "", totals.cost || "", totals.revenue || totals.cost ? totals.revenue - totals.cost : "");
    const added = sheet.addRow(values);
    added.height = 22;
    added.eachCell((cell, column) => {
      const amountColumn = column >= 6;
      cellStyle(cell, false, column === 3 ? "left" : amountColumn ? "right" : "center");
      cell.font = { name: "Calibri", size: 11, italic: false, color: { argb: "FF000000" } };
      if (amountColumn && typeof cell.value === "number") cell.numFmt = "#,##0.00";
      const dayIndex = column >= 6 && column < 6 + headers.length * 2 ? Math.floor((column - 6) / 2) : -1;
      if (dayIndex >= 0 && headers[dayIndex]?.sunday) paint(cell, EMPTY_GRAY);
    });
  });
  lines.forEach((line, index) => {
    const supervisorSpan = repeatedGroupSpan(lines, index, (item) => item.supervisor.toLowerCase());
    if (supervisorSpan > 1) {
      const start = firstDataRow + index;
      sheet.mergeCells(start, 2, start + supervisorSpan - 1, 2);
      const supervisorCell = sheet.getCell(start, 2);
      supervisorCell.value = line.supervisor;
      supervisorCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      supervisorCell.font = { name: "Calibri", size: 11, italic: false };
    }
  });
  const subtotal = lines.reduce((sum, line) => {
    line.buckets.forEach((bucket, index) => {
      sum[index].cost += bucket.cost;
      sum[index].revenue += bucket.revenue;
    });
    return sum;
  }, headers.map(() => ({ cost: 0, revenue: 0 })));
  const subtotalValues: Array<string | number> = ["SUB TOTAL", "", "", "", ""];
  subtotal.forEach((bucket, index) => {
    const sunday = headers[index]?.sunday;
    subtotalValues.push(sunday && !bucket.cost ? "" : bucket.cost, sunday && !bucket.revenue ? "" : bucket.revenue);
  });
  const revenue = subtotal.reduce((sum, bucket) => sum + bucket.revenue, 0);
  const cost = subtotal.reduce((sum, bucket) => sum + bucket.cost, 0);
  subtotalValues.push(revenue, cost, revenue - cost);
  const totalRow = sheet.addRow(subtotalValues);
  totalRow.eachCell((cell, column) => {
    cellStyle(cell, true, column >= 6 ? "right" : "center");
    paint(cell, EMPTY_GRAY);
    cell.font = { name: "Calibri", size: 11, italic: false, bold: true, color: { argb: "FF000000" } };
    if (column >= 6 && typeof cell.value === "number") cell.numFmt = "#,##0.00";
  });
  sheet.columns = [
    { width: 8 }, { width: 22 }, { width: 32 }, { width: 22 }, { width: 18 },
    ...headers.flatMap(() => [{ width: 14 }, { width: 14 }]),
    { width: 18 }, { width: 16 }, { width: 16 },
  ];
}

export default function YearlyReport() {
  const today = gregorianToEthiopian(addisToday());
  const [year, setYear] = useState(today?.year || 2019);
  const [month, setMonth] = useState<number | null>(today?.month || 1);
  const [payload, setPayload] = useState<YearPayload | null>(null);
  const [readState, setReadState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    if (year < 1900 || year > 2200) return;
    let cancelled = false;
    setReadState("loading");
    void fetchCachedJson<YearPayload>(
      `${API_BASE}/reports/yearly-profit?ethiopian_year=${year}`,
      undefined,
      { ttlMs: 60_000, cacheKey: `reports:yearly-profit:v3:${year}`, forceRefresh: true }
    ).then((data) => {
      if (!cancelled) {
        setPayload(data);
        setReadState("ready");
      }
    }).catch(() => {
      if (!cancelled) setReadState("failed");
    });
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ cacheKey: string; data: YearPayload }>).detail;
      if (!cancelled && detail?.cacheKey === `reports:yearly-profit:v3:${year}` && detail.data.ethiopian_year === year) {
        setPayload(detail.data);
        setReadState("ready");
      }
    };
    window.addEventListener("fleet-cache-updated", onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener("fleet-cache-updated", onUpdate);
    };
  }, [year]);

  const rows = payload?.ethiopian_year === year ? payload.rows : [];
  const vehicles = payload?.ethiopian_year === year ? payload.vehicles || [] : [];
  const headers = useMemo(() => periodHeaders(year, month), [year, month]);
  const lines = useMemo(() => buildLines(rows, vehicles, year, month), [rows, vehicles, year, month]);
  const rangeLabel = payload
    ? `Database Gregorian ${payload.gregorian_start} to ${payload.gregorian_end}`
    : "";
  const title = month
    ? `${ETHIOPIAN_MONTHS[month - 1]} ${year} E.C Report payment for vehicle`
    : `${year} E.C Yearly Report payment for vehicle`;

  const download = async () => {
    const workbook = new ExcelJS.Workbook();
    const yearHeaders = periodHeaders(year, null);
    const yearLines = buildLines(rows, vehicles, year, null);
    addSheet(workbook, "Year", `${year} E.C Yearly Report payment for vehicle`, rangeLabel, yearHeaders, yearLines);
    ETHIOPIAN_MONTHS.forEach((name, index) => {
      const monthNumber = index + 1;
      addSheet(
        workbook,
        `${String(monthNumber).padStart(2, "0")} ${name}`.slice(0, 31),
        `${name} ${year} E.C Report payment for vehicle`,
        rangeLabel,
        periodHeaders(year, monthNumber),
        buildLines(rows, vehicles, year, monthNumber),
      );
    });
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Yearly_Report_${year}_EC.xlsx`);
  };

  const box = {
    border: "1px solid #000",
    padding: "4px 6px",
    textAlign: "center" as const,
    fontStyle: "normal" as const,
    fontFamily: "Calibri, Arial, sans-serif",
    color: "#000",
    background: "#fff",
    whiteSpace: "nowrap" as const,
  };
  const nameBox = { ...box, textAlign: "left" as const };
  const amountBox = { ...box, textAlign: "right" as const };
  const titleBand = {
    background: "#d9d9d9",
    color: "#000",
    textAlign: "center" as const,
    fontFamily: "Calibri, Arial, sans-serif",
    padding: "4px 8px",
  };
  const subtotal = lines.reduce((sum, line) => {
    line.buckets.forEach((bucket, index) => {
      sum[index].cost += bucket.cost;
      sum[index].revenue += bucket.revenue;
    });
    return sum;
  }, headers.map(() => ({ cost: 0, revenue: 0 })));
  const subtotalRevenue = subtotal.reduce((sum, bucket) => sum + bucket.revenue, 0);
  const subtotalCost = subtotal.reduce((sum, bucket) => sum + bucket.cost, 0);

  return (
    <div className="fleet-report" style={{ display: "flex", flexDirection: "column", gap: 12, height: "calc(100vh - 180px)", minHeight: 480, fontStyle: "normal" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          Ethiopian year
          <input
            className="fleet-input"
            type="number"
            min={1900}
            max={2200}
            value={year}
            onChange={(event) => setYear(Number(event.target.value) || year)}
            style={{ minHeight: 36, width: 120 }}
          />
        </label>
        <button className="fleet-btn fleet-btn-primary" type="button" onClick={() => void download()} disabled={!payload} style={{ minHeight: 36 }}>
          Download sheet
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className={`report-tab${month === null ? " active" : ""}`} onClick={() => setMonth(null)}>Year</button>
        {ETHIOPIAN_MONTHS.map((name, index) => (
          <button key={name} type="button" className={`report-tab${month === index + 1 ? " active" : ""}`} onClick={() => setMonth(index + 1)}>
            {name}
          </button>
        ))}
      </div>
      {payload?._warning && <div className="login-error">{payload._warning}</div>}
      <div className="yearly-sheet-scroll" style={{ flex: 1, minHeight: 0, maxHeight: "none" }}>
        <table className="yearly-sheet" style={{ fontStyle: "normal" }}>
          <thead>
            <tr>
              <th colSpan={5 + headers.length * 2 + 3} style={{ ...titleBand, fontWeight: 700, fontSize: 16 }}><div className="yearly-title-text">{COMPANY}</div></th>
            </tr>
            <tr>
              <th colSpan={5 + headers.length * 2 + 3} style={{ ...titleBand, fontWeight: 700, fontSize: 16 }}><div className="yearly-title-text">SUMMARY PAYMENT</div></th>
            </tr>
            <tr>
              <th colSpan={5 + headers.length * 2 + 3} style={{ ...titleBand, fontSize: 18 }}><div className="yearly-title-text">{title}</div></th>
            </tr>
            <tr>
              <th colSpan={5 + headers.length * 2 + 3} style={{ ...titleBand, fontSize: 16 }}><div className="yearly-title-text">{rangeLabel}</div></th>
            </tr>
            <tr>
              <th rowSpan={3} className="pin-a" style={{ ...box, background: "#d9d9d9", fontWeight: 700 }}>N/O</th>
              <th rowSpan={3} className="pin-b" style={{ ...box, background: "#d9d9d9", fontWeight: 700 }}>Supervisor</th>
              <th rowSpan={3} style={{ ...nameBox, background: "#d9d9d9", fontWeight: 700 }}>Driver name</th>
              <th rowSpan={3} style={{ ...box, background: "#d9d9d9" }} />
              <th rowSpan={3} style={{ ...box, background: "#d9d9d9", fontWeight: 700 }}>Vehicle Type</th>
              {headers.map((header) => <th key={header.ethiopian} colSpan={2} style={{ ...box, background: header.sunday ? "#808080" : "#d9d9d9" }}>{header.ethiopian}</th>)}
              <th rowSpan={3} style={{ ...box, background: "#d9d9d9", fontWeight: 700 }}>TOTAL REVENUE</th>
              <th rowSpan={3} style={{ ...box, background: "#d9d9d9", fontWeight: 700 }}>TOTAL COST</th>
              <th rowSpan={3} style={{ ...box, background: "#d9d9d9", fontWeight: 700 }}>profit/loss</th>
            </tr>
            <tr>
              {headers.map((header) => <th key={`${header.ethiopian}-gc`} colSpan={2} style={{ ...box, background: header.sunday ? "#808080" : "#d9d9d9" }}>{header.gregorian}</th>)}
            </tr>
            <tr>
              {headers.map((header) => (
                <Fragment key={`${header.ethiopian}-pair`}>
                  <th style={{ ...box, background: header.sunday ? "#808080" : "#d9d9d9" }}>cost</th>
                  <th style={{ ...box, background: header.sunday ? "#808080" : "#fac090" }}>Revenue</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {readState !== "ready" ? (
              <tr><td colSpan={8 + headers.length * 2} style={box}>{readState === "failed" ? "The live database did not answer." : "Reading stored rows."}</td></tr>
            ) : lines.length === 0 ? (
              <tr><td colSpan={8 + headers.length * 2} style={box}>No stored rows for this period.</td></tr>
            ) : lines.map((line, index) => {
              const totals = lineTotals(line);
              const supervisorSpan = repeatedGroupSpan(lines, index, (item) => item.supervisor.toLowerCase());
              return (
                <tr key={line.key}>
                  <td className="pin-a" style={box}>{index + 1}</td>
                  {supervisorSpan > 0 && (
                    <td rowSpan={supervisorSpan} className="pin-b" style={{ ...box, verticalAlign: "middle", textAlign: "center", fontWeight: 700 }}>{line.supervisor}</td>
                  )}
                  <td style={nameBox}>{line.driver}{line.remarks?.map((remark) => <div key={remark} style={{ fontSize: 11, whiteSpace: "normal" }}>Remark: {remark}</div>)}</td>
                  <td style={box}>{line.plate}</td>
                  <td style={box}>{line.vehicleType}</td>
                  {line.buckets.map((bucket, bucketIndex) => {
                    const sunday = headers[bucketIndex]?.sunday;
                    const dayBox = sunday ? { ...amountBox, background: "#808080" } : amountBox;
                    return (
                      <Fragment key={`${line.key}-${bucketIndex}`}>
                        <td style={dayBox}>{sunday && !bucket.cost ? "" : plain(bucket.cost)}</td>
                        <td style={dayBox}>{sunday && !bucket.revenue ? "" : plain(bucket.revenue)}</td>
                      </Fragment>
                    );
                  })}
                  <td style={amountBox}>{plain(totals.revenue)}</td>
                  <td style={amountBox}>{plain(totals.cost)}</td>
                  <td style={amountBox}>{totals.revenue || totals.cost ? plain(totals.revenue - totals.cost) : ""}</td>
                </tr>
              );
            })}
            <tr>
              <td className="pin-a" style={{ ...box, fontWeight: 700, background: "#808080" }} />
              <td className="pin-b" style={{ ...box, fontWeight: 700, background: "#808080" }}>SUB TOTAL</td>
              <td colSpan={3} style={{ ...box, fontWeight: 700, background: "#808080" }} />
              {subtotal.map((bucket, index) => {
                const sunday = headers[index]?.sunday && !bucket.cost && !bucket.revenue;
                const totalBox = { ...amountBox, fontWeight: 700, background: "#808080" };
                return (
                  <Fragment key={index}>
                    <td style={totalBox}>{sunday ? "" : (plain(bucket.cost) || "0")}</td>
                    <td style={totalBox}>{sunday ? "" : (plain(bucket.revenue) || "0")}</td>
                  </Fragment>
                );
              })}
              <td style={{ ...amountBox, fontWeight: 700, background: "#808080" }}>{plain(subtotalRevenue) || "0.00"}</td>
              <td style={{ ...amountBox, fontWeight: 700, background: "#808080" }}>{plain(subtotalCost) || "0.00"}</td>
              <td style={{ ...amountBox, fontWeight: 700, background: "#808080" }}>{plain(subtotalRevenue - subtotalCost) || "0.00"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
