/**
 * Benchmarks: the plan's density of key devices against reference ranges (pure).
 * Reference ranges checked against published sources where they exist (docs/reference-figures.md); the rest are
 * planning judgement. To be confirmed by the hospital's biomedical team.
 * A device match is an exact code or a code prefix ending in "-" (e.g. "IMG-CT-" for every CT scanner).
 */

export type Benchmark = {
  department: string;           // department type code
  devices: string[];
  label: string;
  /** per bed (or chair/cot), per room, or per 100 hospital beds */
  per: "bed" | "room" | "hospital100";
  min: number; max: number;
};

export const BENCHMARKS: Benchmark[] = [
  { department: "ICU", devices: ["LIF-VEN-ICU"], label: "ICU ventilators", per: "bed", min: 0.8, max: 1.2 },
  { department: "ICU", devices: ["MON-PAT-HIGH"], label: "High-acuity monitors", per: "bed", min: 1, max: 1.2 },
  { department: "ICU", devices: ["INF-PMP-SYR"], label: "Syringe pumps", per: "bed", min: 3, max: 6 },
  { department: "ICU", devices: ["INF-PMP-VOL"], label: "Volumetric pumps", per: "bed", min: 1, max: 3 },
  { department: "ICU", devices: ["LIF-DEF-"], label: "Defibrillators", per: "bed", min: 0.08, max: 0.25 },
  { department: "CCU", devices: ["MON-PAT-HIGH", "MON-PAT-MID"], label: "Patient monitors", per: "bed", min: 1, max: 1.2 },
  { department: "CCU", devices: ["LIF-DEF-"], label: "Defibrillators", per: "bed", min: 0.08, max: 0.25 },
  { department: "NICU", devices: ["LIF-NEO-INC"], label: "Incubators", per: "bed", min: 0.7, max: 1 },
  { department: "NICU", devices: ["LIF-VEN-NEO"], label: "Neonatal ventilators", per: "bed", min: 0.3, max: 0.7 },
  { department: "NICU", devices: ["INF-PMP-SYR"], label: "Syringe pumps", per: "bed", min: 1, max: 3 },
  { department: "ER", devices: ["MON-PAT-HIGH", "MON-PAT-MID"], label: "Patient monitors", per: "bed", min: 0.6, max: 1.2 },
  { department: "ER", devices: ["LIF-VEN-"], label: "Ventilators", per: "bed", min: 0.1, max: 0.3 },
  { department: "ER", devices: ["LIF-DEF-"], label: "Defibrillators", per: "bed", min: 0.05, max: 0.2 },
  { department: "OR", devices: ["SUR-OR-TABLE"], label: "Operating tables", per: "room", min: 1, max: 1 },
  { department: "OR", devices: ["LIF-ANE-WS"], label: "Anaesthesia machines", per: "room", min: 1, max: 1.1 },
  { department: "OR", devices: ["MON-PAT-HIGH"], label: "High-acuity monitors", per: "room", min: 1, max: 1.2 },
  { department: "OR", devices: ["SUR-OR-ESU"], label: "Electrosurgical units", per: "room", min: 0.8, max: 1.2 },
  { department: "WARD-MED", devices: ["INF-PMP-VOL"], label: "Volumetric pumps", per: "bed", min: 0.15, max: 0.5 },
  { department: "WARD-MED", devices: ["LIF-DEF-"], label: "Defibrillators", per: "bed", min: 0.02, max: 0.06 },
  { department: "WARD-SURG", devices: ["INF-PMP-VOL"], label: "Volumetric pumps", per: "bed", min: 0.15, max: 0.5 },
  { department: "WARD-SURG", devices: ["LIF-DEF-"], label: "Defibrillators", per: "bed", min: 0.02, max: 0.06 },
  { department: "LDR", devices: ["OBG-FET-CTG"], label: "CTG monitors", per: "bed", min: 0.8, max: 1.2 },
  { department: "LDR", devices: ["LIF-NEO-RW"], label: "Infant warmers", per: "bed", min: 0.8, max: 1.2 },
  { department: "DIAL", devices: ["THR-HD-MCH"], label: "Dialysis machines per chair", per: "bed", min: 1, max: 1.25 },
  { department: "RAD", devices: ["IMG-CT-"], label: "CT scanners per 100 hospital beds", per: "hospital100", min: 0.2, max: 0.6 },
  { department: "RAD", devices: ["IMG-XR-DR", "IMG-XR-MDR"], label: "X-ray units per 100 hospital beds", per: "hospital100", min: 0.8, max: 2 },
];

export const matchesDevice = (code: string, devices: string[]) => devices.some((d) => (d.endsWith("-") ? code.startsWith(d) : code === d));

export type BenchDept = { id: number; label: string; departmentTypeCode: string; beds: number; rooms: number; instances: number };
export type BenchLine = { boqDepartmentId: number | null; deviceCode: string; quantity: number };
export type BenchResult = {
  departmentId: number; department: string; label: string; per: Benchmark["per"];
  quantity: number; basis: number; value: number; min: number; max: number;
  status: "under" | "ok" | "over";
};

export function checkBenchmarks(depts: BenchDept[], lines: BenchLine[], totalHospitalBeds: number, list: Benchmark[] = BENCHMARKS): BenchResult[] {
  const out: BenchResult[] = [];
  for (const d of depts) {
    const n = Math.max(1, d.instances || 1);
    for (const b of list.filter((x) => x.department === d.departmentTypeCode)) {
      const basis = b.per === "bed" ? d.beds * n : b.per === "room" ? d.rooms * n : totalHospitalBeds / 100;
      if (!(basis > 0)) continue;
      const quantity = lines.filter((l) => l.boqDepartmentId === d.id && matchesDevice(l.deviceCode, b.devices)).reduce((t, l) => t + l.quantity, 0);
      const value = Math.round((quantity / basis) * 1000) / 1000;
      out.push({
        departmentId: d.id, department: d.label, label: b.label, per: b.per, quantity, basis, value, min: b.min, max: b.max,
        status: value < b.min - 1e-9 ? "under" : value > b.max + 1e-9 ? "over" : "ok",
      });
    }
  }
  return out;
}

export const PER_LABEL: Record<Benchmark["per"], string> = { bed: "per bed", room: "per room", hospital100: "per 100 hospital beds" };
