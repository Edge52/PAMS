/**
 * Starter pathways (wave 7, step 7b) to copy into a hospital and edit. Steps name department types and room-name
 * patterns; copying resolves them against the hospital's own departments and rooms. Times, shares and volumes are
 * planning assumptions for a mid-size general hospital, stated in each description; edit them for your hospital.
 */
import type { FlowKind, Link, Step, StepKind, Transport, Urgency } from "./model";

type StarterStep = { key: string; label: string; kind: StepKind; deptTypes?: string[]; room?: string; minutes?: number; accompanying?: string; equipment?: string[] };
type StarterLink = { from: string; to: string; share?: number; transport?: Transport; urgency?: Urgency; condition?: string };
export type Starter = { id: string; name: string; kind: FlowKind; dailyVolume: number; description: string; arrival: number[]; steps: StarterStep[]; links: StarterLink[] };

/** Normalise 24 hourly weights to shares of the day. */
const profile = (w: number[]) => { const t = w.reduce((a, b) => a + b, 0); return w.map((x) => Math.round((x / t) * 10000) / 10000); };
const EMERGENCY = profile([2, 2, 1.5, 1.2, 1, 1, 1.3, 2, 3, 4, 4.6, 5, 4.8, 4.4, 4.2, 4.2, 4.4, 4.8, 5.2, 5.2, 4.6, 3.8, 3, 2.4]);
const ELECTIVE = profile([0, 0, 0, 0, 0, 0, 1, 6, 8, 8, 7, 6, 5, 5, 4, 3, 1, 0, 0, 0, 0, 0, 0, 0]);
const CLINIC = profile([0, 0, 0, 0, 0, 0, 0, 3, 9, 10, 10, 9, 7, 7, 6, 4, 1, 0, 0, 0, 0, 0, 0, 0]);
const ROUND_CLOCK = profile([3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3]);

export const STARTERS: Starter[] = [
  {
    id: "trauma", name: "Emergency trauma — arrival to ICU", kind: "PATIENT", dailyVolume: 6, arrival: EMERGENCY,
    description: "Major trauma by ambulance: resuscitation, CT, then theatre, ICU or a ward. Assumed: 6 patients a day; 30 % need surgery, 50 % go straight to ICU, 20 % to a surgical ward. Times are typical planning values, not measurements.",
    steps: [
      { key: "s1", label: "Ambulance arrival", kind: "START", deptTypes: ["ER"], room: "AMBULANCE|EMERGENCY ENTRANCE|ER ENTRANCE" },
      { key: "s2", label: "Resuscitation", kind: "STEP", deptTypes: ["ER"], room: "RESUS|TRAUMA", minutes: 40, accompanying: "Emergency doctor, nurse", equipment: ["MON-PAT-HIGH", "LIF-DEF-MAN", "LIF-VEN-TRN"] },
      { key: "s3", label: "CT scan", kind: "STEP", deptTypes: ["RAD"], room: "^CT\\b", minutes: 20, accompanying: "Nurse, porter", equipment: ["IMG-CT-128", "MON-PAT-TRN"] },
      { key: "s4", label: "Emergency surgery", kind: "STEP", deptTypes: ["OR"], room: "OPERATING|THEATRE|\\bOR\\b", minutes: 150, accompanying: "Anaesthetist, porter", equipment: ["SUR-OR-TABLE", "LIF-ANE-WS"] },
      { key: "s5", label: "Intensive care", kind: "STEP", deptTypes: ["ICU"], room: "^ICU\\b", minutes: 4320, equipment: ["FUR-BED-ICU", "LIF-VEN-ICU", "MON-PAT-HIGH"] },
      { key: "s6", label: "Surgical ward", kind: "STEP", deptTypes: ["WARD-SURG", "WARD-MED"], minutes: 5760, equipment: ["FUR-BED-WARD"] },
      { key: "s7", label: "Discharge", kind: "END" },
    ],
    links: [
      { from: "s1", to: "s2", transport: "BED", urgency: "URGENT" },
      { from: "s2", to: "s3", transport: "BED", urgency: "URGENT" },
      { from: "s3", to: "s4", share: 30, transport: "BED", urgency: "URGENT", condition: "if surgery needed" },
      { from: "s3", to: "s5", share: 50, transport: "BED", urgency: "URGENT", condition: "if critical" },
      { from: "s3", to: "s6", share: 20, transport: "BED" },
      { from: "s4", to: "s5", transport: "BED", urgency: "URGENT" },
      { from: "s5", to: "s6", transport: "BED" },
      { from: "s6", to: "s7", transport: "WHEELCHAIR" },
    ],
  },
  {
    id: "elective", name: "Elective surgery — admission to discharge", kind: "PATIENT", dailyVolume: 20, arrival: ELECTIVE,
    description: "Planned surgery: admission, pre-op, theatre, recovery, ward, discharge. Assumed: 20 patients a day on the theatre schedule; 2 days on the ward.",
    steps: [
      { key: "s1", label: "Admission", kind: "START", deptTypes: ["WARD-SURG", "DAYSURG"], room: "RECEPTION|ADMISSION" },
      { key: "s2", label: "Pre-op preparation", kind: "STEP", deptTypes: ["PACU", "DAYSURG"], room: "PRE-?OP|HOLDING|PREP", minutes: 60, accompanying: "Nurse" },
      { key: "s3", label: "Theatre", kind: "STEP", deptTypes: ["OR"], room: "OPERATING|THEATRE|\\bOR\\b", minutes: 120, accompanying: "Porter", equipment: ["SUR-OR-TABLE", "SUR-OR-LIGHT", "LIF-ANE-WS"] },
      { key: "s4", label: "Recovery", kind: "STEP", deptTypes: ["PACU"], room: "RECOVERY|PACU|P\\/R", minutes: 60, equipment: ["MON-PAT-MID"] },
      { key: "s5", label: "Surgical ward", kind: "STEP", deptTypes: ["WARD-SURG"], minutes: 2880, equipment: ["FUR-BED-WARD"] },
      { key: "s6", label: "Discharge", kind: "END" },
    ],
    links: [
      { from: "s1", to: "s2", transport: "FOOT" }, { from: "s2", to: "s3", transport: "TROLLEY" },
      { from: "s3", to: "s4", transport: "BED" }, { from: "s4", to: "s5", transport: "BED" }, { from: "s5", to: "s6", transport: "FOOT" },
    ],
  },
  {
    id: "maternity", name: "Maternity — triage to postnatal", kind: "PATIENT", dailyVolume: 8, arrival: ROUND_CLOCK,
    description: "Labour: triage, labour and delivery room, caesarean section when needed, postnatal ward. Assumed: 8 births a day, 15 % by caesarean section.",
    steps: [
      { key: "s1", label: "Arrival", kind: "START", deptTypes: ["LDR", "WARD-OBS"], room: "RECEPTION|ENTRANCE" },
      { key: "s2", label: "Obstetric triage", kind: "STEP", deptTypes: ["LDR", "WARD-OBS"], room: "TRIAGE", minutes: 30, equipment: ["OBG-FET-CTG"] },
      { key: "s3", label: "Labour & delivery room", kind: "STEP", deptTypes: ["LDR"], room: "\\bLDR\\b|DELIVERY", minutes: 480, equipment: ["OBG-DEL-BED", "OBG-FET-CTG", "LIF-NEO-RW"] },
      { key: "s4", label: "Caesarean section", kind: "STEP", deptTypes: ["LDR", "OR"], room: "C-SECTION", minutes: 90, equipment: ["SUR-OR-TABLE", "LIF-ANE-WS", "LIF-NEO-RW"] },
      { key: "s5", label: "Postnatal ward", kind: "STEP", deptTypes: ["WARD-OBS"], minutes: 2880, equipment: ["FUR-BED-WARD", "FUR-BED-BAS"] },
      { key: "s6", label: "Discharge", kind: "END" },
    ],
    links: [
      { from: "s1", to: "s2", transport: "WHEELCHAIR" }, { from: "s2", to: "s3", transport: "WHEELCHAIR" },
      { from: "s3", to: "s5", share: 85, transport: "BED" },
      { from: "s3", to: "s4", share: 15, transport: "BED", urgency: "URGENT", condition: "if caesarean needed" },
      { from: "s4", to: "s5", transport: "BED" }, { from: "s5", to: "s6", transport: "FOOT" },
    ],
  },
  {
    id: "outpatient-imaging", name: "Outpatient clinic to imaging", kind: "PATIENT", dailyVolume: 120, arrival: CLINIC,
    description: "Clinic visit with imaging when needed. Assumed: 120 patients a day; 35 % sent for X-ray, 10 % for ultrasound, 5 % for CT.",
    steps: [
      { key: "s1", label: "Outpatient reception", kind: "START", deptTypes: ["OPD"], room: "RECEPTION|WAITING" },
      { key: "s2", label: "Clinic consultation", kind: "STEP", deptTypes: ["OPD"], room: "EXAM|CONSULT|CLINIC", minutes: 20 },
      { key: "s3", label: "X-ray", kind: "STEP", deptTypes: ["RAD"], room: "\\bRAD\\b|X-?RAY", minutes: 15, equipment: ["IMG-XR-DR"] },
      { key: "s4", label: "Ultrasound", kind: "STEP", deptTypes: ["RAD"], room: "ULTRASOUND|\\bUS\\b", minutes: 25, equipment: ["IMG-US-GEN"] },
      { key: "s5", label: "CT scan", kind: "STEP", deptTypes: ["RAD"], room: "^CT\\b", minutes: 20, equipment: ["IMG-CT-128"] },
      { key: "s6", label: "Leave", kind: "END" },
    ],
    links: [
      { from: "s1", to: "s2" }, { from: "s2", to: "s3", share: 35 }, { from: "s2", to: "s4", share: 10 }, { from: "s2", to: "s5", share: 5 },
      { from: "s2", to: "s6", share: 50 }, { from: "s3", to: "s6" }, { from: "s4", to: "s6" }, { from: "s5", to: "s6" },
    ],
  },
  {
    id: "icu-ct", name: "ICU patient to CT and back", kind: "PATIENT", dailyVolume: 3, arrival: profile([1, 1, 1, 1, 1, 1, 1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1]),
    description: "Ventilated ICU patient taken to CT and back: the journey that needs a bed lift, a transport ventilator and monitor, and a team. Assumed: 3 a day.",
    steps: [
      { key: "s1", label: "ICU bed", kind: "START", deptTypes: ["ICU"], room: "^ICU\\b" },
      { key: "s2", label: "CT scan", kind: "STEP", deptTypes: ["RAD"], room: "^CT\\b", minutes: 25, accompanying: "ICU nurse, doctor, porter", equipment: ["IMG-CT-128", "LIF-VEN-TRN", "MON-PAT-TRN"] },
      { key: "s3", label: "Back to ICU bed", kind: "END", deptTypes: ["ICU"], room: "^ICU\\b" },
    ],
    links: [{ from: "s1", to: "s2", transport: "BED", urgency: "URGENT" }, { from: "s2", to: "s3", transport: "BED" }],
  },
];

export type HospitalDept = { id: number; typeCode: string | null; name: string };
export type HospitalRoom = { id: number; name: string; departmentId: number | null; level: number };

/**
 * A starter resolved against a hospital: department by type (first match in the order given), room by its name
 * pattern (in that department first, then anywhere, lowest floor first). Steps that find nothing keep no place
 * and are listed, so they can be set by hand.
 */
export function resolveStarter(st: Starter, depts: HospitalDept[], rooms: HospitalRoom[]): { steps: Step[]; links: Link[]; unresolved: string[] } {
  const unresolved: string[] = [];
  const steps: Step[] = st.steps.map((s) => {
    const dept = (s.deptTypes ?? []).map((t) => depts.find((d) => d.typeCode === t)).find(Boolean) ?? null;
    let roomId: number | null = null;
    if (s.room) {
      const re = new RegExp(s.room, "i");
      const sorted = [...rooms].sort((a, b) => a.level - b.level || a.id - b.id);
      roomId = (dept ? sorted.find((r) => r.departmentId === dept.id && re.test(r.name)) : undefined)?.id ?? sorted.find((r) => re.test(r.name))?.id ?? null;
    }
    const roomDept = roomId != null ? rooms.find((r) => r.id === roomId)?.departmentId ?? null : null;
    if (s.kind === "STEP" && !dept && roomId == null) unresolved.push(s.label);
    return {
      key: s.key, label: s.label, kind: s.kind, departmentId: dept?.id ?? roomDept, roomId,
      minutes: s.minutes ?? null, accompanying: s.accompanying ?? null, equipment: s.equipment ?? [], notes: null,
    };
  });
  const links: Link[] = st.links.map((l) => ({ fromKey: l.from, toKey: l.to, share: l.share ?? 100, transport: l.transport ?? "FOOT", urgency: l.urgency ?? "ROUTINE", condition: l.condition ?? null }));
  return { steps, links, unresolved };
}
