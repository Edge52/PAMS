/**
 * Patient dose and diagnostic reference levels (wave 43, GAHAR DAS.09 patient dose). Pure.
 *
 * ICRP 135 (2017): a DRL is set per exam type (and patient size or age group) from the median dose of a survey, at
 * national or local level. A hospital compares the MEDIAN of its own exams of that type on a scanner with the DRL;
 * a median above the DRL calls for a review by the medical physicist (protocol, technique, equipment). It is not a
 * limit for one patient. ICRP 135 suggests at least 20 exams per survey (mammography 50); a smaller sample is
 * still compared but shown as small.
 *
 * Quantities: CT CTDIvol (mGy) and DLP (mGy·cm); radiography DAP/KAP (Gy·cm²) or entrance surface dose ESD (mGy);
 * fluoroscopy DAP (Gy·cm²) and screening time (min); mammography mean glandular dose AGD (mGy).
 *
 * Privacy: PAMS keeps no patient names or identifiers. A dose import that has a column for one (name, ID, MRN,
 * accession, birth date, phone, address…) is refused as a whole, so the file is fixed at the source.
 */
import { cellText, parseCsv, parseDateCell } from "../imports/table";

export const DOSE_MODALITIES = ["CT", "XRAY", "FLUORO", "MAMMO"] as const;
export type DoseModality = (typeof DOSE_MODALITIES)[number];
export const DOSE_MODALITY_LABELS: Record<DoseModality, string> = { CT: "CT", XRAY: "Radiography", FLUORO: "Fluoroscopy and angiography", MAMMO: "Mammography" };

export const DOSE_QUANTITIES = ["ctdivol", "dlp", "dap", "esd", "time", "agd"] as const;
export type DoseQuantity = (typeof DOSE_QUANTITIES)[number];
export const QUANTITY_LABELS: Record<DoseQuantity, string> = { ctdivol: "CTDIvol", dlp: "DLP", dap: "DAP (KAP)", esd: "Entrance surface dose", time: "Screening time", agd: "Mean glandular dose" };
export const QUANTITY_UNITS: Record<DoseQuantity, string> = { ctdivol: "mGy", dlp: "mGy·cm", dap: "Gy·cm²", esd: "mGy", time: "min", agd: "mGy" };
/** Which quantities each modality records (and can have a DRL for). */
export const MODALITY_QUANTITIES: Record<DoseModality, DoseQuantity[]> = { CT: ["ctdivol", "dlp"], XRAY: ["dap", "esd"], FLUORO: ["dap", "time"], MAMMO: ["agd"] };

/** Age groups (ICRP 135 suggests weight bands for children; most RIS exports give age). No birth dates are kept. */
export const AGE_GROUPS = ["ADULT", "CHILD_0", "CHILD_1", "CHILD_5", "CHILD_10"] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];
export const AGE_GROUP_LABELS: Record<AgeGroup, string> = { ADULT: "Adult (15 and over)", CHILD_0: "Child under 1", CHILD_1: "Child 1–4", CHILD_5: "Child 5–9", CHILD_10: "Child 10–14" };

export const MIN_SAMPLE: Record<DoseModality, number> = { CT: 20, XRAY: 20, FLUORO: 20, MAMMO: 50 };
export const EXAMPLE_SOURCE = "Example — replace with national or local DRLs";

/** Modality from a device type code; null = not an X-ray device. */
export function doseModalityOf(code: string | null | undefined): DoseModality | null {
  const c = (code ?? "").toUpperCase();
  const under = (p: string) => c === p || c.startsWith(p + "-");
  if (under("IMG-CT")) return "CT";
  if (under("IMG-MAM") && c !== "IMG-MAM-ABUS") return "MAMMO";
  if (under("IMG-ANG") || under("IMG-XR-CARM") || under("IMG-XR-CARMFP") || under("IMG-XR-FLUORO") || under("IMG-XR-URO")) return "FLUORO";
  if (under("IMG-XR")) return "XRAY";
  return null;
}

/** Exam types are matched case- and space-insensitively ("CT Head" = "ct  head"). */
export const examKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Age group from a text ("adult", "child 1-4", "Paediatric") or an age in years; null when unreadable. */
export function ageGroupOf(v: unknown): AgeGroup | null {
  const t = cellText(v).trim();
  if (!t) return null;
  const up = t.toUpperCase().replace(/[\s–-]+/g, "_");
  if ((AGE_GROUPS as readonly string[]).includes(up)) return up as AgeGroup;
  const label = AGE_GROUPS.find((g) => AGE_GROUP_LABELS[g].toLowerCase() === t.toLowerCase());
  if (label) return label;
  if (/^adult/i.test(t)) return "ADULT";
  const n = Number(t.replace(/\s*(y|yr|yrs|years?)$/i, ""));
  if (!Number.isFinite(n) || n < 0 || n > 130) return null;
  return n >= 15 ? "ADULT" : n >= 10 ? "CHILD_10" : n >= 5 ? "CHILD_5" : n >= 1 ? "CHILD_1" : "CHILD_0";
}

/** Median of the numbers given (blanks ignored); null when none. */
export function median(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export type DoseValues = Partial<Record<DoseQuantity, number | null>>;
export type DoseRecord = { assetId: number; facilityId: number; examDate: string; modality: DoseModality; examType: string; ageGroup: AgeGroup } & DoseValues;
export type Drl = { id?: number; facilityId: number; modality: DoseModality; examType: string; ageGroup: AgeGroup; quantity: DoseQuantity; value: number; active?: boolean };

export type DoseGroup = {
  assetId: number; facilityId: number; modality: DoseModality; examType: string; key: string; ageGroup: AgeGroup; month: string; n: number;
  medians: Partial<Record<DoseQuantity, number>>;
};

/** Monthly groups: one per scanner, exam type, age group and month, with the median of each quantity. */
export function monthlyGroups(records: DoseRecord[]): DoseGroup[] {
  const map = new Map<string, { g: DoseGroup; vals: Partial<Record<DoseQuantity, number[]>> }>();
  for (const r of records) {
    const key = examKey(r.examType), month = r.examDate.slice(0, 7);
    const k = `${r.assetId}|${r.modality}|${key}|${r.ageGroup}|${month}`;
    let e = map.get(k);
    if (!e) { e = { g: { assetId: r.assetId, facilityId: r.facilityId, modality: r.modality, examType: r.examType.trim(), key, ageGroup: r.ageGroup, month, n: 0, medians: {} }, vals: {} }; map.set(k, e); }
    e.g.n++;
    for (const q of MODALITY_QUANTITIES[r.modality]) { const v = r[q]; if (typeof v === "number" && Number.isFinite(v)) (e.vals[q] ??= []).push(v); }
  }
  return [...map.values()].map(({ g, vals }) => {
    for (const q of DOSE_QUANTITIES) { const m = median(vals[q] ?? []); if (m != null) g.medians[q] = m; }
    return g;
  }).sort((a, b) => b.month.localeCompare(a.month) || a.assetId - b.assetId || a.key.localeCompare(b.key) || a.ageGroup.localeCompare(b.ageGroup));
}

/** The hospital's active DRL for this exam, age group and quantity. */
export function drlFor(drls: Drl[], g: Pick<DoseGroup, "facilityId" | "modality" | "key" | "ageGroup">, q: DoseQuantity): Drl | null {
  return drls.find((d) => d.active !== false && d.facilityId === g.facilityId && d.modality === g.modality && examKey(d.examType) === g.key && d.ageGroup === g.ageGroup && d.quantity === q) ?? null;
}

export type DrlState = "above" | "within" | "no_drl";
export type DrlCheck = { quantity: DoseQuantity; median: number; drl: number | null; ratio: number | null; state: DrlState };
export type GroupCheck = DoseGroup & { checks: DrlCheck[]; state: DrlState; smallSample: boolean };

/** A median above its DRL flags the group for the physicist's review; equal to the DRL is within it. */
export function compareWithDrl(medianValue: number, drl: number | null): { ratio: number | null; state: DrlState } {
  if (drl == null || !(drl > 0)) return { ratio: null, state: "no_drl" };
  const ratio = medianValue / drl;
  return { ratio, state: medianValue > drl ? "above" : "within" };
}

export function checkGroups(groups: DoseGroup[], drls: Drl[]): GroupCheck[] {
  return groups.map((g) => {
    const checks: DrlCheck[] = [];
    for (const q of MODALITY_QUANTITIES[g.modality]) {
      const m = g.medians[q];
      if (m == null) continue;
      const d = drlFor(drls, g, q);
      checks.push({ quantity: q, median: m, drl: d?.value ?? null, ...compareWithDrl(m, d?.value ?? null) });
    }
    const state: DrlState = checks.some((c) => c.state === "above") ? "above" : checks.some((c) => c.state === "within") ? "within" : "no_drl";
    return { ...g, checks, state, smallSample: g.n < MIN_SAMPLE[g.modality] };
  });
}

export const reviewKey = (g: { assetId: number; modality: string; key: string; ageGroup: string; month: string }) => `${g.assetId}|${g.modality}|${g.key}|${g.ageGroup}|${g.month}`;

/**
 * GAHAR DAS.09 figure: of the monthly groups compared with a DRL, the share within the DRL or above it with a
 * physicist's review recorded.
 */
export function doseEvidence(checked: GroupCheck[], reviewed: Set<string>): { compared: number; ok: number; above: number; aboveReviewed: number; noDrl: number } {
  const compared = checked.filter((c) => c.state !== "no_drl");
  const above = compared.filter((c) => c.state === "above");
  const aboveReviewed = above.filter((c) => reviewed.has(reviewKey(c))).length;
  return { compared: compared.length, ok: compared.length - above.length + aboveReviewed, above: above.length, aboveReviewed, noDrl: checked.length - compared.length };
}

/* ───────────────────── Example DRLs ───────────────────── */

/**
 * Example rows to start the table: rounded figures of the order seen in published national DRLs for adults. They
 * are NOT Egyptian DRLs; each is saved with the source EXAMPLE_SOURCE and must be replaced with national or local
 * figures before use.
 */
export const EXAMPLE_DRLS: { modality: DoseModality; examType: string; quantity: DoseQuantity; value: number }[] = [
  { modality: "CT", examType: "CT head", quantity: "ctdivol", value: 60 }, { modality: "CT", examType: "CT head", quantity: "dlp", value: 970 },
  { modality: "CT", examType: "CT chest", quantity: "ctdivol", value: 12 }, { modality: "CT", examType: "CT chest", quantity: "dlp", value: 400 },
  { modality: "CT", examType: "CT abdomen and pelvis", quantity: "ctdivol", value: 15 }, { modality: "CT", examType: "CT abdomen and pelvis", quantity: "dlp", value: 700 },
  { modality: "XRAY", examType: "Chest PA", quantity: "dap", value: 0.1 }, { modality: "XRAY", examType: "Chest PA", quantity: "esd", value: 0.3 },
  { modality: "XRAY", examType: "Lumbar spine AP", quantity: "dap", value: 1.5 }, { modality: "XRAY", examType: "Abdomen AP", quantity: "dap", value: 2.5 },
  { modality: "FLUORO", examType: "Barium swallow", quantity: "dap", value: 9 }, { modality: "FLUORO", examType: "Barium swallow", quantity: "time", value: 2.5 },
  { modality: "FLUORO", examType: "Coronary angiography", quantity: "dap", value: 30 }, { modality: "FLUORO", examType: "Coronary angiography", quantity: "time", value: 5 },
  { modality: "MAMMO", examType: "Mammography CC view", quantity: "agd", value: 1.5 }, { modality: "MAMMO", examType: "Mammography MLO view", quantity: "agd", value: 1.8 },
];

/* ───────────────────── CSV import ───────────────────── */

export const DOSE_MAX_ROWS = 20_000;
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9µ²]/g, "");

/** Column headings that name or identify a patient. Any one of them refuses the file. */
const PERSONAL = [
  /patient/, /name/, /^mrn$/, /medicalrecord/, /^(pid|pat?id|id)$/, /nationalid/, /^nid$/, /accession/, /birth/, /^dob$/, /phone/, /mobile/,
  /address/, /email/, /passport/, /insurance/, /ssn/, /^uhid$/, /^hn$/, /^file(no|number)$/,
];
/** Headings that look personal but aren't (the scanner, exam and study are not the patient). */
const NOT_PERSONAL = [/^(scanner|device|station|exam|study|protocol|procedure|modality)(name|id|tag)?$/, /^aetitle$/, /^stationname$/];

export function personalColumns(headers: unknown[]): string[] {
  return headers.map((h) => cellText(h)).filter((h) => {
    const s = squash(h);
    return s !== "" && !NOT_PERSONAL.some((r) => r.test(s)) && PERSONAL.some((r) => r.test(s));
  });
}

type Field = "date" | "scanner" | "exam" | "protocol" | "age" | "modality" | DoseQuantity;
const ALIASES: Record<Field, RegExp> = {
  date: /^(date|examdate|studydate|performed(on)?|acquisitiondate)$/,
  scanner: /^(scanner|device|devicetag|assettag|tag|serial|serialnumber|aetitle|stationname|station)$/,
  exam: /^(exam|examtype|examination|study|studydescription|procedure)$/,
  protocol: /^(protocol|protocolname)$/,
  age: /^(age|agegroup|agebanding|ageyears)$/,
  modality: /^modality$/,
  ctdivol: /^ctdivol/, dlp: /^dlp/, dap: /^(dap|kap|pka)/, esd: /^(esd|esak|entrancesurfacedose|ese)/, time: /^(time|fluorotime|fluoroscopytime|screeningtime)/, agd: /^(agd|mgd|meanglandulardose)/,
};

/** Factor to the stored unit from a heading's unit, e.g. "DAP (mGy·cm²)" → 0.001; "Fluoro time (s)" → 1/60. */
export function unitFactor(q: DoseQuantity, header: string): number {
  const h = header.toLowerCase().replace(/\s+/g, "");
  if (q === "dap") {
    if (/(µ|u|micro)gy[·.*]?m(2|²)/.test(h)) return 0.01;
    if (/mgy[·.*]?cm/.test(h)) return 0.001;
    if (/cgy[·.*]?cm/.test(h)) return 0.01;
    if (/(µ|u|micro)gy[·.*]?cm/.test(h)) return 1e-6;
    return 1;
  }
  if (q === "time") return /\((s|sec|secs|seconds)\)|_s$|sec/.test(h) ? 1 / 60 : 1;
  if (q === "esd" || q === "agd" || q === "ctdivol") return /\((µ|u)gy\)/.test(h) ? 0.001 : 1;
  return 1;
}

export type DoseLookups = { scanners: Map<string, { assetId: number; facilityId: number; modality: DoseModality }> };
export type ValidDose = Omit<DoseRecord, never> & { protocol: string | null; tag: string };
export type DoseRowResult = { rowNumber: number; errors: string[]; tag?: string; examType?: string };
export type DoseParse = { error?: string; rows: DoseRowResult[]; valid: ValidDose[] };

/**
 * Rows of a dose export (CSV text or a table read from Excel) → records. Refused whole when a heading names a
 * patient identifier, when the required columns (date, scanner, exam type) are missing, or when it is too long.
 * Scanners are matched by asset tag, serial number or AE title (keys in `lookups.scanners`, lower case).
 */
export function parseDoseTable(input: string | unknown[][], lookups: DoseLookups, today: string): DoseParse {
  const table = typeof input === "string" ? parseCsv(input) : input;
  if (table.length < 2) return { error: "The file needs a header row and at least one exam.", rows: [], valid: [] };
  const headers = table[0];
  const personal = personalColumns(headers);
  if (personal.length) return { error: `The file has patient identifier columns (${personal.join(", ")}). PAMS keeps no patient names or IDs: remove those columns in the export and upload again. Nothing was saved.`, rows: [], valid: [] };
  const map = new Map<Field, { i: number; header: string }>();
  headers.forEach((h, i) => {
    const s = squash(cellText(h).replace(/\(.*\)|\[.*\]/g, ""));
    const f = (Object.keys(ALIASES) as Field[]).find((k) => ALIASES[k].test(s));
    if (f && !map.has(f)) map.set(f, { i, header: cellText(h) });
  });
  const missing = (["date", "scanner", "exam"] as const).filter((f) => !map.has(f));
  if (missing.length) return { error: `The first row must name the columns. Missing: ${missing.map((m) => (m === "exam" ? "exam type" : m)).join(", ")}.`, rows: [], valid: [] };
  if (table.length - 1 > DOSE_MAX_ROWS) return { error: `That file has ${table.length - 1} exams; import at most ${DOSE_MAX_ROWS.toLocaleString("en")} at a time.`, rows: [], valid: [] };
  const cell = (r: unknown[], f: Field) => { const m = map.get(f); return m ? r[m.i] : undefined; };
  const rows: DoseRowResult[] = [], valid: ValidDose[] = [];
  table.slice(1).forEach((r, idx) => {
    const errors: string[] = [];
    const rowNumber = idx + 2;
    const d = parseDateCell(cell(r, "date"));
    if (!d || d === "invalid") errors.push("Date is missing or not a date.");
    else if (d > today) errors.push("Date is in the future.");
    const tag = cellText(cell(r, "scanner")).trim();
    const sc = lookups.scanners.get(tag.toLowerCase());
    if (!tag) errors.push("Scanner is missing.");
    else if (!sc) errors.push(`Scanner "${tag}" is not an X-ray device you can see (use its asset tag, serial or AE title).`);
    const examType = cellText(cell(r, "exam")).trim();
    if (!examType) errors.push("Exam type is missing.");
    else if (examType.length > 160) errors.push("Exam type must be under 160 characters.");
    const ageRaw = cell(r, "age");
    const ageGroup = cellText(ageRaw) === "" ? "ADULT" : ageGroupOf(ageRaw);
    if (!ageGroup) errors.push("Age group is not readable (use Adult, Child 1–4… or the age in years).");
    const vals: DoseValues = {};
    for (const q of DOSE_QUANTITIES) {
      const m = map.get(q);
      const raw = cellText(cell(r, q)).replace(/[, ]/g, "");
      if (!m || raw === "") continue;
      const x = Number(raw);
      if (!Number.isFinite(x) || x < 0) { errors.push(`${QUANTITY_LABELS[q]} must be a number, 0 or more.`); continue; }
      vals[q] = x * unitFactor(q, m.header);
    }
    const modality = sc?.modality;
    if (modality && !MODALITY_QUANTITIES[modality].some((q) => vals[q] != null)) errors.push(`No dose value for ${DOSE_MODALITY_LABELS[modality].toLowerCase()} (${MODALITY_QUANTITIES[modality].map((q) => QUANTITY_LABELS[q]).join(" or ")}).`);
    rows.push({ rowNumber, errors, tag, examType });
    if (!errors.length && sc && d && d !== "invalid" && ageGroup) {
      const protocol = cellText(cell(r, "protocol")).trim().slice(0, 160) || null;
      const keep: DoseValues = {};
      for (const q of MODALITY_QUANTITIES[sc.modality]) if (vals[q] != null) keep[q] = vals[q];
      valid.push({ assetId: sc.assetId, facilityId: sc.facilityId, examDate: d, modality: sc.modality, examType, ageGroup, protocol, tag, ...keep });
    }
  });
  return { rows, valid };
}

/** Why one entered dose record can't be saved, or null. */
export function doseRecordProblem(r: { examDate: string; modality: DoseModality } & DoseValues, today: string): string | null {
  if (r.examDate > today) return "The exam date can't be in the future.";
  const qs = MODALITY_QUANTITIES[r.modality];
  if (!qs.some((q) => r[q] != null)) return `Enter at least one of ${qs.map((q) => `${QUANTITY_LABELS[q]} (${QUANTITY_UNITS[q]})`).join(" or ")}.`;
  return null;
}

/** "12.3 mGy" — a dose figure with its unit, to 3 significant figures. */
export function doseText(q: DoseQuantity, v: number | null | undefined): string {
  if (v == null) return "—";
  const r = Math.abs(v) >= 100 ? Math.round(v) : Number(v.toPrecision(3));
  return `${r.toLocaleString("en")} ${QUANTITY_UNITS[q]}`;
}

/** The last `n` months as YYYY-MM, newest first. */
export function lastMonths(today: string, n = 12): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => { const t = y * 12 + (m - 1) - i; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; });
}

/** The first day of the month after `month` (YYYY-MM), for an end-exclusive date range. */
export function monthAfter(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
