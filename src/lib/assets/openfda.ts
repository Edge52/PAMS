/**
 * openFDA device recall and enforcement files (wave 40). Pure: read a file the user downloaded (JSON or CSV) and
 * match its rows to devices by maker and model. No live fetch: the app never calls openFDA.
 *
 * Download: https://open.fda.gov/apis/device/recall (device/recall) or device/enforcement, either the full
 * download files (JSON, zipped: unzip first) or a query such as
 * https://api.fda.gov/device/recall.json?search=recalling_firm:"Siemens"&limit=1000 saved to a file.
 * openFDA's recall status isn't kept up to date, so a match is for finding notices, never for closing them.
 */

export type FdaRow = {
  fdaNumber: string | null; firm: string | null; product: string | null; codeInfo: string | null; reason: string | null;
  classification: string | null; initiatedOn: string | null; fdaStatus: string | null;
};

export const MAX_ROWS = 20_000;

const s = (v: unknown): string | null => {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(String).join(", ") || null;
  const t = String(v).trim();
  return t ? t : null;
};
/** openFDA dates are YYYYMMDD; CSV exports may give YYYY-MM-DD or MM/DD/YYYY. */
export function fdaDate(v: unknown): string | null {
  const t = s(v);
  if (!t) return null;
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

const pick = (o: Record<string, unknown>, keys: string[]) => { for (const k of keys) if (o[k] != null && s(o[k])) return o[k]; return null; };

/** One record of device/recall or device/enforcement (JSON field names, or CSV headings in any case). */
export function toRow(raw: Record<string, unknown>): FdaRow {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) o[k.trim().toLowerCase().replace(/[\s-]+/g, "_")] = v;
  const fda = (o.openfda ?? {}) as Record<string, unknown>;
  return {
    fdaNumber: s(pick(o, ["recall_number", "product_res_number", "res_event_number", "event_id", "cfres_id"])),
    firm: s(pick(o, ["recalling_firm", "firm_name", "recalling_firm_name"])),
    product: s(pick(o, ["product_description", "product", "trade_name"])) ?? s(fda.device_name),
    codeInfo: s(pick(o, ["code_info", "product_codes", "model_numbers", "code_information"])),
    reason: s(pick(o, ["reason_for_recall", "reason"])),
    classification: s(pick(o, ["classification", "recall_class", "event_classification"])),
    initiatedOn: fdaDate(pick(o, ["recall_initiation_date", "event_date_initiated", "event_date_posted", "report_date", "recall_date"])),
    fdaStatus: s(pick(o, ["status", "recall_status"])),
  };
}

/** A CSV line split with quotes ("a, b" stays one field, "" is a quote). */
export function csvRecords(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x.trim())) out.push(row);
      row = [];
      if (out.length > MAX_ROWS + 1) break;
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) out.push(row);
  return out;
}

/** Read the file's text: openFDA JSON ({ meta, results }), a plain array, or CSV with a heading row. */
export function parseFdaFile(text: string): { kind: "recall" | "enforcement"; rows: FdaRow[]; problem?: string } {
  const t = text.replace(/^﻿/, "").trim();
  if (!t) return { kind: "recall", rows: [], problem: "The file is empty." };
  if (t.startsWith("{") || t.startsWith("[")) {
    let data: unknown;
    try { data = JSON.parse(t); } catch { return { kind: "recall", rows: [], problem: "The file is not valid JSON. Unzip openFDA downloads first." }; }
    const list = Array.isArray(data) ? data : (data as { results?: unknown }).results;
    if (!Array.isArray(list)) return { kind: "recall", rows: [], problem: "No results list in the file. Use an openFDA device recall or enforcement file." };
    const rows = list.slice(0, MAX_ROWS).filter((x) => x && typeof x === "object").map((x) => toRow(x as Record<string, unknown>));
    const kind = list.some((x) => x && typeof x === "object" && "recall_number" in x) ? "enforcement" : "recall";
    return { kind, rows };
  }
  const recs = csvRecords(t);
  if (recs.length < 2) return { kind: "recall", rows: [], problem: "The CSV needs a heading row and at least one recall." };
  const head = recs[0].map((h) => h.trim());
  const rows = recs.slice(1, MAX_ROWS + 1).map((r) => toRow(Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""]))));
  const kind = head.some((h) => /recall.?number/i.test(h)) ? "enforcement" : "recall";
  if (!rows.some((r) => r.firm || r.product)) return { kind, rows: [], problem: "No recalling firm or product description column found." };
  return { kind, rows };
}

/* ── Matching ── */

/** Words that say nothing about who the maker is. */
const FIRM_NOISE = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "gmbh", "ag", "sa", "spa", "bv", "nv", "plc", "kk", "oy", "ab", "srl", "lp",
  "the", "and", "of", "usa", "us", "america", "international", "intl", "group", "holdings", "global",
  "medical", "systems", "system", "solutions", "healthcare", "health", "technologies", "technology", "devices", "products", "diagnostics", "imaging", "care", "electronics",
]);

/** A maker's name down to the words that identify it: "Siemens Medical Solutions USA, Inc." → ["siemens"]. */
export function firmTokens(name: string | null | undefined): string[] {
  return (name ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !FIRM_NOISE.has(w));
}

/** Same maker: the first identifying word is the same, or one name's words all appear in the other's. */
export function sameFirm(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = firmTokens(a), y = firmTokens(b);
  if (!x.length || !y.length) return false;
  if (x[0] === y[0]) return true;
  const sx = new Set(x), sy = new Set(y);
  return x.every((w) => sy.has(w)) || y.every((w) => sx.has(w));
}

/** Letters and digits only, lower case. */
export const squash = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Model names too short or too common to match on their own. */
const WEAK_MODELS = new Set(["system", "monitor", "pump", "ct", "mri", "xray", "scanner", "ultrasound", "unit", "model"]);

export type AssetForMatch = { id: number; tag: string; facilityId: number; manufacturer: string | null; model: string | null };
export type Match = { assetId: number; tag: string; facilityId: number; score: number; why: string };

/**
 * Devices a row may concern: same maker (fuzzy, see sameFirm) and the device's model found in the product
 * description or code info, ignoring spaces and punctuation ("SOMATOM go.Up" in "SOMATOM go.Up CT scanner").
 * Score 2 when the model also appears word for word, 1 otherwise. Models under 3 characters never match.
 */
export function matchRow(row: FdaRow, list: AssetForMatch[]): Match[] {
  if (!row.firm) return [];
  const hay = squash(`${row.product ?? ""} ${row.codeInfo ?? ""}`);
  const words = ` ${`${row.product ?? ""} ${row.codeInfo ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const out: Match[] = [];
  for (const a of list) {
    const m = squash(a.model);
    if (m.length < 3 || WEAK_MODELS.has(m) || !hay.includes(m)) continue;
    if (!sameFirm(row.firm, a.manufacturer)) continue;
    const exact = words.includes(` ${(a.model ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `);
    out.push({ assetId: a.id, tag: a.tag, facilityId: a.facilityId, score: exact ? 2 : 1, why: `${a.manufacturer ?? ""} ${a.model ?? ""}`.trim() });
  }
  return out.sort((x, y) => y.score - x.score || x.tag.localeCompare(y.tag)).slice(0, 200);
}

/** Rows with at least one candidate device, the best first. Rows the hospital already recorded (same number) are left out. */
export function candidates(rows: FdaRow[], list: AssetForMatch[], known: Set<string>): { row: FdaRow; matches: Match[] }[] {
  const out: { row: FdaRow; matches: Match[] }[] = [];
  for (const row of rows) {
    if (row.fdaNumber && known.has(row.fdaNumber.toLowerCase())) continue;
    const matches = matchRow(row, list);
    if (matches.length) out.push({ row, matches });
  }
  return out.sort((a, b) => Math.max(...b.matches.map((m) => m.score)) - Math.max(...a.matches.map((m) => m.score)) || (b.row.initiatedOn ?? "").localeCompare(a.row.initiatedOn ?? ""));
}
