import "server-only";
/** Reading an uploaded import file (wave 41): .xlsx (first sheet, or the named one) or .csv. Size and row caps. */
import ExcelJS from "exceljs";
import { mapColumns, parseCsv, type Column } from "./table";

export const MAX_ROWS = 2000;
const MAX_BYTES = 10 * 1024 * 1024;

export type ReadResult<K extends string> =
  | { error: string }
  | { fileName: string; unknown: string[]; rows: { rowNumber: number; cells: Partial<Record<K, unknown>> }[] };

export async function readUpload<K extends string>(file: FormDataEntryValue | null, columns: Column<K>[], sheet?: string): Promise<ReadResult<K>> {
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the filled-in template (.xlsx or .csv) to upload." };
  if (file.size > MAX_BYTES) return { error: "The file must be 10 MB or smaller." };
  let grid: unknown[][];
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    grid = parseCsv(await file.text());
  } else {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer); }
    catch { return { error: "That file is not a readable .xlsx workbook or .csv file. Save it as Excel Workbook (.xlsx) or CSV and try again." }; }
    const ws = (sheet ? wb.getWorksheet(sheet) : undefined) ?? wb.worksheets[0];
    if (!ws) return { error: "The workbook has no sheets." };
    grid = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => { grid[n - 1] = (row.values as unknown[]).slice(1); });
    grid = Array.from(grid, (r) => r ?? []);
  }
  if (!grid.length) return { error: "The file is empty." };
  const { map, missing, unknown } = mapColumns(grid[0], columns);
  if (missing.length) return { error: `The first row must hold the column headers. Missing: ${missing.join(", ")}. Download the template to start from.` };
  const rows: { rowNumber: number; cells: Partial<Record<K, unknown>> }[] = [];
  grid.slice(1).forEach((vals, i) => {
    if (!vals.some((v) => v !== null && v !== undefined && String(v).trim() !== "")) return;
    const cells: Partial<Record<K, unknown>> = {};
    for (const [idx, key] of map) cells[key] = vals[idx];
    rows.push({ rowNumber: i + 2, cells });
  });
  if (!rows.length) return { error: "The file has headers but no data rows." };
  if (rows.length > MAX_ROWS) return { error: `That file has ${rows.length} rows; import at most ${MAX_ROWS} at a time.` };
  return { fileName: file.name, unknown, rows };
}

/** An .xlsx template: the data sheet with headers, notes and an example row, a "How to fill" sheet, and any lists. */
export async function templateResponse(fileName: string, sheetName: string, columns: Column[], lists: { name: string; header: string[]; rows: (string | number | null)[][] }[] = [], tip?: string): Promise<Response> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Hospital PAMS";
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: Math.max(14, c.header.length + 4) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).eachCell((cell, i) => { cell.note = columns[i - 1].hint; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFEB" } }; });
  ws.addRow(Object.fromEntries(columns.map((c) => [c.key, c.example])));
  ws.getRow(2).font = { italic: true, color: { argb: "FF5A6865" } };
  const help = wb.addWorksheet("How to fill");
  help.columns = [{ header: "Column", key: "h", width: 26 }, { header: "Required", key: "r", width: 10 }, { header: "What to enter", key: "d", width: 90 }];
  help.getRow(1).font = { bold: true };
  for (const c of columns) help.addRow({ h: c.header, r: c.required ? "Yes" : "", d: c.hint });
  help.addRow({});
  help.addRow({ h: "Tip", d: tip ?? "Delete the example row (row 2) before importing. You can also save the sheet as CSV and upload that." });
  for (const l of lists) {
    const s = wb.addWorksheet(l.name);
    s.addRow(l.header).font = { bold: true };
    for (const r of l.rows) s.addRow(r);
    s.columns.forEach((c) => { c.width = 28; });
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "no-store",
  } });
}
