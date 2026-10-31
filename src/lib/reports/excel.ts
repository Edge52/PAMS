/** Turns a ReportResult into an .xlsx: one sheet per section, title + filter lines, styled header, typed cells, totals. */
import ExcelJS from "exceljs";
import type { Cell, Column, ReportResult, Section } from "./types";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D5C4D" } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EEEC" } };
const LINE = { style: "thin" as const, color: { argb: "FFD6DEDB" } };
const BORDER: Partial<ExcelJS.Borders> = { top: LINE, bottom: LINE, left: LINE, right: LINE };

const DATE_FMT = "dd mmm yyyy";
const INT_FMT = "#,##0";
const PCT_FMT = "0.0%";
const moneyFmt = (cur: string) => `#,##0.00 "${cur}";-#,##0.00 "${cur}"`;

/** Sheet names: ≤ 31 chars, no []:*?/\ and unique. */
export function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base, i = 2;
  while (used.has(name.toLowerCase())) { const suf = ` (${i++})`; name = base.slice(0, 31 - suf.length) + suf; }
  used.add(name.toLowerCase());
  return name;
}

function isoToDate(v: Cell): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const d = new Date(v.slice(0, 10) + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Value + number format for one cell. Exported for tests. */
export function excelCell(col: Column, row: Record<string, Cell>): { value: ExcelJS.CellValue; numFmt?: string } {
  const v = row[col.key];
  if (v === null || v === undefined || v === "") return { value: null };
  switch (col.type) {
    case "date": { const d = isoToDate(v); return d ? { value: d, numFmt: DATE_FMT } : { value: String(v) }; }
    case "int": case "days": return typeof v === "number" ? { value: v, numFmt: INT_FMT } : { value: v };
    case "pct": return typeof v === "number" ? { value: v / 100, numFmt: PCT_FMT } : { value: v };
    case "egp": return typeof v === "number" ? { value: v, numFmt: moneyFmt("EGP") } : { value: v };
    case "money": {
      const cur = (col.currencyKey && typeof row[col.currencyKey] === "string" ? row[col.currencyKey] : "EGP") as string;
      return typeof v === "number" ? { value: v, numFmt: moneyFmt(cur) } : { value: v };
    }
    default: return { value: typeof v === "number" ? v : String(v) };
  }
}

function addSection(wb: ExcelJS.Workbook, used: Set<string>, title: string, s: Section, lines: string[], notes: string[]) {
  const cols = s.columns.filter((c) => c.only !== "screen");
  const ws = wb.addWorksheet(sheetName(s.title ?? title, used), {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width ?? Math.max(10, c.header.length + 2) }));

  const t = ws.addRow([s.title ? `${title} — ${s.title}` : title]);
  t.font = { bold: true, size: 14 };
  for (const l of lines) ws.addRow([l]).font = { color: { argb: "FF5A6865" } };
  ws.addRow([]);

  const header = ws.addRow(cols.map((c) => c.header));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;
  header.eachCell((c) => { c.border = BORDER; });
  cols.forEach((c, i) => {
    if (c.type && c.type !== "text") header.getCell(i + 1).alignment = { vertical: "middle", horizontal: "right", wrapText: true };
  });
  const headerRow = header.number;
  ws.views = [{ state: "frozen", ySplit: headerRow, xSplit: 0 }];

  const write = (data: Record<string, Cell>, bold = false) => {
    const r = ws.addRow([]);
    cols.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      const { value, numFmt } = excelCell(c, data);
      cell.value = value;
      if (numFmt) cell.numFmt = numFmt;
      cell.border = BORDER;
      if (c.type === "text" || !c.type) cell.alignment = { vertical: "top", wrapText: (c.width ?? 0) >= 28 };
    });
    if (bold) { r.font = { bold: true }; r.eachCell({ includeEmpty: true }, (c) => { c.fill = TOTAL_FILL; c.border = BORDER; }); }
  };
  for (const row of s.rows) write(row);
  if (s.rows.length === 0) ws.addRow([s.empty]).font = { italic: true };
  if (s.rows.length) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + s.rows.length, column: cols.length } };
  }
  if (s.totals && s.rows.length) write(s.totals, true);

  if (notes.length) {
    ws.addRow([]);
    for (const n of notes) ws.addRow([n]).font = { italic: true, color: { argb: "FF5A6865" } };
  }
}

export async function reportWorkbook(title: string, result: ReportResult, filterLines: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Hospital PAMS";
  wb.created = new Date();
  wb.title = title;
  const used = new Set<string>();
  const summary = result.summary?.length ? [result.summary.map((s) => `${s.label}: ${s.value}`).join(" · ")] : [];
  for (const s of result.sections) addSection(wb, used, title, s, [...filterLines, ...summary], result.notes ?? []);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

/** Safe file name: "tender-status-2026-10-29.xlsx". */
export function exportFileName(slug: string, today: string): string {
  return `${slug.replace(/[^a-z0-9-]/gi, "")}-${today}.xlsx`;
}
