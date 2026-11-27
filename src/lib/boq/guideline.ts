/**
 * National Medical Equipment Guideline (wave 41). Pure.
 *
 * GAHAR's 2025 equipment guideline lives in its own app and PAMS can't download it, so a planner types or pastes it
 * into the template: one row per department type, room type and device, with a quantity per room or per bed (or per
 * department). It loads as a BOQ standard set marked "National guideline (imported)". A BOQ is then compared with
 * it: devices missing, and quantities lower or higher than the guideline gives for the same departments.
 */
import { calculateQuantity, effectiveHospitalBeds, type Basis, type DepartmentInput, type RuleInput } from "./engine";
import { cellText, numberCell, textCell, type Column } from "../imports/table";

export const GUIDELINE_CODE_PREFIX = "NATGUIDE";
export const GUIDELINE_MARK = "National guideline (imported)";

export type GuidelineKey = "departmentType" | "roomType" | "deviceType" | "perRoom" | "perBed" | "perDepartment" | "notes" | "source" | "version";

export const GUIDELINE_COLUMNS: Column<GuidelineKey>[] = [
  { key: "departmentType", header: "Department type", required: true, hint: "Department type code or name (see the Department types sheet), e.g. ICU or Intensive care unit", example: "ICU", aliases: ["department"] },
  { key: "roomType", header: "Room type", hint: "As the guideline names it, e.g. ICU bed space, isolation room. Kept with the rule as a note", example: "ICU bed space", aliases: ["room"] },
  { key: "deviceType", header: "Device type", required: true, hint: "Device type code or exact name from the catalogue (see the Device types sheet)", example: "MON-PAT-HIGH", aliases: ["device", "device name", "device type name"] },
  { key: "perRoom", header: "Quantity per room", hint: "How many per room of the department. Fill one of the three quantity columns", example: "", aliases: ["per room"] },
  { key: "perBed", header: "Quantity per bed", hint: "How many per bed of the department", example: 1, aliases: ["per bed"] },
  { key: "perDepartment", header: "Quantity per department", hint: "How many per department, whatever its size", example: "", aliases: ["per department"] },
  { key: "notes", header: "Notes", hint: "Anything the guideline adds (conditions, alternatives)", example: "High-acuity monitor at every bed" },
  { key: "source", header: "Source", hint: "Where the row comes from, e.g. GAHAR National Medical Equipment Guideline", example: "GAHAR National Medical Equipment Guideline" },
  { key: "version", header: "Version", hint: "The guideline's version or year, the same on every row", example: "2025" },
];

export type GuidelineLookups = {
  /** lower-case code and lower-case name → department type code. */
  departmentTypes: Map<string, string>;
  /** lower-case code and lower-case name → level 3 device type. */
  deviceTypes: Map<string, { id: number; code: string; level: number }>;
};

export type GuidelineRule = {
  rowNumber: number; departmentTypeCode: string; deviceTypeId: number; deviceCode: string; basis: Basis; ratio: number;
  roomType: string | null; notes: string | null; source: string | null; version: string | null;
};

export type GuidelineRow = { rowNumber: number; values: Record<string, string | number | null>; errors: string[]; rule: GuidelineRule | null };

/** Check one row of the template. */
export function validateGuidelineRow(rowNumber: number, cells: Partial<Record<GuidelineKey, unknown>>, lk: GuidelineLookups): GuidelineRow {
  const errors: string[] = [];
  const values = Object.fromEntries(GUIDELINE_COLUMNS.map((c) => [c.key, cellText(cells[c.key]) || null]));
  const deptRaw = textCell(cells.departmentType, "Department type", errors, 120, true);
  const devRaw = textCell(cells.deviceType, "Device type", errors, 200, true);
  const dept = deptRaw ? lk.departmentTypes.get(deptRaw.toLowerCase()) : undefined;
  if (deptRaw && !dept) errors.push(`Department type "${deptRaw}" is not in the list.`);
  const dev = devRaw ? lk.deviceTypes.get(devRaw.toLowerCase()) : undefined;
  if (devRaw && !dev) errors.push(`Device type "${devRaw}" is not in the catalogue.`);
  else if (dev && dev.level !== 3) errors.push(`"${devRaw}" is a group or category; use a device type under it.`);
  const q = {
    PER_ROOM: numberCell(cells.perRoom, "Quantity per room", errors, { min: 0, max: 1000 }),
    PER_BED: numberCell(cells.perBed, "Quantity per bed", errors, { min: 0, max: 100 }),
    PER_DEPARTMENT: numberCell(cells.perDepartment, "Quantity per department", errors, { min: 0, max: 10000 }),
  };
  const given = (Object.entries(q) as [Basis, number | null][]).filter(([, v]) => v != null);
  if (given.length === 0) errors.push("Fill the quantity per room, per bed or per department.");
  if (given.length > 1) errors.push("Fill only one quantity column on a row; use two rows for two rules.");
  const roomType = textCell(cells.roomType, "Room type", errors, 120), notes = textCell(cells.notes, "Notes", errors, 1000);
  const source = textCell(cells.source, "Source", errors, 200), version = textCell(cells.version, "Version", errors, 16);
  const rule = errors.length || !dept || !dev ? null
    : { rowNumber, departmentTypeCode: dept, deviceTypeId: dev.id, deviceCode: dev.code, basis: given[0][0], ratio: given[0][1]!, roomType, notes, source, version };
  return { rowNumber, values, errors, rule };
}

/**
 * Check every row, then merge rows for the same department type and device: the same basis adds up (two room
 * types each with a monitor per room), a different basis is an error on the later row (one rule per device).
 * Every row must carry the same version (or none).
 */
export function validateGuideline(raw: { rowNumber: number; cells: Partial<Record<GuidelineKey, unknown>> }[], lk: GuidelineLookups): { rows: GuidelineRow[]; rules: GuidelineRule[]; version: string | null } {
  const rows = raw.map((r) => validateGuidelineRow(r.rowNumber, r.cells, lk));
  const versions = [...new Set(rows.map((r) => r.rule?.version).filter(Boolean))];
  if (versions.length > 1) for (const r of rows) if (r.rule?.version && r.rule.version !== versions[0]) { r.errors.push(`Every row must have the same version (${versions[0]}).`); r.rule = null; }
  const merged = new Map<string, GuidelineRule>();
  for (const r of rows) {
    if (!r.rule) continue;
    const key = `${r.rule.departmentTypeCode}|${r.rule.deviceTypeId}`;
    const was = merged.get(key);
    if (!was) { merged.set(key, { ...r.rule }); continue; }
    if (was.basis !== r.rule.basis) { r.errors.push(`Row ${was.rowNumber} gives this device for this department ${basisWord(was.basis)}; give it the same way here.`); r.rule = null; continue; }
    was.ratio += r.rule.ratio;
    was.roomType = [was.roomType, r.rule.roomType].filter(Boolean).join("; ") || null;
    was.notes = [was.notes, r.rule.notes].filter(Boolean).join("; ") || null;
  }
  return { rows, rules: [...merged.values()], version: (versions[0] as string | undefined) ?? null };
}

const basisWord = (b: Basis) => (b === "PER_ROOM" ? "per room" : b === "PER_BED" ? "per bed" : "per department");

/** The standard set code for a version: NATGUIDE-2025, NATGUIDE when there is no version. */
export function guidelineCode(version: string | null): string {
  const v = (version ?? "").toUpperCase().replace(/[^A-Z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return v ? `${GUIDELINE_CODE_PREFIX}-${v}` : GUIDELINE_CODE_PREFIX;
}

/** A rule text for the standard set: the room type and the notes. */
export const ruleNote = (r: Pick<GuidelineRule, "roomType" | "notes">) => [r.roomType && `Room: ${r.roomType}`, r.notes].filter(Boolean).join(". ") || null;

/* ── This BOQ vs the guideline ── */

export type CompareKind = "missing" | "lower" | "higher" | "same";
export type CompareRow = {
  boqDepartmentId: number; departmentLabel: string; deviceTypeId: number;
  guideline: number; boq: number; kind: CompareKind; explanation: string;
};

/**
 * Compare a BOQ's lines with what the guideline gives for its departments. Per BOQ department and device type:
 * missing (the guideline asks for some, the BOQ has none), lower, higher, or the same. Devices the BOQ has that the
 * guideline doesn't mention for that department type count as higher (guideline 0). Departments of a type the
 * guideline doesn't cover are left out (nothing to compare them with).
 */
export function compareWithGuideline(
  depts: (DepartmentInput & { label: string })[],
  lines: { boqDepartmentId: number | null; deviceTypeId: number; quantity: number }[],
  rules: RuleInput[], totalHospitalBeds: number,
): CompareRow[] {
  const beds = effectiveHospitalBeds(totalHospitalBeds, depts);
  const covered = new Set(rules.map((r) => r.departmentTypeCode));
  const out: CompareRow[] = [];
  for (const d of depts) {
    if (!covered.has(d.departmentTypeCode)) continue;
    const want = new Map<number, { qty: number; explanation: string }>();
    for (const r of rules.filter((x) => x.departmentTypeCode === d.departmentTypeCode)) {
      const q = calculateQuantity(r, d, beds);
      const was = want.get(r.deviceTypeId);
      want.set(r.deviceTypeId, { qty: (was?.qty ?? 0) + q.qty, explanation: was ? `${was.explanation}; ${q.explanation}` : q.explanation });
    }
    const have = new Map<number, number>();
    for (const l of lines) if (l.boqDepartmentId === d.id) have.set(l.deviceTypeId, (have.get(l.deviceTypeId) ?? 0) + l.quantity);
    for (const id of new Set([...want.keys(), ...have.keys()])) {
      const g = want.get(id)?.qty ?? 0, b = have.get(id) ?? 0;
      if (g === 0 && b === 0) continue;
      const kind: CompareKind = g > 0 && b === 0 ? "missing" : b < g ? "lower" : b > g ? "higher" : "same";
      out.push({ boqDepartmentId: d.id, departmentLabel: d.label, deviceTypeId: id, guideline: g, boq: b, kind, explanation: want.get(id)?.explanation ?? "Not in the guideline for this department" });
    }
  }
  const order: Record<CompareKind, number> = { missing: 0, lower: 1, higher: 2, same: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.departmentLabel.localeCompare(b.departmentLabel) || a.deviceTypeId - b.deviceTypeId);
}

export function compareCounts(rows: CompareRow[]): Record<CompareKind, number> {
  const c: Record<CompareKind, number> = { missing: 0, lower: 0, higher: 0, same: 0 };
  for (const r of rows) c[r.kind]++;
  return c;
}
