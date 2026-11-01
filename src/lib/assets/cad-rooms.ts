/**
 * Rooms from CAD drawings (shared by the seed import and Facilities › Update drawings, wave 7): the building file
 * format the CAD pipeline writes (tools/cad → seed-data/cad/<name>.json), drawing department codes, and room type
 * and beds read from room names. Pure.
 */
import type { rooms } from "../../db/schema";

export type Pt = [number, number];
export type CadRoom = { code: string; name: string; dept: string | null; num: string | null; shape: string; area: number | null; poly: Pt[]; label: Pt };
export type CadFloor = { code: string; name: string; level: number; elevation: number; sourceFile: string; walls: number[]; doors: number[]; glass: number[]; columns: number[]; rooms: CadRoom[] };
export type CadBuilding = { name: string; facilityCode?: string; unitsPerMetre: number; planWidth: number; planHeight: number; floors: CadFloor[] };
export type RoomType = (typeof rooms.$inferInsert)["type"];

/** Drawing department codes → system department (type from seed-data/department-types.json; null = non-clinical). */
export const DEPARTMENTS: Record<string, { name: string; type: string | null }> = {
  OUT: { name: "Outpatient clinics", type: "OPD" },
  "M/S1": { name: "Medical-surgical unit 1", type: "WARD-MED" },
  "M/S2": { name: "Medical-surgical unit 2", type: "WARD-SURG" },
  ER: { name: "Emergency department", type: "ER" },
  END: { name: "Endoscopy", type: "ENDO" },
  IMA: { name: "Imaging", type: "RAD" },
  RHB: { name: "Rehabilitation", type: "REHAB" },
  PED: { name: "Paediatric therapy", type: "REHAB" },
  PHA: { name: "Pharmacy", type: "PHARM" },
  OBS: { name: "Observation unit", type: "ISO" },
  OBG: { name: "Obstetrics & gynaecology ward", type: "WARD-OBS" },
  DCU: { name: "Day care unit", type: "DAYSURG" },
  SS: { name: "Surgical suite", type: "OR" },
  "P/R": { name: "Pre-op & recovery", type: "PACU" },
  ICU1: { name: "Intensive care unit 1", type: "ICU" },
  ICU2: { name: "Intensive care unit 2", type: "ICU" },
  ICU3: { name: "Intensive care unit 3", type: "ICU" },
  ICU4: { name: "Intensive care unit 4", type: "ICU" },
  NIC: { name: "Non-invasive cardiology", type: null },
  CATH: { name: "Cath & interventional labs", type: "CATH" },
  ICU: { name: "Intensive care", type: "ICU" },
  CCU: { name: "Coronary care", type: "CCU" },
  NICU: { name: "Neonatal intensive care", type: "NICU" },
  PICU: { name: "Paediatric intensive care", type: "PICU" },
  OR: { name: "Operating theatres", type: "OR" },
  SUR: { name: "Surgery", type: "OR" },
  LAB: { name: "Laboratory", type: "LAB" },
  LDR: { name: "Labour & delivery", type: "LDR" },
  DIA: { name: "Dialysis", type: "DIAL" },
  ONC: { name: "Oncology", type: "ONC" },
  CSSD: { name: "Central sterile services", type: "CSSD" },
  MRG: { name: "Mortuary", type: "MORT" },
  GEN: { name: "General & building services", type: null },
  ST: { name: "Stairs & circulation", type: null },
  DIN: { name: "Food service", type: null },
  LIN: { name: "Linen", type: null },
  WRH: { name: "Warehouse", type: null },
  ADM: { name: "Administration", type: null },
};

/** Room type and beds from the room name (Revit room names as drawn). Order matters: first match wins. */
const ROOM_RULES: [RegExp, RoomType, number?][] = [
  [/CORRIDOR|ALCOVE|STAIR|LOBBY \(LIFT|AIR ?LOCK|VESTIBULE/, "CORRIDOR"],
  [/\bTLT\b|TOILET|SHWR|SHOWER|\bWC\b|LOCKER|CHANGING/, "OTHER"],
  [/^ALL ICU$/, "OTHER"],
  [/^(ICU|CCU|NICU)\b|^SCN \d|CRITICAL CARE|INTENSIVE/, "ICU_BAY", 1],
  [/OPERATING|THEATRE|GENERAL OR|\bOR\b \d|HYBRID OR|C-SECTION/, "OPERATING_ROOM"],
  [/\bCT\b|\bMRI\b|\bRAD\b|X-?RAY|ULTRASOUND|\bDXA\b|MAMMO|FLUORO|\bPET\b|NUCLEAR|CATH LAB|IR LAB/, "IMAGING_ROOM"],
  [/(MED\/SURG|GYNECOLOGY) DOUBLE|DOUBLE ROOM/, "PATIENT_ROOM", 2],
  [/(MED\/SURG|GYNECOLOGY) SINGLE|SINGLE ROOM|FAMILY SUITE|\bVIP\b|PATIENT ROOM|ISOLATION|^OBS$|ED EXAM|RESUS|^P\/R\b|INPATIENT HOLD/, "PATIENT_ROOM", 1],
  [/STRESS TEST|\bTEE\b|\bPFTS?\b|ECHO/, "PROCEDURE_ROOM"],
  [/ENDOSCOP|PROCEDURE|TREATMENT ROOM|MINOR OP/, "PROCEDURE_ROOM"],
  [/LAB(ORATORY)?\b|PATHOLOG|PHLEB/, "LAB"],
  [/PHARMACY|\bPREP\b|DISPENS/, "PHARMACY"],
  [/WORKSTATION|NU-CONTROL|NURSE STATION|NURSING STATION|\bCONTROL\b/, "NURSE_STATION"],
  [/EXAM|CONSULT|INTAKE|DENTAL|OPHTHAL|\bORL\b|THERAP|SENSORY|SPEECH|OCCUPATIONAL|CLINIC/, "CONSULTATION"],
  [/WAITING|RECEPTION|CAFETERIA|LOUNGE|FAMILY|LOBBY/, "WAITING"],
  [/STORE|LINEN|EQUIP|SUPPLIES|CLEAN|SOILED|WASTE|HSKP|HOLD|MEDS/, "STORE"],
  [/OFFICE|ADMIN|HEAD OF|MANAGER|CHART|RES\. WORK|MEETING|MULTI-DISP|STAFF|DOCTOR/, "OFFICE"],
  [/ELEC|HVAC|DATA|T\.R\.|SHAFT|PLANT|MECH|R\.M\.U|PUMP|GENERATOR|AGV/, "TECHNICAL"],
];
/** A room the drawing left unnamed carries its own code as its name (e.g. "B1-PHA-01"). */
const UNNAMED = /^[A-Z0-9]+(-[A-Z0-9/]+)+$/i;

/**
 * Names in context:
 * - In Endoscopy "P/R" means procedure room; elsewhere (day care, recovery) it is a prep/recovery bay.
 * - An unnamed room inside the pharmacy is a pharmacy store (Basement 1's B1-PHA-01, below the ground-floor pharmacy).
 */
export function contextual(name: string, dept?: string | null): string {
  if (dept === "END" && /^P\/R\b/i.test(name)) return `ENDO ${name}`;
  if (dept === "PHA" && UNNAMED.test(name.trim())) return "PHARMACY STORE";
  return name;
}

export function classifyRoom(rawName: string, dept?: string | null): { type: RoomType; beds: number } {
  const n = contextual(rawName, dept).toUpperCase();
  if (/^ENDO P\/R/.test(n)) return { type: "PROCEDURE_ROOM", beds: 0 };
  for (const [re, type, beds] of ROOM_RULES) if (re.test(n)) return { type, beds: beds ?? 0 };
  return { type: "OTHER", beds: 0 };
}


/** DWG multiline text can carry formatting codes ("\\pxqc;" alignment, "\\P" line breaks, braces); keep only the words. */
export function cleanCadText(s: string) {
  return s.replace(/\\[A-Za-z][^;\\]*;/g, " ").replace(/\\P/gi, " ").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

export function titleCase(s: string) {
  return cleanCadText(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Ct|Mri|Dxa|Icu|Ccu|Ed|Or|Orl|Vip|Tlt|Rad|Agv|Hvac|Rmu|Md|P\/R)\b/g, (m) => m.toUpperCase());
}
