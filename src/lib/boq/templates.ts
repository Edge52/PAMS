/**
 * Hospital templates and the quick-start wizard's answers → BOQ scope. Pure — tested, and shared by the wizard
 * (live defaults), the preview and the create action.
 *
 * The wizard asks about eight things (hospital type, beds, services, special conditions, budget, building); this turns
 * the answers into BOQ departments with beds, rooms and planning answers. The BOQ engine then applies the standard,
 * so every quantity still explains itself. Every assumption made here is returned in plain words for the review step.
 */
import type { FeatureKey } from "./questions";
import type { PriceTier } from "./pricing";

export const HOSPITAL_TYPES = ["general", "specialized", "teaching", "womenChildren"] as const;
export type HospitalType = (typeof HOSPITAL_TYPES)[number];
export type Ownership = "government" | "private";

export type Services = {
  emergency: boolean;
  theatres: number;
  cathLab: boolean;
  ct: boolean;
  mri: boolean;
  mammography: boolean;
  laboratory: boolean;
  dialysisChairs: number;
  deliveriesPerYear: number;
  clinics: number;
  endoscopy: boolean;
  pharmacy: boolean;
  sterileServices: boolean;
  physiotherapy: boolean;
};

export type QuickStartAnswers = {
  name: string;
  type: HospitalType;
  ownership: Ownership;
  totalBeds: number;
  icuBeds: number;
  ccuBeds: number;
  nicuBeds: number;
  isolationBeds: number;
  services: Services;
  features: FeatureKey[];
  priceTier: PriceTier;
  targetBudget: number | null;
  currency: string;
  facilityId: number | null;
};

type Template = {
  label: string;
  description: string;
  beds: number;
  /** Share of total beds for critical care and isolation. */
  shares: { icu: number; ccu: number; nicu: number; isolation: number };
  /** Split of the remaining general beds between ward types. */
  wards: { med: number; surg: number; ped: number; obs: number };
  features: FeatureKey[];
  services: (beds: number) => Services;
  /** Standard set used: the tertiary set for teaching and specialised hospitals. */
  standardSet: "HPAMS-GEN-2026" | "HPAMS-TERT-2026";
};

const yes = true, no = false;
export const TEMPLATES: Record<HospitalType, Template> = {
  general: {
    label: "General hospital", description: "Emergency, critical care, theatres, medical, surgical, paediatric and maternity wards, imaging, lab.",
    beds: 150, shares: { icu: 0.08, ccu: 0.03, nicu: 0.04, isolation: 0.02 }, wards: { med: 0.4, surg: 0.3, ped: 0.15, obs: 0.15 }, features: [],
    services: (b) => ({ emergency: yes, theatres: Math.max(2, Math.round(b / 30)), cathLab: b >= 150, ct: yes, mri: b >= 150, mammography: b >= 150,
      laboratory: yes, dialysisChairs: Math.round(b / 15), deliveriesPerYear: b * 12, clinics: Math.max(4, Math.round(b / 8)), endoscopy: yes,
      pharmacy: yes, sterileServices: yes, physiotherapy: yes }),
    standardSet: "HPAMS-GEN-2026",
  },
  specialized: {
    label: "Specialised hospital", description: "A heart, surgical or cancer centre: more critical care and theatres, no maternity.",
    beds: 100, shares: { icu: 0.15, ccu: 0.1, nicu: 0, isolation: 0.02 }, wards: { med: 0.35, surg: 0.65, ped: 0, obs: 0 }, features: ["cardiacSurgery"],
    services: (b) => ({ emergency: yes, theatres: Math.max(3, Math.round(b / 15)), cathLab: yes, ct: yes, mri: yes, mammography: no,
      laboratory: yes, dialysisChairs: Math.round(b / 25), deliveriesPerYear: 0, clinics: Math.max(4, Math.round(b / 6)), endoscopy: yes,
      pharmacy: yes, sterileServices: yes, physiotherapy: yes }),
    standardSet: "HPAMS-TERT-2026",
  },
  teaching: {
    label: "Teaching hospital", description: "University hospital: every service, trauma centre, training lists.",
    beds: 400, shares: { icu: 0.1, ccu: 0.04, nicu: 0.05, isolation: 0.03 }, wards: { med: 0.4, surg: 0.35, ped: 0.12, obs: 0.13 }, features: ["teaching", "trauma"],
    services: (b) => ({ emergency: yes, theatres: Math.max(6, Math.round(b / 25)), cathLab: yes, ct: yes, mri: yes, mammography: yes,
      laboratory: yes, dialysisChairs: Math.round(b / 12), deliveriesPerYear: b * 10, clinics: Math.round(b / 6), endoscopy: yes,
      pharmacy: yes, sterileServices: yes, physiotherapy: yes }),
    standardSet: "HPAMS-TERT-2026",
  },
  womenChildren: {
    label: "Women and children's hospital", description: "Maternity, neonatal and paediatric care with its own theatres and imaging.",
    beds: 50, shares: { icu: 0.06, ccu: 0, nicu: 0.2, isolation: 0.02 }, wards: { med: 0, surg: 0.1, ped: 0.45, obs: 0.45 }, features: ["nicuLevel3"],
    services: (b) => ({ emergency: yes, theatres: Math.max(2, Math.round(b / 20)), cathLab: no, ct: yes, mri: b >= 100, mammography: yes,
      laboratory: yes, dialysisChairs: 0, deliveriesPerYear: b * 60, clinics: Math.max(4, Math.round(b / 5)), endoscopy: no,
      pharmacy: yes, sterileServices: yes, physiotherapy: no }),
    standardSet: "HPAMS-GEN-2026",
  },
};

/** Answers pre-filled from a template; ownership sets the default price tier (government standard, private premium). */
export function defaultAnswers(type: HospitalType, ownership: Ownership = "government", totalBeds?: number): QuickStartAnswers {
  const t = TEMPLATES[type];
  const beds = totalBeds && totalBeds > 0 ? Math.round(totalBeds) : t.beds;
  return {
    name: "", type, ownership, totalBeds: beds, ...bedSplit(type, beds), services: t.services(beds), features: [...t.features],
    priceTier: ownership === "private" ? "PREMIUM" : "STANDARD", targetBudget: null, currency: "EGP", facilityId: null,
  };
}

/** Default critical-care and isolation beds as a share of total beds (each at least the minimum a unit needs, or 0). */
export function bedSplit(type: HospitalType, totalBeds: number) {
  const s = TEMPLATES[type].shares;
  const unit = (share: number, min: number) => (share <= 0 ? 0 : Math.max(min, Math.round(totalBeds * share)));
  return { icuBeds: unit(s.icu, 4), ccuBeds: unit(s.ccu, 4), nicuBeds: unit(s.nicu, 4), isolationBeds: unit(s.isolation, 2) };
}

export type ScopeDepartment = { departmentTypeCode: string; label: string; beds: number; rooms: number; instances: number; params: Record<string, number> };
export type Scope = { departments: ScopeDepartment[]; standardSet: string; assumptions: string[]; problems: string[] };

/** Typical yearly imaging per bed, used to size CT and MRI when the service is on (adjust in the BOQ afterwards). */
export const EXAMS_PER_BED = { ct: 55, mri: 20 };
/** Beds per ward room (four-bed bays and a few singles). */
const BEDS_PER_ROOM = 3.5;

/** Turn the answers into BOQ departments. `problems` are blocking (shown on the beds step); `assumptions` explain defaults. */
export function buildScope(a: QuickStartAnswers): Scope {
  const t = TEMPLATES[a.type];
  const problems: string[] = [];
  const assumptions: string[] = [];
  const s = a.services;
  const critical = a.icuBeds + a.ccuBeds + a.nicuBeds + a.isolationBeds;
  if (!(a.totalBeds > 0)) problems.push("Enter the total number of beds.");
  if (critical > a.totalBeds * 0.7) problems.push(`Critical care and isolation (${critical} beds) can't be more than 70 % of all ${a.totalBeds} beds.`);
  for (const [k, v] of Object.entries({ "ICU beds": a.icuBeds, "CCU beds": a.ccuBeds, "NICU beds": a.nicuBeds, "Isolation beds": a.isolationBeds, Theatres: s.theatres, "Dialysis chairs": s.dialysisChairs, Clinics: s.clinics, "Deliveries a year": s.deliveriesPerYear })) {
    if (!Number.isFinite(v) || v < 0) problems.push(`${k} can't be negative.`);
  }
  const d: ScopeDepartment[] = [];
  const add = (code: string, label: string, beds: number, rooms: number, params: Record<string, number> = {}) =>
    d.push({ departmentTypeCode: code, label, beds: Math.max(0, Math.round(beds)), rooms: Math.max(0, Math.round(rooms)), instances: 1, params });

  // Wards share the beds left after critical care and isolation; no maternity → its share goes to medicine/surgery.
  const general = Math.max(0, a.totalBeds - critical);
  const w = { ...t.wards };
  if (s.deliveriesPerYear <= 0 && w.obs > 0) { w.med += w.obs * 0.6; w.surg += w.obs * 0.4; w.obs = 0; }
  if (s.deliveriesPerYear > 0 && w.obs === 0) { w.obs = 0.1; w.med = Math.max(0, w.med - 0.1); }
  const sum = w.med + w.surg + w.ped + w.obs || 1;
  const wardBeds = { med: Math.round(general * w.med / sum), surg: Math.round(general * w.surg / sum), ped: Math.round(general * w.ped / sum), obs: 0 };
  wardBeds.obs = Math.max(0, general - wardBeds.med - wardBeds.surg - wardBeds.ped);
  if (w.obs === 0 && wardBeds.obs > 0) { wardBeds.med += wardBeds.obs; wardBeds.obs = 0; }
  assumptions.push(`${general} general beds split ${wardBeds.med} medical, ${wardBeds.surg} surgical, ${wardBeds.ped} paediatric, ${wardBeds.obs} maternity; about ${BEDS_PER_ROOM} beds per room.`);

  if (s.emergency) {
    const er = Math.max(6, Math.round(a.totalBeds * 0.08));
    add("ER", "Emergency department", er, Math.ceil(er / 3));
    assumptions.push(`Emergency: ${er} treatment spaces (about 8 % of beds).`);
  }
  if (a.icuBeds) add("ICU", "Adult intensive care", a.icuBeds, a.icuBeds);
  if (a.ccuBeds) add("CCU", "Coronary care", a.ccuBeds, a.ccuBeds);
  if (a.nicuBeds) add("NICU", "Neonatal intensive care", a.nicuBeds, Math.ceil(a.nicuBeds / 4));
  if (a.isolationBeds) add("ISO", "Isolation rooms", a.isolationBeds, a.isolationBeds);
  if (s.theatres > 0) {
    add("OR", "Operating theatres", 0, s.theatres);
    add("PACU", "Recovery", Math.ceil(s.theatres * 1.5), 1);
    assumptions.push(`Recovery: ${Math.ceil(s.theatres * 1.5)} bays (1.5 per theatre).`);
  }
  if (wardBeds.med) add("WARD-MED", "Medical ward", wardBeds.med, Math.ceil(wardBeds.med / BEDS_PER_ROOM));
  if (wardBeds.surg) add("WARD-SURG", "Surgical ward", wardBeds.surg, Math.ceil(wardBeds.surg / BEDS_PER_ROOM));
  if (wardBeds.ped) add("WARD-PED", "Paediatric ward", wardBeds.ped, Math.ceil(wardBeds.ped / BEDS_PER_ROOM));
  if (wardBeds.obs) add("WARD-OBS", "Maternity ward", wardBeds.obs, Math.ceil(wardBeds.obs / BEDS_PER_ROOM));
  if (s.deliveriesPerYear > 0) {
    const ldr = Math.max(2, Math.ceil(s.deliveriesPerYear / 400));
    add("LDR", "Labour and delivery", ldr, ldr, { deliveries: s.deliveriesPerYear });
    assumptions.push(`Labour and delivery: ${ldr} delivery rooms for ${s.deliveriesPerYear.toLocaleString("en-US")} deliveries a year (about 400 each).`);
  }
  if (s.cathLab) add("CATH", "Cardiac catheterisation lab", 0, a.totalBeds >= 300 ? 2 : 1);
  if (s.ct || s.mri || s.mammography || s.emergency) {
    const ctExams = s.ct ? Math.round(a.totalBeds * EXAMS_PER_BED.ct) : 0;
    const mriExams = s.mri ? Math.round(a.totalBeds * EXAMS_PER_BED.mri) : 0;
    const rooms = 3 + (s.ct ? 1 : 0) + (s.mri ? 1 : 0) + (s.mammography ? 1 : 0);
    add("RAD", "Radiology", 0, rooms, { ctExams, mriExams });
    assumptions.push(s.ct ? `CT: about ${ctExams.toLocaleString("en-US")} exams a year (${EXAMS_PER_BED.ct} per bed).` : "No CT service.");
    assumptions.push(s.mri ? `MRI: about ${mriExams.toLocaleString("en-US")} exams a year (${EXAMS_PER_BED.mri} per bed).` : "No MRI service.");
  }
  if (s.laboratory) add("LAB", "Clinical laboratory", 0, 3);
  if (s.dialysisChairs > 0) add("DIAL", "Haemodialysis", s.dialysisChairs, 1);
  if (s.endoscopy) add("ENDO", "Endoscopy", 0, a.totalBeds >= 300 ? 2 : 1);
  if (s.clinics > 0) add("OPD", "Outpatient clinics", 0, s.clinics);
  if (s.physiotherapy) add("REHAB", "Physiotherapy", 0, 2);
  if (s.pharmacy) add("PHARM", "Pharmacy", 0, 1);
  if (s.sterileServices) add("CSSD", "Central sterile services", 0, 1);
  if (a.features.includes("oncology")) add("ONC", "Oncology day unit", 0, 4);
  return { departments: d, standardSet: t.standardSet, assumptions, problems };
}
