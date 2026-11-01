/**
 * Planning vocabulary for the BOQ quick start (wave 3). Pure data — shared by the engine, the BOQ pages, the wizard
 * and the seed.
 *
 * - Department questions: throughput a department type can answer (e.g. CT exams a year). A rule with `param` uses
 *   the answer instead of its bed/room ratio when it is given.
 * - Hospital features: switches that turn on conditional rules (e.g. a trauma centre gets a dedicated CT).
 */

export type Question = { key: string; label: string; unit: string; hint?: string };

export const DEPARTMENT_QUESTIONS: Record<string, Question[]> = {
  RAD: [
    { key: "ctExams", label: "CT exams a year", unit: "CT exams", hint: "About 12,000 a year per CT (national averages run 12,000–13,000)." },
    { key: "mriExams", label: "MRI exams a year", unit: "MRI exams", hint: "About 6,000 a year per scanner." },
    { key: "xrayExams", label: "X-ray exams a year", unit: "X-ray exams", hint: "About 10,000 a year per digital room with extended hours." },
    { key: "usExams", label: "Ultrasound exams a year", unit: "ultrasound exams", hint: "About 6,000 a year per system." },
  ],
  LDR: [{ key: "deliveries", label: "Deliveries a year", unit: "deliveries", hint: "About 400 a year per delivery bed." }],
  ENDO: [{ key: "procedures", label: "Endoscopies a year", unit: "endoscopies", hint: "About 1,500 a year per endoscopy room." }],
  CATH: [{ key: "procedures", label: "Cath lab procedures a year", unit: "procedures", hint: "About 1,200 a year per lab." }],
  LAB: [{ key: "tests", label: "Chemistry tests a year", unit: "chemistry tests", hint: "About 400,000 a year per automated analyser." }],
};

/** Unit words for explanations ("18,000 CT exams × 1 per 15,000"). */
export function paramUnit(key: string, departmentTypeCode?: string): string {
  const own = departmentTypeCode ? DEPARTMENT_QUESTIONS[departmentTypeCode]?.find((q) => q.key === key) : undefined;
  if (own) return own.unit;
  for (const list of Object.values(DEPARTMENT_QUESTIONS)) { const q = list.find((x) => x.key === key); if (q) return q.unit; }
  return key;
}

export const FEATURES = [
  { key: "trauma", label: "Trauma centre", hint: "Dedicated trauma CT, rapid infusers, more transport ventilators." },
  { key: "teaching", label: "Teaching hospital", hint: "Extra ultrasound and endoscopy for training lists." },
  { key: "oncology", label: "Oncology with radiotherapy", hint: "Linear accelerator and CT simulator." },
  { key: "cardiacSurgery", label: "Cardiac surgery", hint: "Heart-lung machine, heater-cooler, cell saver, ECMO." },
  { key: "nicuLevel3", label: "NICU level III", hint: "High-frequency ventilation and therapeutic cooling." },
  { key: "stroke", label: "Stroke centre", hint: "CT available round the clock next to the emergency department." },
] as const;
export type FeatureKey = (typeof FEATURES)[number]["key"];

export function featureLabel(key: string): string {
  return FEATURES.find((f) => f.key === key)?.label ?? key;
}

/** Keep only known feature keys (form input). */
export function cleanFeatures(list: readonly string[]): FeatureKey[] {
  const known = new Set<string>(FEATURES.map((f) => f.key));
  return [...new Set(list)].filter((k): k is FeatureKey => known.has(k));
}

/** Keep only known, non-negative whole answers for a department type (form input). 0 means "none planned". */
export function cleanParams(departmentTypeCode: string, raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of DEPARTMENT_QUESTIONS[departmentTypeCode] ?? []) {
    const v = Number(raw[q.key]);
    // Blank = not answered (the bed/room ratio applies); 0 = none planned.
    if (raw[q.key] !== undefined && raw[q.key] !== "" && raw[q.key] !== null && Number.isFinite(v) && v >= 0) out[q.key] = Math.min(Math.round(v), 10_000_000);
  }
  return out;
}
