/**
 * Risk flags on a BOQ (pure): single points of failure, gaps in life-critical equipment, budget and data problems,
 * and single-maker fleets in the hospital's register. Each flag says what to do about it.
 */
import { matchesDevice } from "./benchmarks";

export type RiskSeverity = "high" | "medium" | "low";
export type RiskFlag = { key: string; severity: RiskSeverity; title: string; detail: string };

export type RiskDept = { id: number; label: string; departmentTypeCode: string; beds: number; instances: number };
export type RiskLine = { boqDepartmentId: number | null; deviceCode: string; deviceName: string; quantity: number; tier: string; calculatedQty: number; isOverridden: boolean; unitPrice: number };
/** Units of a device type in the hospital's register, by maker (for single-source risk). */
export type FleetRow = { name: string; units: number; makers: number; maker: string | null };

/** Scanners where one unit means no service when it's down. */
const SINGLE_POINT = [
  { devices: ["IMG-CT-"], name: "CT scanner" },
  { devices: ["IMG-MRI-"], name: "MRI scanner" },
  { devices: ["IMG-ANG-", "IMG-XR-ANG", "CAR-CATH-"], name: "cath lab / angiography system" },
  { devices: ["LAB-BGA-ANL"], name: "blood gas analyser" },
];
const CRITICAL_CARE = new Set(["ICU", "CCU", "NICU", "ER", "PICU"]);
const NEEDS_DEFIB = new Set(["ICU", "CCU", "ER", "OR", "LDR", "WARD-MED", "WARD-SURG", "WARD-PED", "DIAL", "RAD", "CATH", "PACU"]);

export function riskFlags(input: {
  depts: RiskDept[]; lines: RiskLine[]; currency: string;
  grandTotal: number; targetBudget: number | null; unpricedLines: number;
  fleet?: FleetRow[]; money: (n: number) => string;
}): RiskFlag[] {
  const { depts, lines } = input;
  const flags: RiskFlag[] = [];
  const qty = (devices: string[], deptId?: number) => lines.filter((l) => (deptId == null || l.boqDepartmentId === deptId) && matchesDevice(l.deviceCode, devices)).reduce((t, l) => t + l.quantity, 0);

  for (const sp of SINGLE_POINT) {
    const n = qty(sp.devices);
    if (n === 1) flags.push({ key: `single:${sp.name}`, severity: "high", title: `One ${sp.name} and no backup`,
      detail: `When it is down, patients have to be sent elsewhere. Plan a second unit, or a service contract with a short response time and a transfer agreement.` });
  }
  for (const d of depts) {
    const beds = d.beds * Math.max(1, d.instances || 1);
    if (beds <= 0) continue;
    if (d.departmentTypeCode === "ICU") {
      const v = qty(["LIF-VEN-ICU", "LIF-VEN-TRN"], d.id);
      if (v < beds * 0.5) flags.push({ key: `vent:${d.id}`, severity: "high", title: `${d.label}: ${v} ventilator${v === 1 ? "" : "s"} for ${beds} beds`,
        detail: "Under one ventilator for every two ICU beds. Most ICUs plan close to one per bed." });
    }
    if (CRITICAL_CARE.has(d.departmentTypeCode) && qty(["MON-PAT-"], d.id) === 0) {
      flags.push({ key: `mon:${d.id}`, severity: "high", title: `${d.label}: no patient monitors`, detail: "A critical care area needs a monitor at every bed. Add patient monitors to this department." });
    }
    if (NEEDS_DEFIB.has(d.departmentTypeCode) && qty(["LIF-DEF-"], d.id) === 0) {
      flags.push({ key: `defib:${d.id}`, severity: "medium", title: `${d.label}: no defibrillator`, detail: "Every clinical area needs a defibrillator within reach (usually on the crash cart)." });
    }
  }
  const removed = lines.filter((l) => l.tier === "ESSENTIAL" && l.isOverridden && l.calculatedQty > 0 && l.quantity === 0);
  if (removed.length) flags.push({ key: "removed-essential", severity: "medium", title: `${removed.length} essential item${removed.length === 1 ? "" : "s"} removed by hand`,
    detail: `Set to 0 although the standard calls for them: ${removed.slice(0, 4).map((l) => l.deviceName).join(", ")}${removed.length > 4 ? "…" : ""}. Note the reason on each line.` });
  if (input.targetBudget != null && input.grandTotal > input.targetBudget) {
    const over = input.grandTotal - input.targetBudget;
    flags.push({ key: "budget", severity: over > input.targetBudget * 0.1 ? "high" : "medium", title: `${input.money(over)} over the target budget`,
      detail: "Use Fit to budget below to drop optional items and move recommended ones to a lower price tier, or raise the target." });
  }
  if (input.unpricedLines > 0) flags.push({ key: "unpriced", severity: "medium", title: `${input.unpricedLines} line${input.unpricedLines === 1 ? " has" : "s have"} no price`,
    detail: "The total understates the budget. Add a price band to the device type in the catalogue, or type a price on the line." });
  for (const f of input.fleet ?? []) {
    if (f.units >= 5 && f.makers === 1) flags.push({ key: `fleet:${f.name}`, severity: "low", title: `All ${f.units} ${f.name.toLowerCase()} units in the hospital are from ${f.maker ?? "one maker"}`,
      detail: "Standardised, which helps training and spares, but a single supplier for a life-critical fleet. Keep a second qualified supplier in mind for this purchase." });
  }
  const order: Record<RiskSeverity, number> = { high: 0, medium: 1, low: 2 };
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}
