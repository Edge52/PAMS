/**
 * BOQ calculation engine — PURE functions only (no DB, no server-only imports), so it runs in server actions,
 * seeds, unit tests and the client-side standards calculator alike.
 *
 * A rule says "for department type X, device Y, quantity = ratio × basis", where basis is one of the boq_basis enum
 * values (see src/db/schema.ts). Every calculated line carries a human explanation so the user can see why a
 * quantity is what it is, e.g. "12 beds × 1 per bed = 12".
 *
 * Order of operations, per department instance:
 *   raw = basis count × ratio  →  rounding (CEIL / ROUND / FLOOR)  →  clamp to [minQty, maxQty]
 * then × instances (a department with instances = 2 is two identical units, each needing its own equipment).
 * Lines whose final quantity is 0 are dropped.
 *
 * Wave 3 additions (all optional, so older callers behave as before):
 *  - throughput: a rule with `param` uses the department's answer to that question instead of its basis
 *    ("18,000 CT exams × 1 per 15,000 = 1.2, rounded up → 2");
 *  - conditions: a rule with a `condition` applies only when the BOQ has that feature (e.g. trauma centre);
 *  - companions: equipment that comes with another (a CT brings its injector) is topped up in the same department.
 */
import { featureLabel, paramUnit } from "./questions";

export const HOSPITAL_WIDE = "HOSP";

export const BASES = ["PER_BED", "PER_ROOM", "PER_DEPARTMENT", "PER_HOSPITAL_BEDS", "FIXED"] as const;
export const ROUNDINGS = ["CEIL", "ROUND", "FLOOR"] as const;
export const TIERS = ["ESSENTIAL", "RECOMMENDED", "OPTIONAL"] as const;
export type Basis = (typeof BASES)[number];
export type Rounding = (typeof ROUNDINGS)[number];
export type Tier = (typeof TIERS)[number];

export const BASIS_LABELS: Record<Basis, string> = {
  PER_BED: "Per department bed",
  PER_ROOM: "Per room",
  PER_DEPARTMENT: "Per department",
  PER_HOSPITAL_BEDS: "Per hospital beds",
  FIXED: "Fixed quantity",
};
export const ROUNDING_LABELS: Record<Rounding, string> = { CEIL: "Round up", ROUND: "Round to nearest", FLOOR: "Round down" };

export interface RuleInput {
  id: number;
  departmentTypeCode: string;
  deviceTypeId: number;
  basis: Basis;
  ratio: number;
  minQty: number;
  maxQty: number | null;
  rounding: Rounding;
  tier: Tier;
  /** Throughput question this rule answers to (e.g. "ctExams"), and quantity per unit of it. */
  param?: string | null;
  paramRatio?: number | null;
  /** Feature that must be on for the rule to apply ('' or undefined = always). */
  condition?: string | null;
}

export interface CompanionInput { deviceTypeId: number; companionTypeId: number; ratio: number }

export interface DepartmentInput {
  id: number;
  departmentTypeCode: string;
  label: string;
  beds: number;
  rooms: number;
  instances: number;
  /** Answers to the department's planning questions, e.g. { ctExams: 18000 }. */
  params?: Record<string, number> | null;
}

export interface EngineInput {
  rules: RuleInput[];
  departments: DepartmentInput[];
  /** Total hospital beds used by PER_HOSPITAL_BEDS rules. 0 → falls back to the sum of department beds. */
  totalHospitalBeds: number;
  includeTiers: readonly Tier[];
  /** Hospital features that switch on conditional rules. */
  features?: readonly string[];
  companions?: CompanionInput[];
  /** Device names for companion explanations ("With 2 × CT scanner, 64-slice"). */
  deviceName?: (id: number) => string;
}

export interface CalculatedLine {
  boqDepartmentId: number;
  deviceTypeId: number;
  /** Null for companion top-ups. */
  ruleId: number | null;
  tier: Tier;
  calculatedQty: number;
  explanation: string;
}

/* ───────────────────────── Formatting helpers ───────────────────────── */

/**
 * Remove float noise before rounding, so CEIL/FLOOR never land on the wrong integer.
 * Snaps to the nearest integer within a RELATIVE tolerance (1e-6 of the magnitude): ratios stored as
 * 8-decimal approximations (0.03333333 for 1/30) drift by ~1e-6 at 300 beds and more at larger scales.
 */
export function clean(n: number): number {
  const nearest = Math.round(n);
  if (Math.abs(n - nearest) <= 1e-6 * Math.max(1, Math.abs(n))) return nearest;
  return Math.round(n * 1e6) / 1e6;
}

/** 12 → "12", 0.5 → "0.5", 1200 → "1,200", 0.3333333 → "0.333". */
export function fmt(n: number): string {
  return clean(n).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

function isNearInteger(n: number) {
  return Math.abs(n - Math.round(n)) < 1e-6;
}

/** For a ratio below 1 with a whole reciprocal (0.01 → 100), return that reciprocal; otherwise null. */
export function reciprocal(ratio: number): number | null {
  if (!(ratio > 0 && ratio < 1)) return null;
  const r = 1 / ratio;
  return isNearInteger(r) ? Math.round(r) : null;
}

/**
 * The ratio in readable form, as used in tables and explanations:
 * "1 per bed", "0.5 per room", "2 per department", "1 per 100 hospital beds", "4 fixed".
 */
export function describeRatio(basis: Basis, ratio: number): string {
  switch (basis) {
    case "PER_BED": return `${fmt(ratio)} per bed`;
    case "PER_ROOM": return `${fmt(ratio)} per room`;
    case "PER_DEPARTMENT": return `${fmt(ratio)} per department`;
    case "PER_HOSPITAL_BEDS": {
      const r = reciprocal(ratio);
      return r ? `1 per ${fmt(r)} hospital beds` : `${fmt(ratio)} per hospital bed`;
    }
    case "FIXED": return `${fmt(ratio)} fixed`;
  }
}

/** A hint for ratios like 0.25 per bed → "1 per 4 beds". Null when the plain form is already clear. */
export function ratioHint(basis: Basis, ratio: number): string | null {
  const r = reciprocal(ratio);
  if (!r) return null;
  if (basis === "PER_BED") return `1 per ${fmt(r)} beds`;
  if (basis === "PER_ROOM") return `1 per ${fmt(r)} rooms`;
  return null;
}

/* ───────────────────────── Core calculation ───────────────────────── */

export function applyRounding(raw: number, mode: Rounding): number {
  const v = clean(raw);
  if (mode === "CEIL") return Math.ceil(v);
  if (mode === "FLOOR") return Math.floor(v);
  return Math.round(v);
}

/** Total beds for PER_HOSPITAL_BEDS rules: the BOQ's figure, or the sum of department beds when it is 0. */
export function effectiveHospitalBeds(totalHospitalBeds: number, departments: DepartmentInput[]): number {
  if (totalHospitalBeds > 0) return totalHospitalBeds;
  return departments
    .filter((d) => d.departmentTypeCode !== HOSPITAL_WIDE)
    .reduce((s, d) => s + Math.max(0, d.beds) * Math.max(0, d.instances), 0);
}

export interface QuantityResult {
  /** Quantity for one instance of the department (after rounding and clamps). */
  perInstance: number;
  /** Final quantity = perInstance × instances. */
  qty: number;
  explanation: string;
}

/**
 * Apply one rule to one department.
 * Hospital-wide (HOSP) departments use the hospital bed count for PER_BED rules when their own beds are 0.
 */
export function calculateQuantity(rule: RuleInput, dept: DepartmentInput, hospitalBeds: number): QuantityResult {
  const answer = rule.param ? dept.params?.[rule.param] : undefined;
  if (rule.param && rule.paramRatio != null && rule.paramRatio > 0 && answer != null && answer > 0) {
    return throughputQuantity(rule, dept, answer);
  }
  const ratio = rule.ratio;
  let count: number;
  let expr: string;
  switch (rule.basis) {
    case "PER_BED": {
      const useHospital = dept.departmentTypeCode === HOSPITAL_WIDE && dept.beds <= 0;
      count = useHospital ? hospitalBeds : Math.max(0, dept.beds);
      expr = `${useHospital ? plural(count, "hospital bed", "hospital beds") : plural(count, "bed", "beds")} × ${fmt(ratio)} per bed`;
      break;
    }
    case "PER_ROOM":
      count = Math.max(0, dept.rooms);
      expr = `${plural(count, "room", "rooms")} × ${fmt(ratio)} per room`;
      break;
    case "PER_DEPARTMENT":
      count = 1;
      expr = `${fmt(ratio)} per department`;
      break;
    case "PER_HOSPITAL_BEDS": {
      count = Math.max(0, hospitalBeds);
      const r = reciprocal(ratio);
      expr = `${plural(count, "hospital bed", "hospital beds")} × ${r ? `1 per ${fmt(r)} beds` : `${fmt(ratio)} per bed`}`;
      break;
    }
    case "FIXED":
      count = 1;
      expr = `Fixed quantity ${fmt(ratio)}`;
      break;
  }

  const raw = clean(count * ratio);
  const rounded = applyRounding(raw, rule.rounding);
  // FIXED has nothing to multiply; "2 per department = 2" still reads fine.
  let text = rule.basis === "FIXED" ? expr : `${expr} = ${fmt(raw)}`;
  if (rounded !== raw) {
    const how = rule.rounding === "CEIL" ? "rounded up" : rule.rounding === "FLOOR" ? "rounded down" : "rounded";
    text += `, ${how} → ${fmt(rounded)}`;
  }

  let perInstance = rounded;
  const min = Math.max(0, rule.minQty || 0);
  if (perInstance < min) {
    perInstance = min;
    text += `, minimum ${fmt(min)} → ${fmt(min)}`;
  }
  if (rule.maxQty !== null && rule.maxQty !== undefined && perInstance > rule.maxQty) {
    perInstance = Math.max(0, rule.maxQty);
    text += `, maximum ${fmt(rule.maxQty)} → ${fmt(perInstance)}`;
  }

  const instances = Math.max(0, Math.floor(dept.instances));
  const qty = perInstance * instances;
  if (instances !== 1) text += `; × ${plural(instances, "instance", "instances")} = ${fmt(qty)}`;
  return { perInstance, qty, explanation: text };
}

/**
 * Throughput quantity: the department's yearly answer × the rule's rate. The answer is for the whole department, so
 * instances don't multiply it.
 */
function throughputQuantity(rule: RuleInput, dept: DepartmentInput, answer: number): QuantityResult {
  const rate = rule.paramRatio!;
  const r = reciprocal(rate);
  const unit = paramUnit(rule.param!, dept.departmentTypeCode);
  const raw = clean(answer * rate);
  const rounded = applyRounding(raw, rule.rounding);
  let text = `${fmt(answer)} ${unit} a year × ${r ? `1 per ${fmt(r)}` : `${fmt(rate)} each`} = ${fmt(raw)}`;
  if (rounded !== raw) text += `, ${rule.rounding === "CEIL" ? "rounded up" : rule.rounding === "FLOOR" ? "rounded down" : "rounded"} → ${fmt(rounded)}`;
  let qty = rounded;
  const min = Math.max(0, rule.minQty || 0);
  if (qty < min) { qty = min; text += `, minimum ${fmt(min)} → ${fmt(min)}`; }
  if (rule.maxQty != null && qty > rule.maxQty) { qty = Math.max(0, rule.maxQty); text += `, maximum ${fmt(rule.maxQty)} → ${fmt(qty)}`; }
  return { perInstance: qty, qty, explanation: text };
}

/** Bases whose quantity is for the whole hospital rather than for each department. */
export function isHospitalScale(basis: Basis): boolean {
  return basis === "PER_HOSPITAL_BEDS" || basis === "FIXED";
}

/** True when HOSP rules would apply but the BOQ has no hospital-wide department to hang them on. */
export function needsHospitalWideDepartment(input: Pick<EngineInput, "rules" | "departments" | "includeTiers">): boolean {
  const hasRules = input.rules.some((r) => r.departmentTypeCode === HOSPITAL_WIDE && input.includeTiers.includes(r.tier));
  return hasRules && !input.departments.some((d) => d.departmentTypeCode === HOSPITAL_WIDE);
}

/** Apply every rule (filtered by tier) to every department of the matching type. Zero-quantity lines are dropped. */
export function generateLines(input: EngineInput): CalculatedLine[] {
  const hospitalBeds = effectiveHospitalBeds(input.totalHospitalBeds, input.departments);
  const byType = new Map<string, RuleInput[]>();
  const features = new Set(input.features ?? []);
  for (const r of input.rules) {
    if (!input.includeTiers.includes(r.tier)) continue;
    if (r.condition && !features.has(r.condition)) continue;
    const list = byType.get(r.departmentTypeCode) ?? [];
    list.push(r);
    byType.set(r.departmentTypeCode, list);
  }
  const deptsOfType = new Map<string, number>();
  for (const d of input.departments) deptsOfType.set(d.departmentTypeCode, (deptsOfType.get(d.departmentTypeCode) ?? 0) + 1);
  // Hospital-scale lines go on the main department of each type: most rooms, then most beds, then first listed.
  const homeOfType = new Map<string, DepartmentInput>();
  for (const d of input.departments) {
    const cur = homeOfType.get(d.departmentTypeCode);
    if (!cur || d.rooms > cur.rooms || (d.rooms === cur.rooms && d.beds > cur.beds)) homeOfType.set(d.departmentTypeCode, d);
  }

  const out: CalculatedLine[] = [];
  const placedOnce = new Set<number>(); // hospital-scale rules already placed in this BOQ
  for (const d of input.departments) {
    for (const rule of byType.get(d.departmentTypeCode) ?? []) {
      // PER_HOSPITAL_BEDS and FIXED describe a quantity for the whole hospital, not per department:
      // place them once, on the main department of the type, and never multiply by instances.
      const hospitalScale = isHospitalScale(rule.basis);
      if (hospitalScale) {
        if (homeOfType.get(d.departmentTypeCode) !== d || placedOnce.has(rule.id)) continue;
        placedOnce.add(rule.id);
      }
      const res = calculateQuantity(rule, hospitalScale ? { ...d, instances: 1 } : d, hospitalBeds);
      if (res.qty <= 0) continue;
      const shared = hospitalScale && ((deptsOfType.get(d.departmentTypeCode) ?? 1) > 1 || d.instances > 1);
      const why = shared ? `${res.explanation} (hospital-wide quantity, listed once for all ${d.departmentTypeCode} departments)` : res.explanation;
      out.push({
        boqDepartmentId: d.id, deviceTypeId: rule.deviceTypeId, ruleId: rule.id, tier: rule.tier, calculatedQty: res.qty,
        explanation: rule.condition ? `${featureLabel(rule.condition)}: ${why}` : why,
      });
    }
  }
  return input.companions?.length ? [...out, ...companionLines(out, input.companions, input.deviceName)] : out;
}

/**
 * Companion top-ups: for every line whose device has companions, the department needs ⌈qty × ratio⌉ of each
 * companion. What the rules (or earlier top-ups) already planned there counts; only the shortfall is added.
 * Companions of companions are not followed.
 */
export function companionLines(lines: CalculatedLine[], companions: CompanionInput[], deviceName: (id: number) => string = (id) => `device #${id}`): CalculatedLine[] {
  const byMain = new Map<number, CompanionInput[]>();
  for (const c of companions) if (c.ratio > 0 && c.companionTypeId !== c.deviceTypeId) byMain.set(c.deviceTypeId, [...(byMain.get(c.deviceTypeId) ?? []), c]);
  if (!byMain.size) return [];
  const planned = new Map<string, number>(); // dept:device → qty already in the BOQ
  for (const l of lines) planned.set(`${l.boqDepartmentId}:${l.deviceTypeId}`, (planned.get(`${l.boqDepartmentId}:${l.deviceTypeId}`) ?? 0) + l.calculatedQty);
  // Several main devices in one department can need the same companion: add up their needs first.
  const need = new Map<string, { dept: number; companion: number; qty: number; parts: string[]; tier: Tier }>();
  for (const l of lines) {
    for (const c of byMain.get(l.deviceTypeId) ?? []) {
      const k = `${l.boqDepartmentId}:${c.companionTypeId}`;
      const q = Math.ceil(clean(l.calculatedQty * c.ratio));
      const cur = need.get(k) ?? { dept: l.boqDepartmentId, companion: c.companionTypeId, qty: 0, parts: [], tier: l.tier };
      cur.qty += q;
      cur.parts.push(`${fmt(l.calculatedQty)} × ${deviceName(l.deviceTypeId)}${c.ratio !== 1 ? ` (${fmt(c.ratio)} each)` : ""}`);
      if (TIERS.indexOf(l.tier) < TIERS.indexOf(cur.tier)) cur.tier = l.tier;
      need.set(k, cur);
    }
  }
  const out: CalculatedLine[] = [];
  for (const [k, n] of need) {
    const have = planned.get(k) ?? 0;
    const add = n.qty - have;
    if (add <= 0) continue;
    out.push({
      boqDepartmentId: n.dept, deviceTypeId: n.companion, ruleId: null, tier: n.tier, calculatedQty: add,
      explanation: `Comes with ${n.parts.join(" and ")} = ${fmt(n.qty)}${have ? `; ${fmt(have)} already planned → ${fmt(add)} more` : ""}`,
    });
  }
  return out;
}

/* ───────────────────────── Regeneration merge ───────────────────────── */

export interface ExistingLine {
  id: number;
  boqDepartmentId: number | null;
  deviceTypeId: number;
  ruleId: number | null;
  tier: Tier;
  calculatedQty: number;
  quantity: number;
  isOverridden: boolean;
  isManual: boolean;
  calcExplanation: string | null;
}

export interface LineUpdate {
  id: number;
  calculatedQty: number;
  quantity: number;
  tier: Tier;
  ruleId: number | null;
  calcExplanation: string;
}

export type ChangeKind = "added" | "removed" | "changed" | "override-kept" | "override-orphaned";
export interface ChangeEntry {
  kind: ChangeKind;
  boqDepartmentId: number | null;
  deviceTypeId: number;
  /** Final quantity before / after. */
  from?: number;
  to?: number;
  /** For overrides: the calculated quantity before / after (the final quantity is kept). */
  calculatedFrom?: number;
  calculatedTo?: number;
}

export interface MergePlan {
  inserts: CalculatedLine[];
  updates: LineUpdate[];
  deletes: number[];
  changes: ChangeEntry[];
  counts: { added: number; removed: number; changed: number; unchanged: number; overridesKept: number; manualKept: number };
}

export const ORPHANED_OVERRIDE_NOTE =
  "No longer produced by the standard for this department — kept because the quantity was set by hand.";

const keyOf = (deptId: number | null, deviceTypeId: number) => `${deptId ?? "none"}:${deviceTypeId}`;

/**
 * Merge freshly calculated lines into the lines a BOQ already has.
 * - Manual lines (isManual) are never touched.
 * - Overridden lines keep their quantity; their calculatedQty / explanation / rule / tier are refreshed.
 *   If the standard no longer produces them they are kept with calculatedQty 0 and a note.
 * - Other rule lines are updated in place, inserted when new, deleted when the standard no longer produces them.
 */
export function mergeRegeneration(existing: ExistingLine[], calculated: CalculatedLine[]): MergePlan {
  const pool = new Map<string, ExistingLine[]>();
  let manualKept = 0;
  for (const l of existing) {
    if (l.isManual) { manualKept++; continue; }
    const k = keyOf(l.boqDepartmentId, l.deviceTypeId);
    const list = pool.get(k) ?? [];
    list.push(l);
    pool.set(k, list);
  }

  const plan: MergePlan = {
    inserts: [], updates: [], deletes: [], changes: [],
    counts: { added: 0, removed: 0, changed: 0, unchanged: 0, overridesKept: 0, manualKept },
  };

  for (const c of calculated) {
    const list = pool.get(keyOf(c.boqDepartmentId, c.deviceTypeId));
    const match = list?.shift();
    if (!match) {
      plan.inserts.push(c);
      plan.changes.push({ kind: "added", boqDepartmentId: c.boqDepartmentId, deviceTypeId: c.deviceTypeId, to: c.calculatedQty });
      plan.counts.added++;
      continue;
    }
    if (match.isOverridden) {
      plan.updates.push({ id: match.id, calculatedQty: c.calculatedQty, quantity: match.quantity, tier: c.tier, ruleId: c.ruleId, calcExplanation: c.explanation });
      plan.counts.overridesKept++;
      if (match.calculatedQty !== c.calculatedQty) {
        plan.changes.push({
          kind: "override-kept", boqDepartmentId: c.boqDepartmentId, deviceTypeId: c.deviceTypeId,
          from: match.quantity, to: match.quantity, calculatedFrom: match.calculatedQty, calculatedTo: c.calculatedQty,
        });
      }
      continue;
    }
    plan.updates.push({ id: match.id, calculatedQty: c.calculatedQty, quantity: c.calculatedQty, tier: c.tier, ruleId: c.ruleId, calcExplanation: c.explanation });
    if (match.quantity !== c.calculatedQty) {
      plan.changes.push({ kind: "changed", boqDepartmentId: c.boqDepartmentId, deviceTypeId: c.deviceTypeId, from: match.quantity, to: c.calculatedQty });
      plan.counts.changed++;
    } else {
      plan.counts.unchanged++;
    }
  }

  // Whatever is left in the pool is no longer produced by the standard.
  for (const list of pool.values()) {
    for (const l of list) {
      if (l.isOverridden) {
        plan.updates.push({ id: l.id, calculatedQty: 0, quantity: l.quantity, tier: l.tier, ruleId: null, calcExplanation: ORPHANED_OVERRIDE_NOTE });
        plan.counts.overridesKept++;
        plan.changes.push({
          kind: "override-orphaned", boqDepartmentId: l.boqDepartmentId, deviceTypeId: l.deviceTypeId,
          from: l.quantity, to: l.quantity, calculatedFrom: l.calculatedQty, calculatedTo: 0,
        });
      } else {
        plan.deletes.push(l.id);
        plan.counts.removed++;
        plan.changes.push({ kind: "removed", boqDepartmentId: l.boqDepartmentId, deviceTypeId: l.deviceTypeId, from: l.quantity });
      }
    }
  }
  return plan;
}

/**
 * Human summary of a regeneration, e.g.
 * "3 lines added, 1 removed, 4 quantities changed, 2 manual overrides kept, 1 manual line untouched."
 * followed by up to `maxDetails` bullet lines ("Adult ICU — Patient monitor, high acuity: 12 → 14").
 */
export function summarizeMerge(
  plan: MergePlan,
  names: { department: (id: number | null) => string; device: (id: number) => string },
  maxDetails = 25,
): string {
  const c = plan.counts;
  const parts: string[] = [];
  parts.push(`${c.added} ${c.added === 1 ? "line" : "lines"} added`);
  parts.push(`${c.removed} removed`);
  parts.push(`${c.changed} ${c.changed === 1 ? "quantity" : "quantities"} changed`);
  parts.push(`${c.unchanged} unchanged`);
  if (c.overridesKept) parts.push(`${c.overridesKept} manual ${c.overridesKept === 1 ? "override" : "overrides"} kept`);
  if (c.manualKept) parts.push(`${c.manualKept} manual ${c.manualKept === 1 ? "line" : "lines"} untouched`);
  let text = `${parts.join(", ")}.`;
  if (plan.changes.length === 0) return text + "\nNothing changed — the BOQ already matches the standard.";

  const lines = plan.changes.slice(0, maxDetails).map((ch) => {
    const who = `${names.department(ch.boqDepartmentId)} — ${names.device(ch.deviceTypeId)}`;
    switch (ch.kind) {
      case "added": return `• Added ${who}: ${ch.to}`;
      case "removed": return `• Removed ${who} (was ${ch.from})`;
      case "changed": return `• ${who}: ${ch.from} → ${ch.to}`;
      case "override-kept": return `• ${who}: kept your ${ch.to} (standard now says ${ch.calculatedTo}, was ${ch.calculatedFrom})`;
      case "override-orphaned": return `• ${who}: kept your ${ch.to} (no longer in the standard)`;
    }
  });
  if (plan.changes.length > maxDetails) lines.push(`• …and ${plan.changes.length - maxDetails} more`);
  text += "\n" + lines.join("\n");
  return text;
}

/* ───────────────────────── Input parsing ───────────────────────── */

/**
 * Parse a ratio typed by the user: "0.5", "2", "1/100" or "1:100" (both meaning 0.01). Null when invalid or negative.
 */
export function parseRatio(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (s === "") return null;
  const frac = s.match(/^(\d+(?:\.\d+)?)\s*[/:]\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    const a = Number(frac[1]), b = Number(frac[2]);
    return b > 0 ? clean(a / b) : null;
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
