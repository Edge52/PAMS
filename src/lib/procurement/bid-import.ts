/**
 * Supplier bids by Excel (wave 38, audit "missing features" 13). Pure: the template writer, the reader and the
 * validator. The route (rfqs/[id]/bid-template) writes the template; the RFQ page's import actions read a filled
 * one, validate it against the RFQ and save a "Received" offer (see bid-import-server.ts).
 *
 * The workbook has three sheets:
 *  - "Bid": the offer header (reference, dates, currency, Incoterm, payment terms) as label | value rows, then one
 *    row per RFQ line with blank columns for quantity, unit price, discount, make, model, origin, delivery, warranty.
 *  - "Compliance": one row per specification item of each line, with Yes / No / Partial, offered value, remark, page.
 *  - "Read me": how to fill it in.
 * Hidden tags (`rfq:<id>`, `supplier:<id>`, spec item ids) tie a file to its RFQ and its supplier.
 */
import ExcelJS from "exceljs";

/* ───────────── Shapes ───────────── */

export type TemplateSpecItem = { id: number; section: string | null; parameter: string; requirement: string; unit: string | null; mandatory: boolean };
export type TemplateLine = { deviceTypeId: number; code: string; name: string; quantity: number | null; departments: string[]; boqLineIds: number[]; specItems: TemplateSpecItem[] };
export type TemplateInput = {
  rfqId: number; rfqNumber: string; title: string; projectCode: string; closingDate: string | null;
  supplier: { id: number; name: string } | null; lines: TemplateLine[];
};

export type Cell = string | number | null;
export type RawBidLine = {
  row: number; code: Cell; quantity: Cell; unitPrice: Cell; discountPct: Cell; make: Cell; model: Cell; country: Cell;
  deliveryWeeks: Cell; warrantyMonths: Cell; remark: Cell;
};
export type RawCompliance = { row: number; code: Cell; specItemId: Cell; answer: Cell; offeredValue: Cell; remark: Cell; pageRef: Cell };
/** What was read from a workbook: plain values only, so it can travel from the check step to the import step. */
export type RawBid = {
  rfqTag: Cell; supplierTag: Cell;
  header: { reference: Cell; offerDate: Cell; validUntil: Cell; currency: Cell; incoterm: Cell; paymentTerms: Cell };
  lines: RawBidLine[]; compliance: RawCompliance[];
  /** Problems found while reading (a missing sheet or heading). */
  problems: string[];
};

export type ComplianceStatus = "COMPLIES" | "PARTIAL" | "NOT_COMPLIANT" | "NOT_STATED";
export type ParsedCompliance = { specItemId: number; status: ComplianceStatus; offeredValue: string | null; remark: string | null; pageRef: string | null };
export type ParsedLine = {
  deviceTypeId: number; code: string; name: string; boqLineId: number | null;
  quantity: number; unitPrice: number; discountPct: number; manufacturer: string | null; model: string | null; countryOfOrigin: string | null;
  deliveryWeeks: number | null; warrantyMonths: number | null; remark: string | null; compliance: ParsedCompliance[];
};
export type BidHeader = { reference: string; offerDate: string; validUntil: string | null; currency: string; incoterm: string | null; paymentTerms: string | null };
export type Issue = { where: string; message: string };
export type BidCheck = {
  errors: Issue[]; warnings: Issue[]; header: BidHeader | null; lines: ParsedLine[];
  /** RFQ lines the file leaves without a price (not quoted). */
  notQuoted: string[];
  /** Offer-level delivery (longest line) and warranty (shortest line). */
  deliveryWeeks: number | null; warrantyMonths: number | null;
};

export const INCOTERM_CODES = ["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"] as const;
export const ANSWERS = ["Yes", "No", "Partial"] as const;
const SHEET = { bid: "Bid", compliance: "Compliance", readme: "Read me" } as const;
const HEADER_LABELS = {
  reference: "Quotation reference", offerDate: "Offer date", validUntil: "Valid until", currency: "Currency",
  incoterm: "Incoterm", paymentTerms: "Payment terms",
} as const;
const LINE_COLS = ["#", "Code", "Item", "Quantity", "Unit price", "Discount %", "Make", "Model", "Country of origin", "Delivery (weeks)", "Warranty (months)", "Remarks"] as const;
const COMP_COLS = ["Code", "Item", "Ref", "Section", "Parameter", "Requirement", "Unit", "Mandatory", "Complies (Yes / No / Partial)", "Offered value", "Remark", "Page in offer"] as const;
export const MAX_ROWS = 3000;

/* ───────────── Template ───────────── */

/** "RFQ-2026-0003 bid template - Supplier.xlsx", safe as a file name. */
export function bidTemplateFileName(rfqNumber: string, supplier: string | null): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${clean(rfqNumber)} bid template${supplier ? ` - ${clean(supplier).slice(0, 60)}` : ""}.xlsx`;
}

/** The blank bid template for an RFQ (optionally made out to one invited supplier). No prices: safe to send. */
export function bidTemplateWorkbook(t: TemplateInput): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Hospital PAMS";
  const ws = wb.addWorksheet(SHEET.bid);
  ws.columns = [{ width: 5 }, { width: 16 }, { width: 40 }, { width: 10 }, { width: 14 }, { width: 11 }, { width: 16 }, { width: 18 }, { width: 16 }, { width: 13 }, { width: 14 }, { width: 36 }, { width: 14 }];
  ws.getCell("A1").value = `Bid for ${t.rfqNumber} — ${t.title}`;
  ws.getCell("A1").font = { bold: true, size: 13 };
  ws.getCell("A2").value = `Tender ${t.projectCode}${t.closingDate ? `. Closing date ${t.closingDate}` : ""}. Fill in the white cells; don't change the codes, the Ref column or the grey cells.`;
  ws.getCell("A2").font = { italic: true, size: 9 };
  const head: [string, Cell][] = [
    ["RFQ", t.rfqNumber], ["Supplier", t.supplier?.name ?? ""],
    [HEADER_LABELS.reference, ""], [`${HEADER_LABELS.offerDate} (YYYY-MM-DD)`, ""], [`${HEADER_LABELS.validUntil} (YYYY-MM-DD)`, ""],
    [`${HEADER_LABELS.currency} (USD, EUR, EGP…)`, ""], [`${HEADER_LABELS.incoterm} (EXW, FOB, CIF, DAP, DDP…)`, ""], [HEADER_LABELS.paymentTerms, ""],
  ];
  head.forEach(([label, value], i) => {
    const r = ws.getRow(3 + i);
    r.getCell(1).value = label; ws.mergeCells(3 + i, 1, 3 + i, 2);
    r.getCell(3).value = value;
    r.getCell(1).font = { bold: true };
  });
  // Hidden tags tie the file to its RFQ and supplier.
  ws.getCell("M3").value = `rfq:${t.rfqId}`;
  ws.getCell("M4").value = t.supplier ? `supplier:${t.supplier.id}` : "";
  ws.getColumn(13).hidden = true;
  ws.getCell("C6").numFmt = "yyyy-mm-dd"; ws.getCell("C7").numFmt = "yyyy-mm-dd";
  ws.getCell("C9").dataValidation = { type: "list", allowBlank: true, formulae: [`"${INCOTERM_CODES.join(",")}"`] };

  const hr = ws.getRow(12);
  LINE_COLS.forEach((h, i) => { hr.getCell(i + 1).value = h; });
  hr.font = { bold: true };
  hr.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF4" } }; c.border = { bottom: { style: "thin" } }; });
  const grey: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
  t.lines.forEach((l, i) => {
    const r = ws.getRow(13 + i);
    r.getCell(1).value = i + 1; r.getCell(2).value = l.code; r.getCell(3).value = l.name + (l.departments.length ? ` (${l.departments.join(", ")})` : "");
    r.getCell(4).value = l.quantity ?? null;
    [1, 2, 3].forEach((c) => { r.getCell(c).fill = grey; });
    r.getCell(5).numFmt = "#,##0.00"; r.getCell(6).numFmt = "0.##";
    r.getCell(5).dataValidation = { type: "decimal", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], showErrorMessage: true, error: "Enter a price (a number)." };
    r.getCell(6).dataValidation = { type: "decimal", operator: "between", allowBlank: true, formulae: [0, 100], showErrorMessage: true, error: "Discount is a % from 0 to 100." };
  });

  const cs = wb.addWorksheet(SHEET.compliance, { views: [{ state: "frozen", ySplit: 1 }] });
  cs.columns = [{ width: 16 }, { width: 28 }, { width: 8 }, { width: 16 }, { width: 30 }, { width: 30 }, { width: 8 }, { width: 10 }, { width: 14 }, { width: 24 }, { width: 32 }, { width: 12 }];
  const ch = cs.getRow(1);
  COMP_COLS.forEach((h, i) => { ch.getCell(i + 1).value = h; });
  ch.font = { bold: true };
  ch.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF4" } }; });
  let row = 2;
  for (const l of t.lines) {
    for (const s of l.specItems) {
      const r = cs.getRow(row++);
      r.values = [l.code, l.name, s.id, s.section ?? "", s.parameter, s.requirement, s.unit ?? "", s.mandatory ? "Mandatory" : "Optional"];
      for (let c = 1; c <= 8; c++) r.getCell(c).fill = grey;
      r.getCell(9).dataValidation = { type: "list", allowBlank: true, formulae: [`"${ANSWERS.join(",")}"`], showErrorMessage: true, error: "Answer Yes, No or Partial." };
    }
  }
  if (row === 2) cs.getCell("A2").value = "No specification items: the RFQ's lines have no specifications yet.";

  const rm = wb.addWorksheet(SHEET.readme);
  rm.getColumn(1).width = 110;
  [
    `How to fill in this bid for ${t.rfqNumber}`,
    "",
    "1. Bid sheet, top: your quotation reference, the offer date, how long the offer is valid, the currency and the Incoterm.",
    "2. Bid sheet, one row per item: the unit price (a number, no currency sign), any discount in %, make, model, country of origin, delivery in weeks and warranty in months.",
    "   Leave the unit price blank for an item you don't quote. A blank quantity means the quantity asked for.",
    "3. Compliance sheet: for every item you quote, answer each specification line Yes, No or Partial. Mandatory lines must be answered.",
    "   Give the offered value and, for No or Partial, a remark. Put the page of your datasheet where it is shown.",
    "4. Don't change the codes, the Ref column or the grey cells, and don't add or remove rows.",
    "5. Send the file back with your signed offer documents. The offer documents are what count; this file speeds up data entry.",
  ].forEach((line, i) => { rm.getCell(i + 1, 1).value = line; if (i === 0) rm.getCell(1, 1).font = { bold: true, size: 13 }; });
  return wb;
}

/* ───────────── Reading ───────────── */

/** A cell's value as plain text or number (formulas give their result, dates become YYYY-MM-DD). */
export function cellValue(v: ExcelJS.CellValue | undefined): Cell {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ("richText" in v) return cellValue((v as ExcelJS.CellRichTextValue).richText.map((p) => p.text).join(""));
    if ("text" in v) return cellValue((v as ExcelJS.CellHyperlinkValue).text);
    if ("error" in v) return null;
  }
  return null;
}

const norm = (s: Cell) => String(s ?? "").toLowerCase().replace(/[^a-z%]+/g, " ").trim();

/** Read a filled bid workbook into plain values. Never throws on odd content; problems are listed. */
export function readBidWorkbook(wb: ExcelJS.Workbook): RawBid {
  const raw: RawBid = { rfqTag: null, supplierTag: null, header: { reference: null, offerDate: null, validUntil: null, currency: null, incoterm: null, paymentTerms: null }, lines: [], compliance: [], problems: [] };
  const ws = wb.getWorksheet(SHEET.bid);
  if (!ws) { raw.problems.push(`The file has no "${SHEET.bid}" sheet. Use the bid template downloaded from this RFQ.`); return raw; }
  // Tags: hidden column M, but look anywhere in the first rows in case columns were moved.
  for (let r = 1; r <= 12; r++) {
    ws.getRow(r).eachCell((c) => {
      const v = cellValue(c.value);
      if (typeof v === "string" && /^rfq:\d+$/.test(v)) raw.rfqTag = v;
      if (typeof v === "string" && /^supplier:\d+$/.test(v)) raw.supplierTag = v;
    });
  }
  // Header block: label in column A, value in the first filled cell after it.
  let headerRow = 0;
  const last = Math.min(ws.rowCount, MAX_ROWS + 20);
  for (let r = 1; r <= last && !headerRow; r++) {
    const row = ws.getRow(r);
    const label = norm(cellValue(row.getCell(1).value));
    if (cellValue(row.getCell(1).value) === "#" || (norm(cellValue(row.getCell(2).value)) === "code" && norm(cellValue(row.getCell(5).value)).startsWith("unit price"))) { headerRow = r; break; }
    let value: Cell = null;
    for (let c = 3; c <= 6 && value == null; c++) { const v = cellValue(row.getCell(c).value); if (v != null && !(typeof v === "string" && /^(rfq|supplier):/.test(v))) value = v; }
    for (const [k, l] of Object.entries(HEADER_LABELS) as [keyof RawBid["header"], string][]) {
      if (label.startsWith(norm(l))) raw.header[k] = value;
    }
  }
  if (!headerRow) { raw.problems.push(`The "${SHEET.bid}" sheet has no item table (a heading row with Code and Unit price).`); return raw; }
  const cols = new Map<string, number>();
  ws.getRow(headerRow).eachCell((c, n) => cols.set(norm(cellValue(c.value)), n));
  const col = (name: string) => cols.get(norm(name)) ?? LINE_COLS.indexOf(name as (typeof LINE_COLS)[number]) + 1;
  const get = (row: ExcelJS.Row, name: string) => cellValue(row.getCell(col(name)).value);
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    if (raw.lines.length > MAX_ROWS) { raw.problems.push(`More than ${MAX_ROWS} item rows: the file is too big.`); break; }
    const row = ws.getRow(r);
    const line: RawBidLine = {
      row: r, code: get(row, "Code"), quantity: get(row, "Quantity"), unitPrice: get(row, "Unit price"), discountPct: get(row, "Discount %"),
      make: get(row, "Make"), model: get(row, "Model"), country: get(row, "Country of origin"), deliveryWeeks: get(row, "Delivery (weeks)"),
      warrantyMonths: get(row, "Warranty (months)"), remark: get(row, "Remarks"),
    };
    const { row: _r, ...vals } = line;
    void _r;
    if (Object.values(vals).every((v) => v == null)) continue;
    raw.lines.push(line);
  }
  const cs = wb.getWorksheet(SHEET.compliance);
  if (cs) {
    const ccols = new Map<string, number>();
    cs.getRow(1).eachCell((c, n) => ccols.set(norm(cellValue(c.value)), n));
    const ccol = (name: string) => ccols.get(norm(name)) ?? COMP_COLS.indexOf(name as (typeof COMP_COLS)[number]) + 1;
    const cget = (row: ExcelJS.Row, name: string) => cellValue(row.getCell(ccol(name)).value);
    for (let r = 2; r <= cs.rowCount; r++) {
      if (raw.compliance.length > MAX_ROWS * 10) { raw.problems.push("Too many compliance rows: the file is too big."); break; }
      const row = cs.getRow(r);
      const c: RawCompliance = { row: r, code: cget(row, "Code"), specItemId: cget(row, "Ref"), answer: cget(row, "Complies (Yes / No / Partial)"), offeredValue: cget(row, "Offered value"), remark: cget(row, "Remark"), pageRef: cget(row, "Page in offer") };
      if (c.specItemId == null && c.answer == null && c.offeredValue == null && c.remark == null) continue;
      raw.compliance.push(c);
    }
  }
  return raw;
}

/** Load a workbook from an uploaded file's bytes and read it. */
export async function readBidFile(bytes: ArrayBuffer): Promise<RawBid> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(bytes); } catch {
    return { ...readBidWorkbook(new ExcelJS.Workbook()), problems: ["The file couldn't be opened as an Excel workbook (.xlsx). Save it as .xlsx and try again."] };
  }
  return readBidWorkbook(wb);
}

/* ───────────── Validation ───────────── */

const text = (v: Cell, max: number): string | null => (v == null ? null : String(v).trim().slice(0, max) || null);

/** A number from a cell: numbers as they are; text with thousands separators or a currency sign is read too. */
export function cellNumber(v: Cell): number | null | "bad" {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const s = v.replace(/[\s,]/g, "").replace(/^(usd|eur|egp|gbp|\$|€|£)/i, "").replace(/%$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return "bad";
  return Number(s);
}

/** "2026-11-23", "23/11/2026" or "23-11-2026" (day first, as in Egypt) → "2026-11-23". */
export function cellDate(v: Cell): string | null | "bad" {
  if (v == null) return null;
  if (typeof v === "number") {
    // An Excel serial day number (1900 date system).
    if (v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
    return "bad";
  }
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; } else if (dmy) { d = +dmy[1]; m = +dmy[2]; y = +dmy[3]; } else return "bad";
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return "bad";
  return t.toISOString().slice(0, 10);
}

/** Yes / No / Partial (and a few common spellings) → compliance status; null = no answer; "bad" = unreadable. */
export function answerStatus(v: Cell): ComplianceStatus | null | "bad" {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (["yes", "y", "complies", "comply", "compliant", "✓"].includes(s)) return "COMPLIES";
  if (["no", "n", "not compliant", "does not comply", "non compliant", "non-compliant", "✗"].includes(s)) return "NOT_COMPLIANT";
  if (["partial", "partly", "p", "partially"].includes(s)) return "PARTIAL";
  return "bad";
}

const intIn = (v: Cell, min: number, max: number): number | null | "bad" => {
  const n = cellNumber(v);
  if (n == null || n === "bad") return n;
  return Number.isInteger(n) && n >= min && n <= max ? n : "bad";
};

/**
 * Check a read bid against the RFQ. Errors stop the import; warnings are shown. Lines without a unit price are
 * not quoted (no offer line); their compliance rows are ignored.
 */
export function validateBid(raw: RawBid, ctx: { rfqId: number; supplierId: number; lines: TemplateLine[] }): BidCheck {
  const errors: Issue[] = raw.problems.map((m) => ({ where: "File", message: m }));
  const warnings: Issue[] = [];
  const out: BidCheck = { errors, warnings, header: null, lines: [], notQuoted: [], deliveryWeeks: null, warrantyMonths: null };
  if (raw.problems.length && !raw.lines.length) return out;

  if (raw.rfqTag == null) errors.push({ where: "File", message: "This isn't a bid template from Hospital PAMS (its RFQ mark is missing). Download the template from this RFQ." });
  else if (raw.rfqTag !== `rfq:${ctx.rfqId}`) errors.push({ where: "File", message: "This file is the bid template of another RFQ. Download the template from this RFQ." });
  if (raw.supplierTag && raw.supplierTag !== `supplier:${ctx.supplierId}`) errors.push({ where: "File", message: "This file was made out to another supplier. Choose that supplier, or use a template made out to this one." });

  // Header
  const h = raw.header;
  const reference = text(h.reference, 64);
  if (!reference) errors.push({ where: "Bid sheet", message: "Fill in the quotation reference." });
  const offerDate = cellDate(h.offerDate);
  if (offerDate == null) errors.push({ where: "Bid sheet", message: "Fill in the offer date." });
  else if (offerDate === "bad") errors.push({ where: "Bid sheet", message: `The offer date "${h.offerDate}" isn't a date. Write it as YYYY-MM-DD.` });
  const validUntil = cellDate(h.validUntil);
  if (validUntil === "bad") errors.push({ where: "Bid sheet", message: `"Valid until" ("${h.validUntil}") isn't a date. Write it as YYYY-MM-DD.` });
  else if (validUntil && typeof offerDate === "string" && validUntil < offerDate) errors.push({ where: "Bid sheet", message: "The offer is valid until a date before the offer date." });
  else if (validUntil == null) warnings.push({ where: "Bid sheet", message: "No validity date given." });
  const currency = text(h.currency, 8)?.toUpperCase() ?? null;
  if (!currency) errors.push({ where: "Bid sheet", message: "Fill in the currency (for example USD, EUR or EGP)." });
  else if (!/^[A-Z]{3}$/.test(currency)) errors.push({ where: "Bid sheet", message: `The currency "${h.currency}" isn't a 3-letter code such as USD.` });
  const incoterm = text(h.incoterm, 8)?.toUpperCase() ?? null;
  if (incoterm && !(INCOTERM_CODES as readonly string[]).includes(incoterm)) errors.push({ where: "Bid sheet", message: `The Incoterm "${h.incoterm}" isn't one of ${INCOTERM_CODES.join(", ")}.` });
  if (reference && typeof offerDate === "string" && validUntil !== "bad" && currency && /^[A-Z]{3}$/.test(currency)) {
    out.header = { reference, offerDate, validUntil: validUntil ?? null, currency, incoterm: incoterm && (INCOTERM_CODES as readonly string[]).includes(incoterm) ? incoterm : null, paymentTerms: text(h.paymentTerms, 500) };
  }

  // Lines
  const byCode = new Map(ctx.lines.map((l) => [l.code.toUpperCase(), l]));
  const seen = new Set<string>();
  const quoted = new Map<string, ParsedLine>();
  const failed = new Set<string>(); // priced rows with errors: their answers are still checked
  for (const r of raw.lines) {
    const where = `Bid sheet row ${r.row}`;
    const code = text(r.code, 64)?.toUpperCase() ?? null;
    if (!code) { errors.push({ where, message: "This row has no item code. Don't add rows: quote only the items listed." }); continue; }
    const rl = byCode.get(code);
    if (!rl) { errors.push({ where, message: `"${r.code}" isn't an item of this RFQ.` }); continue; }
    if (seen.has(code)) { errors.push({ where, message: `${code} appears twice. Keep one row per item.` }); continue; }
    seen.add(code);
    const price = cellNumber(r.unitPrice);
    if (price == null) {
      out.notQuoted.push(rl.name);
      if (r.make != null || r.model != null || r.discountPct != null) warnings.push({ where, message: `${rl.name} has no unit price, so it is treated as not quoted.` });
      continue;
    }
    const bad: string[] = [];
    if (price === "bad" || price < 0 || price > 1e11) bad.push(`the unit price "${r.unitPrice}" isn't a number`);
    let quantity = rl.quantity;
    const q = intIn(r.quantity, 1, 1_000_000);
    if (q === "bad") bad.push(`the quantity "${r.quantity}" isn't a whole number of at least 1`);
    else if (q != null) {
      if (rl.quantity != null && q !== rl.quantity) warnings.push({ where, message: `${rl.name}: quantity ${q} offered, ${rl.quantity} asked for.` });
      quantity = q;
    } else if (quantity == null) bad.push("give the quantity (the RFQ leaves it to the offer)");
    const disc = cellNumber(r.discountPct);
    if (disc === "bad" || (typeof disc === "number" && (disc < 0 || disc > 100))) bad.push(`the discount "${r.discountPct}" isn't a % from 0 to 100`);
    const delivery = intIn(r.deliveryWeeks, 0, 520);
    if (delivery === "bad") bad.push(`delivery "${r.deliveryWeeks}" isn't a whole number of weeks`);
    const warranty = intIn(r.warrantyMonths, 0, 240);
    if (warranty === "bad") bad.push(`warranty "${r.warrantyMonths}" isn't a whole number of months`);
    if (bad.length) { errors.push({ where, message: `${rl.name}: ${bad.join("; ")}.` }); failed.add(code); continue; }
    quoted.set(code, {
      deviceTypeId: rl.deviceTypeId, code: rl.code, name: rl.name, boqLineId: rl.boqLineIds.length === 1 ? rl.boqLineIds[0] : null,
      quantity: quantity!, unitPrice: Math.round((price as number) * 100) / 100, discountPct: (disc as number | null) ?? 0,
      manufacturer: text(r.make, 200), model: text(r.model, 200), countryOfOrigin: text(r.country, 80),
      deliveryWeeks: delivery as number | null, warrantyMonths: warranty as number | null, remark: text(r.remark, 500), compliance: [],
    });
  }
  for (const l of ctx.lines) if (!seen.has(l.code.toUpperCase())) warnings.push({ where: "Bid sheet", message: `${l.name} (${l.code}) isn't in the file: not quoted.` });

  // Compliance
  const answered = new Set<string>();
  for (const c of raw.compliance) {
    const where = `Compliance sheet row ${c.row}`;
    const code = text(c.code, 64)?.toUpperCase() ?? null;
    const rl = code ? byCode.get(code) : undefined;
    if (!rl) { errors.push({ where, message: code ? `"${c.code}" isn't an item of this RFQ.` : "This row has no item code." }); continue; }
    const line = quoted.get(code!);
    if (!line && !failed.has(code!)) continue; // not quoted: answers don't count
    const id = cellNumber(c.specItemId);
    const item = typeof id === "number" ? rl.specItems.find((s) => s.id === id) : undefined;
    if (!item) { errors.push({ where, message: `The Ref "${c.specItemId ?? ""}" isn't a specification line of ${rl.name}. Don't change the Ref column.` }); continue; }
    const key = `${code}:${item.id}`;
    if (answered.has(key)) { errors.push({ where, message: `${rl.name}: "${item.parameter}" is answered twice.` }); continue; }
    const status = answerStatus(c.answer);
    if (status === "bad") { errors.push({ where, message: `${rl.name}, ${item.parameter}: answer Yes, No or Partial, not "${c.answer}".` }); continue; }
    if (status == null && c.offeredValue == null && c.remark == null) continue;
    answered.add(key);
    const remark = text(c.remark, 500);
    if ((status === "NOT_COMPLIANT" || status === "PARTIAL") && !remark) warnings.push({ where, message: `${rl.name}, ${item.parameter}: answered ${status === "PARTIAL" ? "Partial" : "No"} without a remark.` });
    line?.compliance.push({ specItemId: item.id, status: status ?? "NOT_STATED", offeredValue: text(c.offeredValue, 500), remark, pageRef: text(c.pageRef, 64) });
  }
  for (const [code, line] of quoted) {
    const rl = byCode.get(code)!;
    const missing = rl.specItems.filter((s) => s.mandatory && !line.compliance.some((c) => c.specItemId === s.id && c.status !== "NOT_STATED"));
    if (missing.length) {
      errors.push({ where: "Compliance sheet", message: `${rl.name}: answer the mandatory line${missing.length === 1 ? "" : "s"} ${missing.slice(0, 5).map((s) => `"${s.parameter}"`).join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}.` });
    }
  }

  out.lines = [...quoted.values()];
  if (!out.lines.length && !errors.length) errors.push({ where: "Bid sheet", message: "No item has a unit price. Fill in the prices of the items quoted." });
  const del = out.lines.map((l) => l.deliveryWeeks).filter((n): n is number => n != null);
  const war = out.lines.map((l) => l.warrantyMonths).filter((n): n is number => n != null);
  out.deliveryWeeks = del.length ? Math.max(...del) : null;
  out.warrantyMonths = war.length ? Math.min(...war) : null;
  if (new Set(del).size > 1) warnings.push({ where: "Bid sheet", message: `Delivery differs between items; the offer records the longest, ${out.deliveryWeeks} weeks.` });
  if (new Set(war).size > 1) warnings.push({ where: "Bid sheet", message: `Warranty differs between items; the offer records the shortest, ${out.warrantyMonths} months.` });
  return out;
}

/** The offer's notes for an imported bid: where it came from and per-item remarks, delivery and warranty. */
export function importNote(fileName: string, check: BidCheck): string {
  const bits = [`Imported from Excel (${fileName.slice(0, 120)}).`];
  for (const l of check.lines) {
    const extra = [l.deliveryWeeks != null ? `delivery ${l.deliveryWeeks} weeks` : null, l.warrantyMonths != null ? `warranty ${l.warrantyMonths} months` : null, l.remark].filter(Boolean);
    if (extra.length) bits.push(`${l.code}: ${extra.join("; ")}`);
  }
  return bits.join("\n").slice(0, 4000);
}
