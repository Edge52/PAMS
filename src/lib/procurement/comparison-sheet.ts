/**
 * "Download comparison (Excel)" (wave 37, audit "missing features" 2): one sheet, rows = required items, columns =
 * offers (unit price, quantity, total in the tender currency at the price date, compliance), then totals, scores
 * and ranks. Pure grid builder plus the ExcelJS writer; the route loads the data with loadComparison.
 * A sealed two-envelope tender gets quantities and compliance only: no prices, totals or financial scores.
 */
import ExcelJS from "exceljs";
import type { CellResult, OfferSummary } from "./scoring";

export type SheetOffer = { id: number; supplierName: string; reference: string; currency: string; incoterm: string | null };
export type SheetItem = { key: number; code: string; name: string; required: number | null };
export type SheetInput = {
  title: string; currency: string; priceDate: string;
  /** "net price" or "landed cost (DDP equivalent)". */
  priceBasis: string; sealed: boolean;
  offers: SheetOffer[]; items: SheetItem[];
  cell: (itemKey: number, offerId: number) => CellResult | undefined;
  summary: (offerId: number) => OfferSummary | undefined;
  /** Landed total per offer in the tender currency, when known. */
  landed?: (offerId: number) => number | null;
  rank: (offerId: number) => number | null;
  weights: { technical: number; financial: number };
};

export type GridValue = string | number | null;
export type Grid = {
  /** Sub-columns per offer. */
  perOffer: ("price" | "qty" | "total" | "compliance")[];
  header1: GridValue[]; header2: string[];
  items: GridValue[][];
  totals: { label: string; values: GridValue[]; kind: "money" | "score" | "int" | "text" }[];
};

/** Short compliance text for one cell. */
export function complianceText(c: CellResult | undefined): string {
  if (!c) return "Not quoted";
  const t = c.technical;
  const base = t.itemCount === 0 ? "No spec" : !t.responsive ? `Fails ${t.mandatoryFailed.length} mandatory` : `${Math.round(t.score ?? 0)} % compliant`;
  return c.isOptional ? `${base} (optional)` : base;
}

const r1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);

export function comparisonGrid(i: SheetInput): Grid {
  const perOffer: Grid["perOffer"] = i.sealed ? ["qty", "compliance"] : ["price", "qty", "total", "compliance"];
  const sub = { price: `Unit price (${i.currency})`, qty: "Quantity", total: `Total (${i.currency})`, compliance: "Compliance" };
  const header1: GridValue[] = ["Item", "Code", "Required"];
  const header2: string[] = ["", "", ""];
  for (const o of i.offers) {
    perOffer.forEach((k, j) => { header1.push(j === 0 ? `${o.supplierName} · ${o.reference} (${o.currency}${o.incoterm ? `, ${o.incoterm}` : ""})` : null); header2.push(sub[k]); });
  }
  const items = i.items.map((it) => {
    const row: GridValue[] = [it.name, it.code, it.required];
    for (const o of i.offers) {
      const c = i.cell(it.key, o.id);
      for (const k of perOffer) {
        if (k === "price") row.push(c?.unitPrice ?? null);
        else if (k === "qty") row.push(c ? c.quantity : null);
        else if (k === "total") row.push(c?.lineTotal ?? null);
        else row.push(complianceText(c));
      }
    }
    return row;
  });
  const put = (f: (o: SheetOffer) => GridValue, at: "total" | "compliance") => {
    const out: GridValue[] = [null, null, null];
    for (const o of i.offers) for (const k of perOffer) out.push(k === at ? f(o) : null);
    return out;
  };
  const money = i.sealed ? "compliance" : "total";
  const totals: Grid["totals"] = [];
  if (!i.sealed) {
    totals.push({ label: `Net total (${i.currency})`, kind: "money", values: put((o) => i.summary(o.id)?.total ?? null, "total") });
    if (i.landed) totals.push({ label: `Landed total, DDP equivalent (${i.currency})`, kind: "money", values: put((o) => i.landed!(o.id), "total") });
  }
  totals.push({ label: "Technical score", kind: "score", values: put((o) => r1(i.summary(o.id)?.technicalScore), money) });
  if (!i.sealed) {
    totals.push({ label: "Financial score", kind: "score", values: put((o) => r1(i.summary(o.id)?.financialScore), "total") });
    totals.push({ label: `Combined score (${i.weights.technical}/${i.weights.financial})`, kind: "score", values: put((o) => r1(i.summary(o.id)?.combinedScore), "total") });
    totals.push({ label: "Rank", kind: "int", values: put((o) => i.rank(o.id), "total") });
  }
  totals.push({ label: "Notes", kind: "text", values: put((o) => {
    const s = i.summary(o.id);
    return [s?.notRanked, s && s.nonResponsiveRows > 0 ? `${s.nonResponsiveRows} item(s) non-responsive` : null].filter(Boolean).join(" ") || null;
  }, "compliance") });
  return { perOffer, header1, header2, items, totals };
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D5C4D" } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EEEC" } };
const LINE = { style: "thin" as const, color: { argb: "FFD6DEDB" } };
const BORDER: Partial<ExcelJS.Borders> = { top: LINE, bottom: LINE, left: LINE, right: LINE };

/** The workbook for a grid. */
export function comparisonWorkbook(i: SheetInput, grid = comparisonGrid(i)): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Hospital PAMS";
  const ws = wb.addWorksheet("Comparison", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const moneyFmt = `#,##0.00 "${i.currency}"`;
  const width = grid.perOffer.length;
  ws.columns = [{ width: 34 }, { width: 16 }, { width: 10 }, ...i.offers.flatMap(() => grid.perOffer.map((k) => ({ width: k === "compliance" ? 20 : k === "qty" ? 10 : 16 })))];
  ws.addRow([i.title]).font = { bold: true, size: 14 };
  ws.addRow([i.sealed
    ? "Two-envelope tender: the financial envelopes are sealed, so prices are not included."
    : `Prices after discounts, converted to ${i.currency} at the exchange rates of ${i.priceDate}. Ranked by ${i.priceBasis}${/^landed/i.test(i.priceBasis) ? ": item prices include the costs the hospital pays on top under each Incoterm" : ""}.`]).font = { color: { argb: "FF5A6865" } };
  ws.addRow([]);
  const h1 = ws.addRow(grid.header1), h2 = ws.addRow(grid.header2);
  for (const h of [h1, h2]) {
    h.font = { bold: true, color: { argb: "FFFFFFFF" } }; h.fill = HEADER_FILL; h.alignment = { vertical: "middle", wrapText: true };
    h.eachCell({ includeEmpty: true }, (c) => { c.border = BORDER; });
  }
  i.offers.forEach((_, k) => { const from = 4 + k * width; if (width > 1) ws.mergeCells(h1.number, from, h1.number, from + width - 1); });
  ws.views = [{ state: "frozen", ySplit: h2.number, xSplit: 1 }];
  const kindAt = (col: number) => (col < 3 ? null : grid.perOffer[(col - 3) % width]);
  for (const r of grid.items) {
    const row = ws.addRow(r);
    row.eachCell({ includeEmpty: true }, (c, n) => {
      c.border = BORDER;
      const k = kindAt(n - 1);
      if ((k === "price" || k === "total") && typeof c.value === "number") c.numFmt = moneyFmt;
      if (k === "qty" || n === 3) c.numFmt = "#,##0";
    });
  }
  for (const t of grid.totals) {
    const row = ws.addRow([t.label, ...t.values.slice(1)]);
    row.font = { bold: t.kind !== "text" };
    row.fill = TOTAL_FILL;
    row.eachCell({ includeEmpty: true }, (c) => {
      c.border = BORDER;
      if (typeof c.value === "number") c.numFmt = t.kind === "money" ? moneyFmt : t.kind === "score" ? "0.0" : "0";
    });
  }
  ws.addRow([]);
  ws.addRow([`Technical score = weighted share of spec items complied with; a failed mandatory item makes a line non-responsive. Financial score = lowest responsive price ÷ this price × 100. Combined = technical × ${i.weights.technical} % + financial × ${i.weights.financial} %. Confidential: supplier prices.`]).font = { italic: true, color: { argb: "FF5A6865" } };
  return wb;
}

/** File name for the download. */
export function comparisonFileName(code: string, today: string): string {
  return `Comparison ${code.replace(/[^\w.\- ]+/g, "_")} ${today}.xlsx`;
}
