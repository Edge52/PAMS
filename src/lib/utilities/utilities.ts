/**
 * Utility systems (wave 41, GAHAR 2025 EFS.11; ECRI 2026 hazard 2, readiness for loss of systems). Pure rules: which
 * tests each kind of system needs and how often, whether a test passed, and what is due. Tested in utilities.test.ts.
 *
 * Default figures (change them here, with the test, never in a page):
 *  - Generator load test monthly, at least 30 minutes, at least 30 % of the rating, transfer in 10 s or less
 *    (NFPA 110, type 10 systems). Run without load weekly. Fuel checked weekly.
 *  - Theatre air handling: 20 air changes an hour, positive pressure; airborne isolation: 12 air changes, negative,
 *    at least 2.5 Pa (ASHRAE/ASHE 170). These are starting points: enter the hospital's design figures per system.
 *  - Cold chain: 2–8 °C (vaccines, pharmacy), 2–6 °C (blood). Logged daily.
 * Intervals are defaults for a hospital that has no policy of its own; check the local code and the maker's manual.
 */

export const UTILITY_KINDS = [
  "GENERATOR", "UPS", "TRANSFER_SWITCH", "GAS_MANIFOLD", "GAS_ALARM", "ZONE_VALVE", "VACUUM_PLANT", "OXYGEN_PLANT", "OXYGEN_TANK",
  "HVAC_THEATRE", "HVAC_ISOLATION", "CHILLER", "WATER_TANK", "LIFT", "FIRE_PUMP", "COLD_CHAIN", "OTHER",
] as const;
export type UtilityKind = (typeof UTILITY_KINDS)[number];

export const TEST_KINDS = ["GEN_LOAD", "GEN_NO_LOAD", "FUEL", "TRANSFER", "UPS_AUTONOMY", "GAS_ALARM", "COLD_CHAIN", "TANK_CLEAN", "HVAC_CHECK", "INSPECTION"] as const;
export type TestKind = (typeof TEST_KINDS)[number];

export const PRESSURES = ["POSITIVE", "NEGATIVE", "NONE"] as const;
export type Pressure = (typeof PRESSURES)[number];

export const TEST_LABELS: Record<TestKind, string> = {
  GEN_LOAD: "Generator run with load", GEN_NO_LOAD: "Generator run without load", FUEL: "Fuel level", TRANSFER: "Transfer to generator",
  UPS_AUTONOMY: "UPS autonomy", GAS_ALARM: "Medical gas alarm test", COLD_CHAIN: "Temperature log", TANK_CLEAN: "Tank cleaning and sample",
  HVAC_CHECK: "Air changes and pressure", INSPECTION: "Inspection",
};

/** Which readings a test asks for (the record form shows these). */
export const TEST_FIELDS: Record<TestKind, ("loadKw" | "durationMin" | "transferSec" | "fuelPct" | "autonomyMin" | "tempMin" | "tempMax" | "excursionMin" | "airChanges" | "pressurePa" | "checksOk")[]> = {
  GEN_LOAD: ["loadKw", "durationMin", "transferSec", "checksOk"],
  GEN_NO_LOAD: ["durationMin", "checksOk"],
  FUEL: ["fuelPct"],
  TRANSFER: ["transferSec", "checksOk"],
  UPS_AUTONOMY: ["autonomyMin", "checksOk"],
  GAS_ALARM: ["checksOk"],
  COLD_CHAIN: ["tempMin", "tempMax", "excursionMin"],
  TANK_CLEAN: ["checksOk"],
  HVAC_CHECK: ["airChanges", "pressurePa"],
  INSPECTION: ["checksOk"],
};

/** What "checks all right" means for each test that asks it. */
export const CHECKS_LABEL: Partial<Record<TestKind, string>> = {
  GEN_LOAD: "Started, took the load and ran without faults", GEN_NO_LOAD: "Started and ran without faults", TRANSFER: "Switched over and back without faults",
  UPS_AUTONOMY: "Held the load without alarms", GAS_ALARM: "Every alarm sounded and showed at the panels (high, low, changeover)",
  TANK_CLEAN: "Tank cleaned, disinfected and sampled", INSPECTION: "Checked and in working order",
};

type KindInfo = { label: string; typeCodes: string[]; tests: { kind: TestKind; everyDays: number }[]; defaults?: { requiredMinutes?: number; minFuelPct?: number; tempLow?: number; tempHigh?: number; requiredAch?: number; pressure?: Pressure; minPressurePa?: number } };

export const KIND_INFO: Record<UtilityKind, KindInfo> = {
  GENERATOR: { label: "Generator", typeCodes: ["UTL-PWR-GEN"], tests: [{ kind: "GEN_NO_LOAD", everyDays: 7 }, { kind: "GEN_LOAD", everyDays: 30 }, { kind: "FUEL", everyDays: 7 }], defaults: { minFuelPct: 50 } },
  UPS: { label: "UPS", typeCodes: ["UTL-PWR-UPS"], tests: [{ kind: "UPS_AUTONOMY", everyDays: 91 }], defaults: { requiredMinutes: 10 } },
  TRANSFER_SWITCH: { label: "Transfer switch", typeCodes: ["UTL-PWR-ATS"], tests: [{ kind: "TRANSFER", everyDays: 30 }] },
  GAS_MANIFOLD: { label: "Gas manifold", typeCodes: ["GAS-SRC-MAN"], tests: [{ kind: "GAS_ALARM", everyDays: 91 }, { kind: "INSPECTION", everyDays: 30 }] },
  GAS_ALARM: { label: "Medical gas alarm panel", typeCodes: ["GAS-DIS-ALM"], tests: [{ kind: "GAS_ALARM", everyDays: 91 }] },
  ZONE_VALVE: { label: "Zone valve box", typeCodes: ["GAS-DIS-ZVB"], tests: [{ kind: "INSPECTION", everyDays: 182 }] },
  VACUUM_PLANT: { label: "Vacuum plant", typeCodes: ["GAS-SRC-VAC"], tests: [{ kind: "GAS_ALARM", everyDays: 91 }, { kind: "INSPECTION", everyDays: 30 }] },
  OXYGEN_PLANT: { label: "Oxygen plant", typeCodes: ["GAS-SRC-PSA"], tests: [{ kind: "GAS_ALARM", everyDays: 91 }, { kind: "INSPECTION", everyDays: 30 }] },
  OXYGEN_TANK: { label: "Liquid oxygen tank", typeCodes: ["GAS-SRC-VIE"], tests: [{ kind: "GAS_ALARM", everyDays: 91 }, { kind: "INSPECTION", everyDays: 30 }] },
  HVAC_THEATRE: { label: "Air handling, theatre", typeCodes: ["UTL-HVA-AHU"], tests: [{ kind: "HVAC_CHECK", everyDays: 91 }], defaults: { requiredAch: 20, pressure: "POSITIVE", minPressurePa: 2.5 } },
  HVAC_ISOLATION: { label: "Air handling, isolation", typeCodes: [], tests: [{ kind: "HVAC_CHECK", everyDays: 30 }], defaults: { requiredAch: 12, pressure: "NEGATIVE", minPressurePa: 2.5 } },
  CHILLER: { label: "Chiller", typeCodes: ["UTL-HVA-CHL"], tests: [{ kind: "INSPECTION", everyDays: 91 }] },
  WATER_TANK: { label: "Water tank", typeCodes: ["UTL-WTR-TNK"], tests: [{ kind: "TANK_CLEAN", everyDays: 182 }] },
  LIFT: { label: "Lift", typeCodes: ["UTL-LFT-BED"], tests: [{ kind: "INSPECTION", everyDays: 30 }] },
  FIRE_PUMP: { label: "Fire pump", typeCodes: ["UTL-FIR-PMP"], tests: [{ kind: "INSPECTION", everyDays: 7 }] },
  COLD_CHAIN: { label: "Refrigerator (cold chain)", typeCodes: ["BBK-STO-REF", "PHA-CLD-REF", "PHA-CLD-VAC", "LAB-STO-LRF", "FUR-MOR-REF"], tests: [{ kind: "COLD_CHAIN", everyDays: 1 }], defaults: { tempLow: 2, tempHigh: 8 } },
  OTHER: { label: "Other", typeCodes: [], tests: [{ kind: "INSPECTION", everyDays: 91 }] },
};

export const KIND_LABELS = Object.fromEntries(UTILITY_KINDS.map((k) => [k, KIND_INFO[k].label])) as Record<UtilityKind, string>;

export const isUtilityKind = (v: unknown): v is UtilityKind => typeof v === "string" && (UTILITY_KINDS as readonly string[]).includes(v);
export const isTestKind = (v: unknown): v is TestKind => typeof v === "string" && (TEST_KINDS as readonly string[]).includes(v);

/** The kind a device type suggests (blood bank fridges get 2–6 °C in `defaultsFor`), or null when it isn't a utility type. */
export function kindForTypeCode(code: string): UtilityKind | null {
  for (const k of UTILITY_KINDS) if (KIND_INFO[k].typeCodes.includes(code)) return k;
  return code.startsWith("UTL-") ? "OTHER" : null;
}

/** Every device type code that counts as a utility system, for pickers. */
export const UTILITY_TYPE_CODES = UTILITY_KINDS.flatMap((k) => KIND_INFO[k].typeCodes);

export function defaultsFor(kind: UtilityKind, typeCode?: string | null): NonNullable<KindInfo["defaults"]> {
  const d = { ...(KIND_INFO[kind].defaults ?? {}) };
  if (kind === "COLD_CHAIN" && typeCode === "BBK-STO-REF") { d.tempLow = 2; d.tempHigh = 6; }
  return d;
}

/** The figures a test is judged by (the system's own, else the kind's defaults). */
export type SystemFigures = {
  kind: string; ratedKw?: number | null; requiredMinutes?: number | null; minFuelPct?: number | null; tempLow?: number | null; tempHigh?: number | null;
  requiredAch?: number | null; pressure?: string | null; minPressurePa?: number | null;
};
export type Readings = Partial<Record<"loadKw" | "durationMin" | "transferSec" | "fuelPct" | "autonomyMin" | "tempMin" | "tempMax" | "excursionMin" | "airChanges" | "pressurePa", number | null>> & { checksOk?: boolean | null };

export const GEN_LOAD_MIN_MINUTES = 30;
export const GEN_LOAD_MIN_SHARE = 0.3;
export const TRANSFER_MAX_SECONDS = 10;

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Pass or fail, with the reasons. `missing` lists readings the test needs that weren't given (the form refuses them).
 */
export function judgeTest(sys: SystemFigures, test: TestKind, r: Readings): { passed: boolean; problems: string[]; missing: string[] } {
  const kind = isUtilityKind(sys.kind) ? sys.kind : "OTHER";
  const d = defaultsFor(kind);
  const problems: string[] = [], missing: string[] = [];
  const need = (k: keyof Readings, label: string): number | null => {
    const v = r[k];
    if (typeof v !== "number" || !Number.isFinite(v)) { missing.push(label); return null; }
    return v;
  };
  const checks = TEST_FIELDS[test].includes("checksOk");
  if (checks && r.checksOk == null) missing.push("Checks");
  if (checks && r.checksOk === false) problems.push("Problem found during the test.");

  if (test === "GEN_LOAD") {
    const load = need("loadKw", "Load (kW)"), dur = need("durationMin", "Run time (minutes)"), tr = need("transferSec", "Transfer time (seconds)");
    if (dur != null && dur < GEN_LOAD_MIN_MINUTES) problems.push(`Ran ${fmt(dur)} minutes: at least ${GEN_LOAD_MIN_MINUTES} with load.`);
    if (tr != null && tr > TRANSFER_MAX_SECONDS) problems.push(`Transfer took ${fmt(tr)} s: ${TRANSFER_MAX_SECONDS} s or less.`);
    if (load != null && sys.ratedKw && load < sys.ratedKw * GEN_LOAD_MIN_SHARE) problems.push(`Load ${fmt(load)} kW is under ${GEN_LOAD_MIN_SHARE * 100} % of the ${fmt(sys.ratedKw)} kW rating.`);
  } else if (test === "GEN_NO_LOAD") {
    const dur = need("durationMin", "Run time (minutes)");
    if (dur != null && dur <= 0) problems.push("The generator did not run.");
  } else if (test === "FUEL") {
    const f = need("fuelPct", "Fuel level (%)"), min = sys.minFuelPct ?? d.minFuelPct ?? 50;
    if (f != null && f < min) problems.push(`Fuel at ${fmt(f)} %: keep at least ${fmt(min)} %.`);
  } else if (test === "TRANSFER") {
    const tr = need("transferSec", "Transfer time (seconds)");
    if (tr != null && tr > TRANSFER_MAX_SECONDS) problems.push(`Transfer took ${fmt(tr)} s: ${TRANSFER_MAX_SECONDS} s or less.`);
  } else if (test === "UPS_AUTONOMY") {
    const a = need("autonomyMin", "Autonomy (minutes)"), req = sys.requiredMinutes ?? d.requiredMinutes ?? 10;
    if (a != null && a < req) problems.push(`Held ${fmt(a)} minutes: ${fmt(req)} needed.`);
  } else if (test === "COLD_CHAIN") {
    const lo = need("tempMin", "Lowest temperature (°C)"), hi = need("tempMax", "Highest temperature (°C)");
    const low = sys.tempLow ?? d.tempLow ?? 2, high = sys.tempHigh ?? d.tempHigh ?? 8;
    if (lo != null && hi != null && hi < lo) problems.push("The highest temperature is below the lowest.");
    if (lo != null && lo < low) problems.push(`Went down to ${fmt(lo)} °C: range ${fmt(low)}–${fmt(high)} °C.`);
    if (hi != null && hi > high) problems.push(`Went up to ${fmt(hi)} °C: range ${fmt(low)}–${fmt(high)} °C.`);
    if ((r.excursionMin ?? 0) > 0) problems.push(`Out of range for ${fmt(r.excursionMin!)} minutes: check the stock with pharmacy or the blood bank.`);
  } else if (test === "HVAC_CHECK") {
    const ach = need("airChanges", "Air changes per hour"), req = sys.requiredAch ?? d.requiredAch;
    if (ach != null && req != null && ach < req) problems.push(`${fmt(ach)} air changes an hour: ${fmt(req)} needed.`);
    const mode = (sys.pressure ?? d.pressure ?? "NONE") as Pressure, minPa = sys.minPressurePa ?? d.minPressurePa ?? 2.5;
    if (mode !== "NONE") {
      const p = need("pressurePa", "Pressure difference (Pa)");
      if (p != null && mode === "POSITIVE" && p < minPa) problems.push(`Pressure ${fmt(p)} Pa: at least +${fmt(minPa)} Pa needed.`);
      if (p != null && mode === "NEGATIVE" && p > -minPa) problems.push(`Pressure ${fmt(p)} Pa: at most −${fmt(minPa)} Pa needed.`);
    }
  }
  return { passed: missing.length === 0 && problems.length === 0, problems, missing };
}

export type DueState = "ok" | "soon" | "due" | "overdue" | "never";
export const DUE_LABELS: Record<DueState, string> = { ok: "In date", soon: "Due soon", due: "Due today", overdue: "Overdue", never: "Never done" };
export const DUE_TONE: Record<DueState, "ok" | "warn" | "danger" | "neutral"> = { ok: "ok", soon: "neutral", due: "warn", overdue: "danger", never: "danger" };

const dayMs = 86_400_000;
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / dayMs);

/** When the next test is due and its state today. "Soon" = within a fifth of the interval (at least a day). */
export function testDue(lastOn: string | null, everyDays: number, today: string): { state: DueState; dueOn: string | null; daysLate: number } {
  if (!lastOn) return { state: "never", dueOn: null, daysLate: 0 };
  const dueOn = addDays(lastOn, everyDays);
  const left = daysBetween(today, dueOn);
  if (left < 0) return { state: "overdue", dueOn, daysLate: -left };
  if (left === 0) return { state: "due", dueOn, daysLate: 0 };
  return { state: left <= Math.max(1, Math.floor(everyDays / 5)) ? "soon" : "ok", dueOn, daysLate: 0 };
}

export type DueRow<S> = { system: S; test: TestKind; everyDays: number; lastOn: string | null; lastPassed: boolean | null; state: DueState; dueOn: string | null; daysLate: number };

/** Every test every active system needs, with its state; worst first. `last` maps `${systemId}|${kind}` to the latest test. */
export function dueRows<S extends { id: number; kind: string; active?: boolean }>(systems: S[], last: Map<string, { testedOn: string; passed: boolean }>, today: string): DueRow<S>[] {
  const order: Record<DueState, number> = { overdue: 0, never: 1, due: 2, soon: 3, ok: 4 };
  const rows: DueRow<S>[] = [];
  for (const s of systems) {
    if (s.active === false) continue;
    const info = KIND_INFO[isUtilityKind(s.kind) ? s.kind : "OTHER"];
    for (const t of info.tests) {
      const l = last.get(`${s.id}|${t.kind}`) ?? null;
      const due = testDue(l?.testedOn ?? null, t.everyDays, today);
      rows.push({ system: s, test: t.kind, everyDays: t.everyDays, lastOn: l?.testedOn ?? null, lastPassed: l ? l.passed : null, ...due });
    }
  }
  return rows.sort((a, b) => order[a.state] - order[b.state] || b.daysLate - a.daysLate);
}

/** Work order title for a failed test. */
export function failureTitle(test: TestKind, tag: string, problems: string[]): string {
  return `${TEST_LABELS[test]} failed on ${tag}${problems[0] ? `: ${problems[0]}` : ""}`.slice(0, 200);
}

/** How often, in words. */
export function everyText(days: number): string {
  if (days === 1) return "Daily";
  if (days === 7) return "Weekly";
  if (days >= 28 && days <= 31) return "Monthly";
  if (days >= 90 && days <= 92) return "Every 3 months";
  if (days >= 180 && days <= 184) return "Every 6 months";
  if (days >= 364 && days <= 366) return "Yearly";
  return `Every ${days} days`;
}
