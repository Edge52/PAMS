/**
 * PPM checklists. Pure — shared by the catalogue editor, work order creation and completion, and the tests.
 *
 * A device type's checklist is its own `ppm_checklist`, else its group's, else its category's, else a built-in default
 * assembled from general checks plus extra lines for well-known groups (monitors, ventilators, defibrillators, pumps…).
 * The defaults follow common biomedical practice (IEC 62353 recurrent electrical safety tests, simulator checks);
 * engineers should replace them with the manufacturer's PPM procedure in the catalogue.
 */
import type { ChecklistItem, ChecklistResult } from "@/db/schema";

export type { ChecklistItem, ChecklistResult };

const GENERAL: ChecklistItem[] = [
  { text: "Visual inspection: housing, cables, connectors and mounts undamaged" },
  { text: "Asset tag and safety labels present and legible" },
  { text: "Power-on self test passes, no error codes" },
  { text: "Function test to the manufacturer's PPM procedure" },
];
const SAFETY: ChecklistItem[] = [
  { text: "Protective earth resistance", unit: "Ω", max: 0.3 },
  { text: "Equipment leakage current", unit: "µA", max: 500 },
];
const ALARMS: ChecklistItem = { text: "Alarms audible and visible; alarm limits work" };
const BATTERY: ChecklistItem = { text: "Battery runs the device off mains; replaced if past its date" };
const CLEAN: ChecklistItem = { text: "Cleaned and disinfected; device ready for use" };

/** Extra lines by taxonomy code prefix (group or category). Longest matching prefix wins. */
const EXTRA: Record<string, ChecklistItem[]> = {
  "MON-PAT": [ALARMS, BATTERY,
    { text: "SpO2 against simulator set to 98 %", unit: "%", min: 96, max: 100 },
    { text: "NIBP against simulator set to 120 mmHg systolic", unit: "mmHg", min: 115, max: 125 },
    { text: "Heart rate against ECG simulator set to 80 bpm", unit: "bpm", min: 78, max: 82 }],
  "MON-OXI": [ALARMS, BATTERY, { text: "SpO2 against simulator set to 98 %", unit: "%", min: 96, max: 100 }],
  "MON-ECG": [{ text: "Heart rate against ECG simulator set to 80 bpm", unit: "bpm", min: 78, max: 82 }, { text: "Recorder prints a clean trace" }],
  "LIF-VEN": [ALARMS, BATTERY,
    { text: "Delivered tidal volume at 500 mL setting", unit: "mL", min: 450, max: 550 },
    { text: "Oxygen concentration at 60 % setting", unit: "%", min: 57, max: 63 },
    { text: "PEEP at 5 cmH2O setting", unit: "cmH2O", min: 4, max: 6 },
    { text: "Disconnection and high-pressure alarms trigger" },
    { text: "Filters and service kit replaced if due" }],
  "LIF-DEF": [BATTERY,
    { text: "Delivered energy at 200 J into 50 Ω test load", unit: "J", min: 170, max: 230 },
    { text: "Charge time to maximum energy", unit: "s", max: 10 },
    { text: "Synchronised shock delivered on the R wave" },
    { text: "Pads and electrodes in date" }],
  "LIF-ANE": [ALARMS, { text: "Breathing system leak test", unit: "mL/min", max: 150 }, { text: "Vaporiser output checked" }, { text: "Gas supply pressures normal" }],
  "LIF-NEO": [ALARMS, { text: "Skin temperature reading against reference at 36 °C", unit: "°C", min: 35.5, max: 36.5 }],
  "INF-PMP": [ALARMS, BATTERY,
    { text: "Flow rate accuracy at 100 mL/h", unit: "%", min: -5, max: 5 },
    { text: "Occlusion alarm pressure", unit: "mmHg", max: 750 },
    { text: "Air-in-line detector triggers" }],
  "SUR-ENE": [{ text: "Output power at 50 W into rated load", unit: "W", min: 40, max: 60 }, { text: "HF leakage within limits" }, { text: "Return electrode monitoring alarm works" }],
  "SUR-SUC": [{ text: "Maximum vacuum", unit: "kPa", min: -80 }, { text: "Overflow protection works" }],
  "OBG-FET": [{ text: "FHR against simulator set to 140 bpm", unit: "bpm", min: 137, max: 143 }, { text: "Recorder prints a clean trace" }],
  "STR": [{ text: "Bowie-Dick or equivalent test passes" }, { text: "Chamber temperature at 134 °C cycle", unit: "°C", min: 134, max: 137 }, { text: "Door seal and interlock checked" }],
  "LAB": [{ text: "Quality control run within limits" }, { text: "Filters, tubing and consumables replaced if due" }],
  "LAB-STO": [{ text: "Cabinet temperature at set point", unit: "°C", min: 2, max: 8 }, { text: "Temperature alarm triggers" }],
  "PHA": [{ text: "Cabinet temperature at set point", unit: "°C", min: 2, max: 8 }, { text: "Temperature alarm triggers" }],
  "IMG": [{ text: "Image quality test with phantom passes" }, { text: "Emergency stop and interlocks work" }, { text: "Vendor service report attached" }],
  "FUR": [{ text: "Brakes, castors and side rails work" }, { text: "Motors and handset work through full range" }],
};

/** Built-in checklist for a device type from its taxonomy codes (own, group, category). */
export function defaultChecklist(codes: (string | null | undefined)[], opts: { requiresCalibration?: boolean; electrical?: boolean } = {}): ChecklistItem[] {
  const all = codes.filter((c): c is string => !!c);
  let extra: ChecklistItem[] = [];
  let best = -1;
  for (const [prefix, items] of Object.entries(EXTRA)) {
    if (prefix.length > best && all.some((c) => c === prefix || c.startsWith(prefix + "-"))) { extra = items; best = prefix.length; }
  }
  const lines = [...GENERAL, ...extra];
  if (opts.electrical !== false && !all.some((c) => c.startsWith("FUR") || c.startsWith("SUR-INS"))) lines.push(...SAFETY);
  if (opts.requiresCalibration) lines.push({ text: "Calibration checked against reference; certificate attached" });
  lines.push(CLEAN);
  // Dedupe (ALARMS etc. can arrive twice).
  const seen = new Set<string>();
  return lines.filter((l) => (seen.has(l.text) ? false : (seen.add(l.text), true)));
}

/** First non-empty checklist among the type, its group and its category; else the default. */
export function effectiveChecklist(
  own: ChecklistItem[] | null | undefined, group: ChecklistItem[] | null | undefined, category: ChecklistItem[] | null | undefined,
  fallback: () => ChecklistItem[],
): { items: ChecklistItem[]; source: "type" | "group" | "category" | "default" } {
  if (own?.length) return { items: own, source: "type" };
  if (group?.length) return { items: group, source: "group" };
  if (category?.length) return { items: category, source: "category" };
  return { items: fallback(), source: "default" };
}

/* ── Text form, for the catalogue editor: one line per item; measurements as "text | unit | min | max". ── */

export function formatChecklist(items: ChecklistItem[]): string {
  return items.map((i) => (i.unit !== undefined || i.min !== undefined || i.max !== undefined
    ? [i.text, i.unit ?? "", i.min ?? "", i.max ?? ""].join(" | ")
    : i.text)).join("\n");
}

export function parseChecklist(text: string): { items: ChecklistItem[]; errors: string[] } {
  const items: ChecklistItem[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 60) errors.push("Keep a checklist to 60 lines or fewer.");
  lines.slice(0, 60).forEach((line, n) => {
    const parts = line.split("|").map((p) => p.trim());
    const t = parts[0];
    if (!t) { errors.push(`Line ${n + 1}: the check needs a description.`); return; }
    if (t.length > 200) { errors.push(`Line ${n + 1}: keep the description under 200 characters.`); return; }
    if (parts.length === 1) { items.push({ text: t }); return; }
    const num = (s: string | undefined, what: string) => {
      if (s === undefined || s === "") return undefined;
      const v = Number(s.replace(",", "."));
      if (!Number.isFinite(v)) { errors.push(`Line ${n + 1}: the ${what} "${s}" is not a number.`); return undefined; }
      return v;
    };
    const item: ChecklistItem = { text: t, unit: parts[1] || undefined };
    const min = num(parts[2], "minimum"), max = num(parts[3], "maximum");
    if (min !== undefined) item.min = min;
    if (max !== undefined) item.max = max;
    if (min !== undefined && max !== undefined && min > max) errors.push(`Line ${n + 1}: the minimum is above the maximum.`);
    if (item.unit === undefined) item.unit = "";
    items.push(item);
  });
  return { items, errors };
}

export const isMeasurement = (i: ChecklistItem) => i.unit !== undefined || i.min !== undefined || i.max !== undefined;

export function rangeLabel(i: ChecklistItem): string {
  const u = i.unit ? ` ${i.unit}` : "";
  if (i.min !== undefined && i.max !== undefined) return `${i.min}–${i.max}${u}`;
  if (i.min !== undefined) return `≥ ${i.min}${u}`;
  if (i.max !== undefined) return `≤ ${i.max}${u}`;
  return i.unit ?? "";
}

/** A blank results sheet for a new work order. */
export const blankResults = (items: ChecklistItem[]): ChecklistResult[] => items.map((i) => ({ ...i, result: null, value: null, note: null }));

export type Answer = { result?: string | null; value?: string | number | null; note?: string | null };

/**
 * Apply submitted answers to a sheet. A measurement outside its range is a FAIL whatever was ticked; a measurement
 * inside it with no tick is a PASS. Returns the filled sheet and the problems that block completion.
 */
export function fillChecklist(sheet: ChecklistResult[], answers: Answer[]): { results: ChecklistResult[]; problems: string[]; failed: number } {
  const problems: string[] = [];
  const results = sheet.map((item, i): ChecklistResult => {
    const a = answers[i] ?? {};
    const raw = a.value === undefined || a.value === null || a.value === "" ? null : Number(String(a.value).replace(",", "."));
    let result = (a.result === "PASS" || a.result === "FAIL" || a.result === "NA" ? a.result : null) as ChecklistResult["result"];
    let value: number | null = null;
    if (isMeasurement(item) && result !== "NA") {
      if (raw === null || !Number.isFinite(raw)) {
        if (result !== "FAIL") problems.push(`Enter the reading for "${item.text}".`);
      } else {
        value = raw;
        const out = (item.min !== undefined && raw < item.min) || (item.max !== undefined && raw > item.max);
        result = out ? "FAIL" : result ?? "PASS";
      }
    } else if (!result) {
      problems.push(`Answer "${item.text}".`);
    }
    const note = a.note?.toString().trim().slice(0, 300) || null;
    return { ...item, result, value, note };
  });
  return { results, problems: problems.slice(0, 5).concat(problems.length > 5 ? [`…and ${problems.length - 5} more.`] : []), failed: results.filter((r) => r.result === "FAIL").length };
}

export function checklistSummary(results: ChecklistResult[] | null | undefined): { total: number; pass: number; fail: number; na: number; open: number } {
  const r = results ?? [];
  return {
    total: r.length, pass: r.filter((x) => x.result === "PASS").length, fail: r.filter((x) => x.result === "FAIL").length,
    na: r.filter((x) => x.result === "NA").length, open: r.filter((x) => !x.result).length,
  };
}

/** Job types that come with a checklist. */
export const CHECKLIST_TYPES = new Set(["PPM", "INSPECTION", "SAFETY_TEST", "CALIBRATION"]);
