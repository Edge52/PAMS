/**
 * Daily exam counts imported from a file (wave 38, audit #15). Pure.
 *
 * The app has no network link to the modalities, so the counts come from a CSV or Excel export of the RIS/PACS (or
 * the modality's own log): one row per device per day, optionally per procedure. A row names the device by its asset
 * tag or by its DICOM AE title (mapped to the device on its page). Re-importing a device's day replaces that day.
 * The month totals then go into imaging use (imaging_usage), which already feeds the Imaging use page and the
 * usage-based PPM, so there is one usage store.
 *
 * Columns (header names are matched loosely, any order): device (tag or AE title), date, exams; optional modality and
 * procedure. Dates: YYYY-MM-DD, DD/MM/YYYY, Excel dates.
 */
import { addDays, daysBetween, isISODate } from "./dates";
import { parseDateCell } from "./import";

export const EXAM_MAX_ROWS = 20000;
export const EXAM_MAX_PER_DAY = 10000;

export type ExamKey = "device" | "date" | "exams" | "modality" | "procedure";
const HEADERS: Record<ExamKey, string[]> = {
  device: ["device", "device tag", "asset tag", "tag", "ae title", "aetitle", "ae", "station ae title", "station aet", "station", "station name", "modality ae", "calling ae title"],
  date: ["date", "day", "study date", "exam date", "performed date", "scan date"],
  exams: ["exams", "exam count", "count", "studies", "study count", "number of exams", "no. of exams", "procedures count", "total"],
  modality: ["modality", "mod"],
  procedure: ["procedure", "procedure name", "exam", "exam type", "study description", "description", "body part"],
};
const norm = (h: unknown) => String(h ?? "").trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");

/** Column index per field from the header row; `missing` lists required fields not found. */
export function mapExamHeaders(header: unknown[]): { map: Map<ExamKey, number>; missing: string[] } {
  const map = new Map<ExamKey, number>();
  header.forEach((h, i) => {
    const n = norm(h);
    for (const k of Object.keys(HEADERS) as ExamKey[]) if (!map.has(k) && HEADERS[k].includes(n)) map.set(k, i);
  });
  const missing = (["device", "date", "exams"] as const).filter((k) => !map.has(k)).map((k) => ({ device: "device tag or AE title", date: "date", exams: "exam count" }[k]));
  return { map, missing };
}

/** Minimal RFC 4180 reader: commas or semicolons (or tabs), quoted fields, CRLF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t"].map((c) => [c, firstLine.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export type ExamLookup = { assetId: number; tag: string; facilityId: number };
export type ExamLookups = { byTag: Map<string, ExamLookup>; byAe: Map<string, ExamLookup> };
export type ExamRow = { rowNumber: number; device: string; date: string; exams: string; modality: string; procedure: string; errors: string[]; tag?: string };
export type ValidExam = { assetId: number; tag: string; day: string; procedure: string; modality: string | null; exams: number };

const cellStr = (v: unknown) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());

/**
 * Check every row. Rows of the same device, day and procedure add up (a RIS export with one row per study type
 * still gives the day's total). `today` stops future dates.
 */
export function validateExamRows(raw: { rowNumber: number; cells: unknown[] }[], map: Map<ExamKey, number>, lk: ExamLookups, today: string):
  { rows: ExamRow[]; valid: ValidExam[] } {
  const rows: ExamRow[] = [];
  const sums = new Map<string, ValidExam>();
  for (const r of raw) {
    const get = (k: ExamKey) => (map.has(k) ? r.cells[map.get(k)!] : undefined);
    const device = cellStr(get("device")), examsRaw = get("exams"), dateRaw = get("date");
    const row: ExamRow = { rowNumber: r.rowNumber, device, date: cellStr(dateRaw), exams: cellStr(examsRaw), modality: cellStr(get("modality")).toUpperCase().slice(0, 16), procedure: cellStr(get("procedure")).slice(0, 200), errors: [] };
    const key = device.toUpperCase();
    const hit = key ? lk.byTag.get(key) ?? lk.byAe.get(key) : undefined;
    if (!device) row.errors.push("No device tag or AE title.");
    else if (!hit) row.errors.push(`"${device}" is not a device tag or AE title you can see. Add the AE title on the device's page.`);
    const day = parseDateCell(dateRaw);
    if (day === null || day === "invalid" || !isISODate(day)) row.errors.push("Date must be YYYY-MM-DD or DD/MM/YYYY.");
    else { row.date = day; if (day > today) row.errors.push("The date is in the future."); }
    const n = typeof examsRaw === "number" ? examsRaw : Number(cellStr(examsRaw).replace(/,/g, ""));
    if (cellStr(examsRaw) === "" || !Number.isInteger(n) || n < 0 || n > EXAM_MAX_PER_DAY) row.errors.push(`Exam count must be a whole number from 0 to ${EXAM_MAX_PER_DAY.toLocaleString("en")}.`);
    if (hit) row.tag = hit.tag;
    rows.push(row);
    if (row.errors.length) continue;
    const k = `${hit!.assetId}|${row.date}|${row.procedure.toLowerCase()}`;
    const prev = sums.get(k);
    if (prev) prev.exams += n;
    else sums.set(k, { assetId: hit!.assetId, tag: hit!.tag, day: row.date, procedure: row.procedure, modality: row.modality || null, exams: n });
  }
  const valid = [...sums.values()];
  // A day's total can't pass the cap either.
  const dayTotals = new Map<string, number>();
  for (const v of valid) dayTotals.set(`${v.assetId}|${v.day}`, (dayTotals.get(`${v.assetId}|${v.day}`) ?? 0) + v.exams);
  const over = new Set([...dayTotals].filter(([, n]) => n > EXAM_MAX_PER_DAY).map(([k]) => k));
  if (over.size) {
    for (const r of rows) if (!r.errors.length && r.tag) {
      const v = valid.find((x) => x.tag === r.tag && x.day === r.date);
      if (v && over.has(`${v.assetId}|${v.day}`)) r.errors.push(`More than ${EXAM_MAX_PER_DAY.toLocaleString("en")} exams on one day.`);
    }
    return { rows, valid: valid.filter((v) => !over.has(`${v.assetId}|${v.day}`)) };
  }
  return { rows, valid };
}

/** The device-days a set of rows covers ("assetId|day"), i.e. what an import replaces. */
export const deviceDays = (valid: ValidExam[]) => [...new Set(valid.map((v) => `${v.assetId}|${v.day}`))];

/** Month totals of daily counts: "YYYY-MM-01" → exams. */
export function monthTotals(days: { day: string; exams: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of days) { const k = `${d.day.slice(0, 7)}-01`; m.set(k, (m.get(k) ?? 0) + d.exams); }
  return m;
}

export type Utilisation = {
  days: number; total: number; perDay: number; perWeek: number; activeDays: number; busiest: { day: string; exams: number } | null;
  /** Totals of the last `weeks` 7-day blocks ending today, oldest first. */
  weekly: { start: string; exams: number }[];
  lastDay: string | null;
};

/** Exams per day and per week over the `days` days ending today (calendar days, so idle days count). */
export function utilisation(rows: { day: string; exams: number }[], today: string, days = 28, weeks = 12): Utilisation {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.exams);
  const from = addDays(today, -(days - 1));
  let total = 0, active = 0, busiest: { day: string; exams: number } | null = null;
  for (const [day, n] of byDay) {
    if (day < from || day > today) continue;
    total += n; if (n > 0) active++;
    if (!busiest || n > busiest.exams) busiest = { day, exams: n };
  }
  const weekly = Array.from({ length: weeks }, (_, i) => {
    const end = addDays(today, -7 * (weeks - 1 - i)), start = addDays(end, -6);
    let n = 0;
    for (const [day, x] of byDay) if (day >= start && day <= end) n += x;
    return { start, exams: n };
  });
  const lastDay = [...byDay.keys()].sort().at(-1) ?? null;
  return { days, total, perDay: total / days, perWeek: (total / days) * 7, activeDays: active, busiest, weekly, lastDay };
}

/** Days since the latest imported day (null when none). */
export const daysSinceImport = (lastDay: string | null, today: string) => (lastDay ? daysBetween(lastDay, today) : null);

/** A DICOM AE title: 1–16 characters, no backslash or control characters; stored upper case. */
export function cleanAeTitle(v: string): string | null {
  const t = v.trim().toUpperCase();
  return t.length >= 1 && t.length <= 16 && /^[\x20-\x7E]+$/.test(t) && !t.includes("\\") ? t : null;
}
