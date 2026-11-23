export type CalendarDate = { year: number; month: number; day: number };

const ETHIOPIC_EPOCH = 1723856;
const ETHIOPIC_TO_JDN_OFFSET = 1724220;

export function gregorianToJdn(year: number, month: number, day: number) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

export function jdnToGregorian(jdn: number): CalendarDate {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

export function jdnToEthiopian(jdn: number): CalendarDate {
  const r = (jdn - ETHIOPIC_EPOCH) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  return {
    year: 4 * Math.floor((jdn - ETHIOPIC_EPOCH) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
    month: Math.floor(n / 30) + 1,
    day: (n % 30) + 1,
  };
}

export function ethiopianToJdn(year: number, month: number, day: number) {
  return day + (month - 1) * 30 + (year - 1) * 365 + Math.floor(year / 4) + ETHIOPIC_TO_JDN_OFFSET;
}

export function parseIsoDate(iso: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) return null;
  return date;
}

export function gregorianToEthiopian(iso: string): CalendarDate | null {
  const date = parseIsoDate(iso);
  if (!date) return null;
  return jdnToEthiopian(gregorianToJdn(date.year, date.month, date.day));
}

export function formatEthiopian(date: CalendarDate) {
  return `${date.day}/${date.month}/${date.year}`;
}

export function ethiopianLabel(iso: string) {
  const date = gregorianToEthiopian(iso);
  return date ? `${formatEthiopian(date)} E.C` : "";
}

export function isoFromCalendar(date: CalendarDate) {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function ethiopianToGregorianIso(year: number, month: number, day: number) {
  return isoFromCalendar(jdnToGregorian(ethiopianToJdn(year, month, day)));
}

export function ethiopianYearBounds(year: number) {
  const start = jdnToGregorian(ethiopianToJdn(year, 1, 1));
  const nextStart = jdnToGregorian(ethiopianToJdn(year + 1, 1, 1));
  const end = jdnToGregorian(gregorianToJdn(nextStart.year, nextStart.month, nextStart.day) - 1);
  return {
    start: isoFromCalendar(start),
    end: isoFromCalendar(end),
  };
}

export function ethiopianMonthLength(year: number, month: number) {
  if (month < 13) return 30;
  return year % 4 === 3 ? 6 : 5;
}

export const ETHIOPIAN_MONTHS = [
  "Meskerem",
  "Tikimt",
  "Hidar",
  "Tahsas",
  "Tir",
  "Yekatit",
  "Megabit",
  "Miazia",
  "Ginbot",
  "Sene",
  "Hamle",
  "Nehase",
  "Pagume",
];
