/**
 * Import a building produced by the CAD pipeline (tools/cad → seed-data/cad/<name>.json):
 * facility, floors (with elevation and 3D linework), departments from the drawing's department codes,
 * rooms with their real outlines, and an illustrative equipment fit-out derived from room names.
 *
 * Runs as part of the seed (after the demo hospital). Skips when the JSON is absent or the facility exists.
 * The fit-out is DEMO data (notes say so): replace it with the real asset register via Assets › Import.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import { assetMovements, assets, buildings, departments, deviceTypes, facilities, floorCad, floors, rooms } from "../../src/db/schema";

type Pt = [number, number];
type CadRoom = { code: string; name: string; dept: string | null; num: string | null; shape: string; area: number | null; poly: Pt[]; label: Pt };
type CadFloor = { code: string; name: string; level: number; elevation: number; sourceFile: string; walls: number[]; doors: number[]; glass: number[]; columns: number[]; rooms: CadRoom[] };
export type CadBuilding = { name: string; facilityCode?: string; unitsPerMetre: number; planWidth: number; planHeight: number; floors: CadFloor[] };
type RoomType = (typeof rooms.$inferInsert)["type"];

/** Drawing department codes → system department (type from seed-data/department-types.json; null = non-clinical). */
const DEPARTMENTS: Record<string, { name: string; type: string | null }> = {
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
function contextual(name: string, dept?: string | null): string {
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

/** Illustrative fit-out: room name/type → device codes and quantities (per bed when `perBed`). */
type Fit = { code: string; qty?: number; perBed?: boolean };
const FITOUT: [RegExp | RoomType, Fit[]][] = [
  [/^NICU$|^SCN \d/, [{ code: "LIF-NEO-INC", perBed: true }, { code: "MON-PAT-HIGH", perBed: true }, { code: "INF-PMP-SYR", qty: 2 }, { code: "LIF-NEO-RW" }]],
  [/^(ICU|CCU)\b|CRITICAL CARE/, [{ code: "FUR-BED-ICU", perBed: true }, { code: "MON-PAT-HIGH", perBed: true }, { code: "LIF-VEN-ICU", perBed: true }, { code: "INF-PMP-SYR", qty: 3 }, { code: "INF-PMP-VOL", qty: 2 }, { code: "SUR-SUC-MOB" }]],
  [/CATH LAB|IR LAB/, [{ code: "IMG-ANG-SP" }, { code: "IMG-ACC-ANGINJ" }, { code: "MON-PAT-HIGH" }, { code: "LIF-DEF-MAN" }]],
  [/C-SECTION/, [{ code: "LIF-ANE-WS" }, { code: "SUR-OR-TABLE" }, { code: "SUR-OR-LIGHT" }, { code: "SUR-OR-ESU" }, { code: "LIF-NEO-RW" }, { code: "MON-PAT-HIGH" }]],
  [/OPERATING|THEATRE|GENERAL OR|HYBRID OR/, [{ code: "LIF-ANE-WS" }, { code: "SUR-OR-TABLE" }, { code: "SUR-OR-LIGHT" }, { code: "SUR-OR-ESU" }, { code: "SUR-OR-PEND" }, { code: "MON-PAT-HIGH" }]],
  [/\bCT\b/, [{ code: "IMG-CT-128" }]],
  [/\bMRI\b/, [{ code: "IMG-MRI-15T" }]],
  [/\bDXA\b/, [{ code: "IMG-BMD-DXA" }]],
  [/MAMMO/, [{ code: "IMG-MAM-DIG" }]],
  [/ULTRASOUND/, [{ code: "IMG-US-GEN" }]],
  [/\bRAD\b|X-?RAY/, [{ code: "IMG-XR-DR" }]],
  [/STRESS TEST/, [{ code: "CAR-STR-STS" }, { code: "CAR-STR-TRM" }, { code: "LIF-DEF-MAN" }]],
  [/\bTEE\b|ECHO/, [{ code: "CAR-ECH-3D" }, { code: "FUR-EXM-COUCHE" }]],
  [/\bPFTS?\b/, [{ code: "MON-PUL-PFT" }]],
  [/^P\/R\b/, [{ code: "FUR-BED-STRC" }, { code: "MON-PAT-MID" }]],
  [/GYNECOLOGY (SINGLE|DOUBLE)/, [{ code: "FUR-BED-WARDE", perBed: true }, { code: "MON-PAT-VS", perBed: true }, { code: "OBG-FET-CTG" }]],
  [/ED EXAM|RESUS/, [{ code: "FUR-TRN-STR" }, { code: "MON-PAT-MID" }, { code: "INF-PMP-VOL" }, { code: "GAS-FLW-O2F" }]],
  [/MED\/SURG|FAMILY SUITE|\bVIP\b|PATIENT ROOM|ISOLATION|^OBS$/, [{ code: "FUR-BED-WARDE", perBed: true }, { code: "MON-PAT-VS", perBed: true }, { code: "GAS-FLW-O2F", perBed: true }]],
  [/ENDOSCOPY|^ENDO P\/R/, [{ code: "END-FLX-GI" }, { code: "MON-PAT-MID" }, { code: "SUR-SUC-MOB" }, { code: "FUR-TRN-STR" }]],
  [/PROCEDURE/, [{ code: "FUR-EXM-COUCHE" }, { code: "MON-VIT-EXL" }, { code: "MON-PAT-MID" }]],
  [/DENTAL/, [{ code: "DEN-UNT-UNIT" }]],
  [/OPHTHAL/, [{ code: "OPH-EXM-SLIT" }, { code: "FUR-EXM-COUCH" }]],
  [/\bORL\b/, [{ code: "ENT-CLN-WS" }, { code: "ENT-CLN-OTO" }]],
  [/PHLEB/, [{ code: "FUR-EXM-PHL", qty: 2 }]],
  [/THERAP|OCCUPATIONAL|GYM/, [{ code: "REH-EXE-PAR" }, { code: "REH-EXE-TRD" }]],
  [/EXAM|CONSULT/, [{ code: "FUR-EXM-COUCH" }, { code: "MON-VIT-EXL" }, { code: "MON-VIT-DIAG" }]],
  [/INTAKE/, [{ code: "MON-PAT-VS" }, { code: "MON-VIT-SCALE" }]],
  [/WORKSTATION|NU-CONTROL|NURSE STATION/, [{ code: "MON-PAT-CMS" }, { code: "MON-ECG-12" }, { code: "FUR-CRT-CRASH" }, { code: "LIF-DEF-MAN" }]],
  // "EQUIMPENT" is how Basement 2's rehab store is spelt in the drawing.
  [/EQUIPMENT ROOM|EQUIP STORE|EQUI(P|MP)ENT STORE/, [{ code: "INF-PMP-VOL", qty: 3 }, { code: "MON-PAT-TRN" }, { code: "REH-MOB-WCS", qty: 2 }, { code: "SUR-SUC-MOB" }]],
  [/PHARMACY|\bPREP\b/, [{ code: "PHA-CLD-REF" }]], // incl. the unnamed pharmacy store (see contextual)
];

const MAKERS: [RegExp, [string, string[]][]][] = [
  [/^IMG-/, [["Canon Medical", ["Aquilion ONE", "Aquilion Prime SP", "Radrex-i", "Aplio i800"]], ["Siemens Healthineers", ["SOMATOM X.cite", "Ysio X.pree", "ACUSON Sequoia"]], ["GE HealthCare", ["Revolution Apex", "Definium 656", "LOGIQ E10"]], ["Konica Minolta", ["AeroDR", "SONIMAGE HS2"]]]],
  [/^MON-PAT|^MON-ECG/, [["Mindray", ["BeneVision N15", "BeneVision N12", "VS 9", "BeneHeart R12"]], ["Philips", ["IntelliVue MX550", "SureSigns VS4", "PageWriter TC50"]], ["GE HealthCare", ["CARESCAPE B650", "MAC 2000"]]]],
  [/^FUR-BED|^FUR-TRN|^FUR-EXM|^FUR-CRT/, [["Hillrom", ["Progressa", "Centrella", "Transport stretcher"]], ["Stryker", ["ProCuity", "Prime series"]], ["Linet", ["Eleganza 5", "Multicare"]], ["Merivaara", ["Promerix"]]]],
  [/^INF-/, [["B. Braun", ["Space Infusomat", "Perfusor Space"]], ["Fresenius Kabi", ["Agilia VP", "Agilia SP"]], ["Mindray", ["BeneFusion VP5", "BeneFusion SP5"]]]],
  [/^LIF-NEO|^OBG-/, [["Dräger", ["Babyleo TN500", "Isolette 8000"]], ["GE HealthCare", ["Giraffe OmniBed", "Corometrics 259cx"]], ["Philips", ["Avalon FM30"]]]],
  [/^CAR-/, [["GE HealthCare", ["CASE", "Vivid E95"]], ["Philips", ["EPIQ CVx"]], ["Schiller", ["CS-200"]]]],
  [/^LIF-VEN|^LIF-ANE/, [["Dräger", ["Evita V600", "Perseus A500"]], ["Hamilton Medical", ["Hamilton-C6"]], ["Mindray", ["SV800", "A9"]]]],
  [/^LIF-DEF/, [["Philips", ["HeartStart Intrepid"]], ["Mindray", ["BeneHeart D6"]], ["ZOLL", ["R Series"]]]],
  [/^END-/, [["Olympus", ["EVIS X1"]], ["Fujifilm", ["ELUXEO 7000"]]]],
  [/^SUR-/, [["Getinge", ["Maquet Alphamaxx", "Maquet PowerLED II"]], ["Stryker", ["Steris Harmony"]], ["Erbe", ["VIO 3"]], ["Medela", ["Dominant Flex"]]]],
  [/^DEN-/, [["Dentsply Sirona", ["Intego"]], ["Planmeca", ["Compact i5"]]]],
  [/^OPH-|^ENT-/, [["Haag-Streit", ["BQ 900"]], ["Atmos", ["S 61 Servant"]], ["Topcon", ["SL-D701"]]]],
  [/^REH-/, [["Enraf-Nonius", ["Parallel bars 400", "Treadmill 9000"]], ["Invacare", ["Action 3"]]]],
  [/^PHA-/, [["Liebherr", ["MKUv 1610"]]]],
  [/^GAS-|^MON-VIT/, [["Amico", ["Flowmeter 0–15 L"]], ["Welch Allyn", ["GS 300", "Green Series 777"]], ["Seca", ["seca 674"]]]],
];

function pick<T>(arr: T[], seed: number): T { return arr[Math.abs(seed) % arr.length]; }

export function fitOut(rawName: string, type: RoomType, beds: number, dept?: string | null): { code: string; qty: number }[] {
  const n = contextual(rawName, dept).toUpperCase();
  for (const [m, fits] of FITOUT) {
    if (typeof m === "string" ? m === type : (m as RegExp).test(n)) return fits.map((f) => ({ code: f.code, qty: f.perBed ? Math.max(1, beds) : f.qty ?? 1 }));
  }
  return [];
}

type Fit3 = { roomId: number; departmentId: number | null; code: string };

/** Bulk insert (thousands of rows) of demo devices: tags from the shared sequence, attributes from the catalogue. */
async function insertDemoDevices(db: DB, facilityCode: string, facilityId: number, fit: Fit3[], start = 0): Promise<number> {
  if (!fit.length) return 0;
  const typeIds = new Map((await db.select({ id: deviceTypes.id, code: deviceTypes.code, criticality: deviceTypes.criticality, life: deviceTypes.lifeExpectancyYears, min: deviceTypes.priceMinUsd, max: deviceTypes.priceMaxUsd })
    .from(deviceTypes).where(eq(deviceTypes.level, 3))).map((t) => [t.code, t]));
  const usable = fit.filter((x) => typeIds.has(x.code));
  if (!usable.length) return 0;
  const nums = (await db.execute<{ n: string }>(sql`select nextval('asset_tag_seq')::text as n from generate_series(1, ${usable.length})`)).rows.map((r) => r.n);
  const statuses = ["IN_SERVICE", "IN_SERVICE", "IN_SERVICE", "IN_SERVICE", "IN_SERVICE", "IN_SERVICE", "IN_SERVICE", "IN_SERVICE", "IN_SERVICE", "IN_SERVICE",
    "IN_SERVICE", "IN_SERVICE", "IN_SERVICE", "IN_SERVICE", "IN_SERVICE", "IN_SERVICE", "IN_SERVICE", "INSTALLED", "UNDER_MAINTENANCE", "OUT_OF_SERVICE"] as const;
  // `start` continues the variation sequence after devices already placed, so added serials don't repeat earlier ones.
  const rows = usable.map((x, j) => {
    const i = start + j;
    const t = typeIds.get(x.code)!;
    const makers = MAKERS.find(([re]) => re.test(x.code))?.[1] ?? [["Generic", ["Standard"]]];
    const [maker, models] = pick(makers, i * 7 + x.roomId);
    const year = 2024 + (i % 3);
    const purchase = `${year}-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`;
    const price = t.min && t.max ? (Number(t.min) + Number(t.max)) / 2 : null;
    return {
      assetTag: `${facilityCode}-${x.code.split("-")[0]}-${nums[j].padStart(6, "0")}`, deviceTypeId: t.id, facilityId, departmentId: x.departmentId, roomId: x.roomId,
      manufacturer: maker, model: pick(models, i), serialNumber: `${maker.replace(/[^A-Z]/gi, "").slice(0, 2).toUpperCase()}${year % 100}${String(100000 + ((i * 7919) % 899999))}`,
      status: pick([...statuses], i * 13 + 5), condition: "GOOD" as const, criticality: t.criticality,
      purchaseCost: price != null ? String(Math.round(price)) : null, currency: "USD", purchaseDate: purchase, installDate: purchase,
      warrantyEnd: `${year + 2}-${purchase.slice(5)}`, lifeExpectancyYears: t.life,
      notes: "Demo placement generated from the room's name in the CAD drawing. Replace with the real asset register (Assets › Import).",
    };
  });
  for (let i = 0; i < rows.length; i += 500) await db.insert(assets).values(rows.slice(i, i + 500));
  return rows.length;
}

/**
 * For a building imported by an earlier seed: add the demo fit-out to rooms the fit-out rules now cover but that got
 * nothing at the time (e.g. after a rule was added). Only rooms that have never held equipment (no assets, no
 * movements in or out) are touched, so equipment someone moved away on purpose is not put back. Safe to re-run.
 */
async function backfillFitOut(db: DB, b: CadBuilding, facilityCode: string, facilityId: number): Promise<number> {
  const dbFloors = await db.select({ id: floors.id, level: floors.level }).from(floors)
    .innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facilityId));
  const floorIds = dbFloors.map((f) => f.id);
  if (!floorIds.length) return 0;
  const dbRooms = await db.select({ id: rooms.id, floorId: rooms.floorId, code: rooms.code, type: rooms.type, departmentId: rooms.departmentId })
    .from(rooms).where(inArray(rooms.floorId, floorIds));
  const ids = dbRooms.map((r) => r.id);
  if (!ids.length) return 0;
  const used = new Set<number>();
  for (const r of await db.selectDistinct({ id: assets.roomId }).from(assets).where(inArray(assets.roomId, ids))) if (r.id) used.add(r.id);
  for (const r of await db.selectDistinct({ id: assetMovements.toRoomId }).from(assetMovements).where(isNotNull(assetMovements.toRoomId))) if (r.id) used.add(r.id);
  for (const r of await db.selectDistinct({ id: assetMovements.fromRoomId }).from(assetMovements).where(isNotNull(assetMovements.fromRoomId))) if (r.id) used.add(r.id);
  const levelOf = new Map(dbFloors.map((f) => [f.id, f.level]));
  const cadByKey = new Map<string, CadRoom>(b.floors.flatMap((f) => f.rooms.map((r) => [`${f.level}|${r.code.toUpperCase()}`, r] as const)));
  const fit: Fit3[] = [];
  for (const r of dbRooms) {
    if (used.has(r.id)) continue;
    const cad = cadByKey.get(`${levelOf.get(r.floorId)}|${r.code.toUpperCase()}`);
    if (!cad) continue; // a room drawn in the app, not from the CAD file
    const c = classifyRoom(cad.name, cad.dept);
    const items = fitOut(cad.name, c.type, c.beds, cad.dept);
    if (!items.length) continue;
    // A room the old rules left unclassified gets its type now (only when it was "OTHER").
    if (r.type === "OTHER" && c.type !== "OTHER") await db.update(rooms).set({ type: c.type, beds: c.beds }).where(eq(rooms.id, r.id));
    for (const item of items) for (let k = 0; k < item.qty; k++) fit.push({ roomId: r.id, departmentId: r.departmentId, code: item.code });
  }
  if (!fit.length) return 0;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(assets).where(eq(assets.facilityId, facilityId));
  return insertDemoDevices(db, facilityCode, facilityId, fit, n);
}

export async function importBuilding(db: DB, b: CadBuilding, opts: { equipment?: boolean } = {}) {
  const code = (b.facilityCode ?? b.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 6)).toUpperCase();
  const [existing] = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.code, code));
  if (existing) {
    const added = opts.equipment !== false ? await backfillFitOut(db, b, code, existing.id) : 0;
    console.log(`  ${b.name}: facility ${code} exists${added ? `, ${added} demo devices added to rooms that had none` : ", skipped"}`);
    return;
  }

  const allRooms = b.floors.flatMap((f) => f.rooms.map((r) => ({ ...r, ...classifyRoom(r.name, r.dept) })));
  const totalBeds = allRooms.reduce((s, r) => s + r.beds, 0);
  const [fac] = await db.insert(facilities).values({ code, name: b.name, type: "GENERAL_HOSPITAL", governorate: "Cairo", totalBeds }).returning();
  const [bld] = await db.insert(buildings).values({ facilityId: fac.id, code: "MAIN", name: "Main building" }).returning();

  // Departments: one per drawing code (stairs/circulation rooms keep no department).
  const deptCodes = [...new Set(allRooms.map((r) => r.dept).filter((d): d is string => !!d && d !== "ST"))];
  const deptId = new Map<string, number>();
  for (const dc of deptCodes) {
    const m = DEPARTMENTS[dc] ?? { name: `Department ${dc}`, type: null };
    const beds = allRooms.filter((r) => r.dept === dc).reduce((s, r) => s + r.beds, 0);
    const [d] = await db.insert(departments).values({ facilityId: fac.id, code: dc.replace(/[^A-Z0-9]/g, "") || dc, name: m.name, departmentTypeCode: m.type, beds }).returning({ id: departments.id });
    deptId.set(dc, d.id);
  }

  const fit: Fit3[] = [];
  let roomCount = 0;

  for (const f of b.floors) {
    const [fl] = await db.insert(floors).values({
      buildingId: bld.id, level: f.level, name: f.name, planWidth: b.planWidth, planHeight: b.planHeight,
      elevation: f.elevation, unitsPerMetre: b.unitsPerMetre,
    }).returning();
    await db.insert(floorCad).values({ floorId: fl.id, sourceFile: f.sourceFile, walls: f.walls, doors: f.doors, glass: f.glass, columns: f.columns });
    const values = f.rooms.map((r) => {
      const { type, beds } = classifyRoom(r.name, r.dept);
      const xs = r.poly.map((p) => p[0]), ys = r.poly.map((p) => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return {
        floorId: fl.id, departmentId: r.dept && r.dept !== "ST" ? deptId.get(r.dept) ?? null : null, code: r.code, name: titleCase(r.name), type, beds,
        x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, w: Math.max(5, Math.round((Math.max(...xs) - x) * 10) / 10), h: Math.max(5, Math.round((Math.max(...ys) - y) * 10) / 10),
        polygon: r.poly,
      };
    });
    for (let i = 0; i < values.length; i += 200) {
      const chunk = f.rooms.slice(i, i + 200);
      const inserted = await db.insert(rooms).values(values.slice(i, i + 200)).returning({ id: rooms.id, type: rooms.type, beds: rooms.beds, departmentId: rooms.departmentId });
      inserted.forEach((r, j) => {
        for (const item of fitOut(chunk[j].name, r.type, r.beds, chunk[j].dept)) for (let k = 0; k < item.qty; k++) fit.push({ roomId: r.id, departmentId: r.departmentId, code: item.code });
      });
    }
    roomCount += values.length;
  }

  const placed = opts.equipment !== false ? await insertDemoDevices(db, code, fac.id, fit) : 0;
  console.log(`  ${b.name}: ${b.floors.length} floors, ${deptCodes.length} departments, ${roomCount} rooms, ${totalBeds} beds, ${placed} demo devices`);
}

/** DWG multiline text can carry formatting codes ("\\pxqc;" alignment, "\\P" line breaks, braces); keep only the words. */
export function cleanCadText(s: string) {
  return s.replace(/\\[A-Za-z][^;\\]*;/g, " ").replace(/\\P/gi, " ").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

function titleCase(s: string) {
  return cleanCadText(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Ct|Mri|Dxa|Icu|Ccu|Ed|Or|Orl|Vip|Tlt|Rad|Agv|Hvac|Rmu|Md|P\/R)\b/g, (m) => m.toUpperCase());
}

/** Seed entry: import every building JSON in seed-data/cad/. */
export default async function seed(db: DB) {
  const dir = path.join(__dirname, "..", "..", "seed-data", "cad");
  if (!existsSync(dir)) { console.log("  cad: no seed-data/cad folder, skipped"); return; }
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    await importBuilding(db, JSON.parse(readFileSync(path.join(dir, f), "utf8")) as CadBuilding);
  }
}

