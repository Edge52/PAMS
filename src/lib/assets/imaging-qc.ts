/**
 * Routine imaging QC by technologists (wave 40, GAHAR DAS.05). Pure: modalities, example templates, judging a run,
 * what is due, the monthly review's figures and a measured item's trend. The physicist's yearly QC stays in
 * ./radiation (radiation_qc_tests).
 *
 * The example templates are generic starting points (after the usual ACR / AAPM / IPEM routine QC programmes), not
 * the maker's: each hospital adapts them to its scanners and phantoms, and they stay marked as examples until edited.
 */
import { addDays, parseISO, toISO } from "./dates";
import { isHoliday, type HolidayDates } from "../working-days";
import type { QcAnswer, QcItem } from "../../db/schema-wave40-i";

export type { QcAnswer, QcItem };

export const MODALITIES = ["CT", "MRI", "XRAY", "MAMMO", "FLUORO", "US"] as const;
export type Modality = (typeof MODALITIES)[number];
export const MODALITY_LABELS: Record<Modality, string> = {
  CT: "CT", MRI: "MRI", XRAY: "X-ray", MAMMO: "Mammography", FLUORO: "Fluoroscopy and C-arm", US: "Ultrasound",
};

export const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQUENCY_LABELS: Record<Frequency, string> = { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly" };

export const REVIEWER_ROLES = ["RADIOLOGIST", "PHYSICIST", "OTHER"] as const;
export type ReviewerRole = (typeof REVIEWER_ROLES)[number];
export const REVIEWER_ROLE_LABELS: Record<ReviewerRole, string> = { RADIOLOGIST: "Radiologist", PHYSICIST: "Medical physicist", OTHER: "Other responsible person" };

const under = (code: string, p: string) => code === p || code.startsWith(p + "-");

/** The modality of a device type code, or null when routine imaging QC doesn't apply. C-arms count as fluoroscopy. */
export function modalityOf(code: string | null | undefined): Modality | null {
  if (!code) return null;
  const c = code.toUpperCase();
  if (under(c, "IMG-CT")) return "CT";
  if (under(c, "IMG-MRI")) return "MRI";
  if (c === "IMG-MAM-ABUS") return "US";
  if (under(c, "IMG-MAM")) return "MAMMO";
  if (under(c, "IMG-XR-CARM") || under(c, "IMG-XR-CARMFP") || under(c, "IMG-XR-FLUORO") || under(c, "IMG-XR-URO") || under(c, "IMG-ANG")) return "FLUORO";
  if (c === "IMG-XR-CR" || c === "IMG-XR-RET") return null; // readers and retrofit detectors go with their X-ray room
  if (under(c, "IMG-XR")) return "XRAY";
  if (under(c, "IMG-US")) return "US";
  return null;
}

/** SQL LIKE patterns for scanners that may have routine QC. */
export const QC_CODE_PATTERNS = ["IMG-CT%", "IMG-MRI%", "IMG-MAM%", "IMG-XR%", "IMG-ANG%", "IMG-US%"];

type Example = { modality: Modality; name: string; frequency: Frequency; items: QcItem[] };
const pf = (label: string): QcItem => ({ label, kind: "PASS_FAIL" });
const val = (label: string, unit: string, min: number | null, max: number | null): QcItem => ({ label, kind: "VALUE", unit, min, max });

/** Example templates, to adapt. Limits are typical figures; the maker's and the physicist's figures take precedence. */
export const EXAMPLE_TEMPLATES: Example[] = [
  { modality: "CT", name: "CT daily water phantom (example)", frequency: "DAILY", items: [
    pf("Tube warm-up and air calibration done"),
    val("Water CT number, centre", "HU", -4, 4),
    val("Noise, centre (SD)", "HU", null, 6),
    val("Uniformity: largest edge minus centre", "HU", -5, 5),
    pf("Image free of artefacts (rings, streaks)"),
    pf("Laser lights line up with the gantry"),
  ] },
  { modality: "CT", name: "CT monthly checks (example)", frequency: "MONTHLY", items: [
    val("CT number of a second material (e.g. acrylic)", "HU", 110, 135),
    pf("Table moves and indexes correctly"),
    pf("Monitor and film display test pattern"),
    pf("Emergency stops and warning lights work"),
  ] },
  { modality: "MRI", name: "MRI daily phantom (example)", frequency: "DAILY", items: [
    val("Centre frequency", "MHz", null, null),
    val("Signal-to-noise ratio (SNR)", "", 50, null),
    val("Ghosting ratio", "%", null, 2.5),
    pf("Geometric accuracy: phantom length within ±2 mm"),
    pf("Image free of artefacts"),
    pf("Helium level and cold head shown normal"),
  ] },
  { modality: "MRI", name: "MRI weekly checks (example)", frequency: "WEEKLY", items: [
    pf("Coils and cables: no damage"),
    pf("Patient alarm and intercom work"),
    pf("Room door, RF shield and signage in order"),
    pf("Emergency run-down button guarded and labelled"),
  ] },
  { modality: "XRAY", name: "X-ray weekly checks (example)", frequency: "WEEKLY", items: [
    val("Tube output consistency: dose at fixed kV/mAs vs baseline", "%", -10, 10),
    pf("Detector flat-field: no lines, blobs or dead areas"),
    pf("Light field matches the X-ray field"),
    pf("Collimator, locks and tube movements work"),
    pf("Lead aprons and gonad shields on their hangers, undamaged"),
  ] },
  { modality: "XRAY", name: "X-ray monthly checks (example)", frequency: "MONTHLY", items: [
    pf("Detector calibration (gain and offset) done"),
    val("Exposure index of a reference exposure vs baseline", "%", -20, 20),
    pf("Reject analysis reviewed"),
  ] },
  { modality: "MAMMO", name: "Mammography daily checks (example)", frequency: "DAILY", items: [
    pf("Detector flat-field: no artefacts"),
    val("Phantom image: signal-difference-to-noise (SDNR) vs baseline", "%", -10, 10),
    pf("Compression paddle undamaged and clean"),
  ] },
  { modality: "MAMMO", name: "Mammography weekly checks (example)", frequency: "WEEKLY", items: [
    val("Phantom: fibres seen", "count", 4, null),
    val("Phantom: speck groups seen", "count", 3, null),
    val("Phantom: masses seen", "count", 3, null),
    val("Compression force display vs scale", "N", -20, 20),
    pf("Review monitors: test pattern"),
  ] },
  { modality: "FLUORO", name: "Fluoroscopy and C-arm weekly checks (example)", frequency: "WEEKLY", items: [
    val("Entrance dose rate with the phantom vs baseline", "%", -15, 15),
    pf("Image: no artefacts or dead pixels"),
    pf("Last image hold and fluoroscopy timer alarm work"),
    pf("Foot switch and cables undamaged"),
    pf("Ceiling shield and table lead curtain in place"),
  ] },
  { modality: "US", name: "Ultrasound weekly checks (example)", frequency: "WEEKLY", items: [
    pf("Probes: no cracks, delamination or cable damage"),
    pf("Air scan: no dead elements (dark lines in the image)"),
    pf("Uniformity in the phantom: no bands or shadows"),
    val("Depth of penetration in the phantom vs baseline", "mm", -10, null),
    pf("Monitor and printer test pattern"),
  ] },
  { modality: "US", name: "Ultrasound monthly checks (example)", frequency: "MONTHLY", items: [
    val("Distance accuracy, 50 mm in the phantom", "mm", 49, 51),
    pf("Cleaning and disinfection log up to date"),
  ] },
];

/** Templates from text (editor format): one item per line, `label | unit | min | max`; no unit and no limits = pass/fail. */
export function parseItems(text: string): { items: QcItem[]; problems: string[] } {
  const items: QcItem[] = [], problems: string[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const [label, unit, min, max, ...rest] = line.split("|").map((s) => s.trim());
    if (!label) { problems.push(`Line ${i + 1}: give the item a name.`); continue; }
    if (rest.length) { problems.push(`Line ${i + 1}: too many | marks.`); continue; }
    const n = (s: string | undefined) => (s == null || s === "" ? null : Number(s));
    const lo = n(min), hi = n(max);
    if ((lo != null && !Number.isFinite(lo)) || (hi != null && !Number.isFinite(hi))) { problems.push(`Line ${i + 1}: the limits must be numbers.`); continue; }
    if (lo != null && hi != null && lo > hi) { problems.push(`Line ${i + 1}: the lower limit is above the upper one.`); continue; }
    const measured = unit !== undefined && (unit !== "" || lo != null || hi != null || min !== undefined);
    items.push(measured ? { label: label.slice(0, 160), kind: "VALUE", unit: unit || null, min: lo, max: hi } : { label: label.slice(0, 160), kind: "PASS_FAIL" });
  }
  if (!items.length && !problems.length) problems.push("Add at least one item.");
  if (items.length > 40) problems.push("Keep a template to 40 items.");
  return { items, problems };
}

export function itemsText(items: QcItem[]): string {
  return items.map((it) => (it.kind === "PASS_FAIL" ? it.label : [it.label, it.unit ?? "", it.min ?? "", it.max ?? ""].join(" | "))).join("\n");
}

/** Limits in words, e.g. "−4 to 4 HU", "at least 50", "at most 2.5 %". */
export function limitText(it: QcItem): string {
  if (it.kind !== "VALUE") return "Pass or fail";
  const u = it.unit ? ` ${it.unit}` : "";
  if (it.min != null && it.max != null) return `${it.min} to ${it.max}${u}`;
  if (it.min != null) return `at least ${it.min}${u}`;
  if (it.max != null) return `at most ${it.max}${u}`;
  return `record the value${u}`;
}

export type RawAnswer = { result?: string | null; value?: string | null; note?: string | null };

/**
 * Judge a run. A measured item passes when its value is within the limits (a value with no limits is recorded and
 * passes); a pass/fail item takes the answer given. Every item needs an answer; "not applicable" is allowed.
 */
export function judgeRun(items: QcItem[], raw: RawAnswer[]): { answers: QcAnswer[]; passed: boolean; failed: string[]; problems: string[] } {
  const answers: QcAnswer[] = [], failed: string[] = [], problems: string[] = [];
  items.forEach((it, i) => {
    const a = raw[i] ?? {};
    const note = a.note?.trim() ? a.note.trim().slice(0, 500) : null;
    if (a.result === "NA") { answers.push({ label: it.label, result: "NA", value: null, note }); return; }
    if (it.kind === "VALUE") {
      const s = (a.value ?? "").trim().replace(",", ".");
      if (!s) { problems.push(`Enter a value for "${it.label}" or mark it not applicable.`); return; }
      const v = Number(s);
      if (!Number.isFinite(v)) { problems.push(`"${it.label}" must be a number.`); return; }
      const ok = (it.min == null || v >= it.min) && (it.max == null || v <= it.max);
      answers.push({ label: it.label, result: ok ? "PASS" : "FAIL", value: v, note });
      if (!ok) failed.push(`${it.label}: ${v}${it.unit ? ` ${it.unit}` : ""} (limit ${limitText(it)})`);
      return;
    }
    if (a.result !== "PASS" && a.result !== "FAIL") { problems.push(`Answer "${it.label}".`); return; }
    answers.push({ label: it.label, result: a.result, value: null, note });
    if (a.result === "FAIL") failed.push(it.label);
  });
  return { answers, passed: failed.length === 0, failed, problems };
}

/** Monday of the ISO week of a date. */
export function weekStart(iso: string): string {
  const d = parseISO(iso);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

/** The start of the period a run on `day` belongs to. */
export function periodStart(freq: Frequency, day: string): string {
  if (freq === "DAILY") return day;
  if (freq === "WEEKLY") return weekStart(day);
  return `${day.slice(0, 7)}-01`;
}

export type DueState = "done" | "due" | "overdue" | "never";
export const DUE_LABELS: Record<DueState, string> = { done: "Done for this period", due: "Due now", overdue: "Missed last period", never: "Never done" };
export const DUE_TONE = { done: "ok", due: "warn", overdue: "danger", never: "neutral" } as const;

/**
 * Where a scanner stands with a template today. Done when a run falls in the current period; overdue when the
 * previous period has none either (daily: yesterday, except that a day the scanner isn't used can be marked NA in
 * a run). Never = no run at all.
 */
export function dueState(freq: Frequency, lastOn: string | null, today: string): DueState {
  if (!lastOn) return "never";
  const cur = periodStart(freq, today);
  if (lastOn >= cur) return "done";
  const prev = freq === "DAILY" ? addDays(today, -1) : freq === "WEEKLY" ? addDays(cur, -7) : `${toISO(new Date(Date.UTC(Number(cur.slice(0, 4)), Number(cur.slice(5, 7)) - 2, 1)))}`;
  return lastOn >= prev ? "due" : "overdue";
}

/** Expected runs of a frequency in a month (days but Fridays and public holidays for daily, weeks touching the month for weekly). */
export function expectedRuns(freq: Frequency, month: string, upTo?: string, holidays: HolidayDates = []): number {
  const first = `${month}-01`;
  const last = toISO(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)));
  const end = upTo && upTo < last ? upTo : last;
  if (end < first) return 0;
  if (freq === "MONTHLY") return 1;
  if (freq === "WEEKLY") {
    const weeks = new Set<string>();
    for (let d = first; d <= end; d = addDays(d, 1)) weeks.add(weekStart(d));
    return weeks.size;
  }
  let n = 0;
  for (let d = first; d <= end; d = addDays(d, 1)) { const w = parseISO(d).getUTCDay(); if (w !== 5 && !isHoliday(holidays, d)) n++; } // Friday off (Egypt) and public holidays
  return n;
}

export type MonthRun = { performedOn: string; passed: boolean };
/** A month's figures for one scanner and template: runs, failed runs and periods with no run. */
export function monthFigures(freq: Frequency, month: string, runs: MonthRun[], today: string, holidays: HolidayDates = []): { runs: number; failed: number; missed: number } {
  const inMonth = runs.filter((r) => r.performedOn.slice(0, 7) === month);
  const periods = new Set(inMonth.map((r) => periodStart(freq, r.performedOn)));
  const expected = expectedRuns(freq, month, month === today.slice(0, 7) ? today : undefined, holidays);
  return { runs: inMonth.length, failed: inMonth.filter((r) => !r.passed).length, missed: Math.max(0, expected - periods.size) };
}

/** Values of one measured item over time (oldest first), with its limits. */
export function trend(records: { performedOn: string; items: QcItem[]; answers: QcAnswer[] }[], label: string): { points: { on: string; value: number; ok: boolean }[]; min: number | null; max: number | null; unit: string | null } {
  const sorted = records.toSorted((a, b) => a.performedOn.localeCompare(b.performedOn));
  let min: number | null = null, max: number | null = null, unit: string | null = null;
  const points: { on: string; value: number; ok: boolean }[] = [];
  for (const r of sorted) {
    const it = r.items.find((x) => x.label === label && x.kind === "VALUE");
    const a = r.answers.find((x) => x.label === label);
    if (!it || !a || a.value == null) continue;
    min = it.min ?? null; max = it.max ?? null; unit = it.unit ?? null;
    points.push({ on: r.performedOn, value: a.value, ok: a.result !== "FAIL" });
  }
  return { points, min, max, unit };
}

/** The months a review may be signed for: the current month and the two before. */
export function reviewMonths(today: string): string[] {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  return [0, 1, 2].map((k) => { const d = new Date(Date.UTC(y, m - 1 - k, 1)); return d.toISOString().slice(0, 7); });
}

/** A work order title for a failed run. */
export function failureTitle(templateName: string, failed: string[]): string {
  return `QC failed: ${templateName.replace(/\s*\(example\)\s*$/i, "")} — ${failed.slice(0, 2).join("; ")}${failed.length > 2 ? ` and ${failed.length - 2} more` : ""}`.slice(0, 160);
}
