/**
 * Demo equipment for facility DGH: realistic placement of the core device types room by room, plus maintenance
 * history, a few faults, warranties ending soon and a couple of movements. OWNED BY THE ASSETS AGENT.
 *
 * Runs after facility → boq → procurement. Assets the procurement seed already received (poLineId set) are not
 * duplicated: when the plan needs a device of the same type for the same department, the received unit is placed in
 * the room instead of creating a new one; any other received units are placed round-robin in their destination department.
 */
import { createRequire } from "node:module";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import { assets, departments, deviceTypes, facilities, floors, maintenanceEvents, poLines, rooms, buildings, assetMovements } from "../../src/db/schema";

/** Shared modules import "server-only", which throws outside React Server Components. Stub it for this script. */
function allowServerOnly() {
  const req = createRequire(__filename);
  try {
    const id = req.resolve("server-only");
    req.cache[id] = { id, filename: id, loaded: true, exports: {} } as unknown as NodeJS.Module;
  } catch { /* not installed — nothing to stub */ }
}

const TODAY = new Date().toISOString().slice(0, 10);

/* deterministic PRNG so every reset gives the same hospital */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261027);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

function addMonths(iso: string, m: number) {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** manufacturer, model, serial prefix, cost USD, warranty months */
type Make = [string, string, string, number, number];
const MAKES: Record<string, Make[]> = {
  "MON-PAT-HIGH": [["Philips", "IntelliVue MX750", "DE", 11800, 24], ["GE HealthCare", "CARESCAPE B850", "SJC", 12500, 24], ["Mindray", "BeneVision N17", "MR", 8900, 36]],
  "MON-PAT-MID": [["Mindray", "ePM 12M", "MR", 4200, 24], ["Philips", "IntelliVue MX450", "DE", 6100, 24], ["Nihon Kohden", "Life Scope G5", "NK", 5600, 24]],
  "MON-PAT-TRN": [["Philips", "IntelliVue X3", "DE", 5200, 24]],
  "MON-PAT-CMS": [["Philips", "IntelliVue Information Center iX", "PIC", 38000, 24], ["Mindray", "BeneVision CMS", "MCS", 24000, 24]],
  "MON-ECG-12": [["GE HealthCare", "MAC 2000", "SCD", 4300, 24], ["Schiller", "Cardiovit FT-1", "SC", 3600, 24]],
  "MON-OXI-HH": [["Masimo", "Rad-5v", "MS", 650, 12], ["Nonin", "PalmSAT 2500", "NN", 520, 12]],
  "LIF-VEN-ICU": [["Hamilton Medical", "HAMILTON-C6", "HC6", 32000, 24], ["Dräger", "Evita V600", "ASL", 36000, 24], ["Mindray", "SV800", "SV", 24000, 36]],
  "LIF-VEN-TRN": [["Hamilton Medical", "HAMILTON-T1", "HT1", 17500, 24], ["Dräger", "Oxylog 3000 plus", "ARL", 15800, 24]],
  "LIF-DEF-MAN": [["ZOLL", "R Series ALS", "AF", 14500, 36], ["Philips", "HeartStart XL+", "US", 12800, 24], ["Mindray", "BeneHeart D6", "BH", 9800, 36]],
  "LIF-DEF-AED": [["ZOLL", "AED Plus", "X", 1700, 60], ["Philips", "HeartStart FRx", "B", 1650, 60]],
  "LIF-ANE-WS": [["Dräger", "Perseus A500", "ASM", 58000, 24], ["GE HealthCare", "Aisys CS2", "AMR", 62000, 24], ["Mindray", "A7", "AN", 42000, 36]],
  "INF-PMP-VOL": [["B. Braun", "Infusomat Space", "BB", 2400, 24], ["BD", "Alaris GP Plus", "8003", 2600, 24], ["Fresenius Kabi", "Agilia VP", "FK", 2200, 24]],
  "INF-PMP-SYR": [["B. Braun", "Perfusor Space", "BP", 1900, 24], ["Fresenius Kabi", "Agilia SP", "FS", 1750, 24]],
  "SUR-OR-TABLE": [["Getinge", "Maquet Magnus", "MG", 68000, 24], ["Baxter", "TruSystem 7500", "TS", 54000, 24]],
  "SUR-OR-LIGHT": [["Dräger", "Polaris 600", "PL", 26000, 24], ["Getinge", "Maquet PowerLED II", "PLD", 31000, 24]],
  "SUR-OR-ESU": [["Medtronic", "Valleylab FT10", "FT", 21000, 24], ["Erbe", "VIO 3", "VIO", 19500, 24]],
  "SUR-OR-PEND": [["Dräger", "Movita", "MV", 22000, 24], ["Getinge", "Moduevo", "MD", 24500, 24]],
  "SUR-SUC-MOB": [["Medela", "Dominant Flex", "MD", 2100, 24], ["ATMOS", "C 361", "AT", 2600, 24]],
  "END-FLX-GI": [["Olympus", "EVIS X1 CV-1500", "OLY", 145000, 24], ["Fujifilm", "ELUXEO 7000", "FJ", 128000, 24]],
  "FUR-BED-ICU": [["Hill-Rom", "Progressa", "HR", 21000, 24], ["LINET", "Multicare", "LN", 17500, 24]],
  "FUR-BED-WARD": [["LINET", "Eleganza 2", "LE", 4200, 24], ["Hill-Rom", "Centrella", "HC", 5600, 24]],
  "FUR-TRN-STR": [["Stryker", "Prime Series", "ST", 6800, 24], ["Hill-Rom", "TranStar", "TT", 5900, 24]],
  "FUR-CRT-CRASH": [["Capsa Healthcare", "Avalo emergency cart", "CA", 2400, 12], ["Harloff", "6400 series", "HA", 1900, 12]],
  "STR-STE-LG": [["Getinge", "GSS67H", "GS", 128000, 24], ["Steelco", "VS 1", "SV", 96000, 24]],
  "STR-WSH-WD": [["Getinge", "86 Series", "WD", 61000, 24], ["Miele", "PG 8528", "MI", 54000, 24]],
  "LAB-HEM-5P": [["Sysmex", "XN-1000", "SX", 52000, 24], ["Mindray", "BC-6800 Plus", "BC", 38000, 24]],
  "LAB-CHE-AUTO": [["Roche", "cobas c 311", "RC", 98000, 24], ["Beckman Coulter", "AU480", "AU", 89000, 24]],
  "LAB-BGA-ANL": [["Radiometer", "ABL90 FLEX PLUS", "ABL", 23000, 24], ["Siemens Healthineers", "RAPIDPoint 500e", "RP", 21000, 24]],
  "LAB-GEN-CENT": [["Eppendorf", "Centrifuge 5702", "EP", 3200, 24], ["Hettich", "Rotofix 32 A", "HE", 2800, 24]],
  "IMG-CT-128": [["Siemens Healthineers", "SOMATOM go.Top", "CT", 780000, 24]],
  "IMG-MRI-15T": [["Siemens Healthineers", "MAGNETOM Sola", "MRS", 1350000, 24]],
  "IMG-XR-DR": [["Philips", "DigitalDiagnost C90", "DDC", 165000, 24]],
  "IMG-XR-FLUORO": [["Siemens Healthineers", "Luminos Agile Max", "LAM", 410000, 24]],
  "IMG-XR-MDR": [["GE HealthCare", "AMX Navigate", "AMX", 128000, 24]],
  "IMG-XR-CARM": [["Siemens Healthineers", "Cios Select", "CIS", 112000, 24], ["Ziehm Imaging", "Vision RFD", "ZV", 135000, 24]],
  "IMG-MAM-DIG": [["Hologic", "Selenia Dimensions", "SD", 340000, 24]],
  "IMG-US-GEN": [["GE HealthCare", "LOGIQ E10s", "LQ", 118000, 24], ["Philips", "EPIQ Elite", "EP", 145000, 24]],
  "IMG-US-POC": [["Fujifilm Sonosite", "Sonosite PX", "SPX", 42000, 24], ["GE HealthCare", "Venue Go", "VG", 36000, 24]],
};

/** Department commissioning dates: older units for theatres/CSSD, recent ones for ER and endoscopy (warranties ending soon). */
const INSTALLED: Record<string, string> = {
  ICU: "2021-03-15", CCU: "2022-06-01", ER: "2024-12-10", RAD: "2021-11-02", OPD: "2025-01-20", LAB: "2022-10-10",
  ENDO: "2024-01-20", OR: "2019-09-10", PACU: "2019-09-10", SSU: "2018-07-01", CSSD: "2018-07-01", BME: "2023-05-01",
  MED: "2023-02-01", SURG: "2023-02-01", PHARM: "2024-04-01",
};

type Plan = { dept: string; room: string; type: string; status?: "UNDER_MAINTENANCE" | "OUT_OF_SERVICE" | "IN_STOCK"; makeIdx?: number;
  install?: string; ownerDept?: string; note?: string; warrantyMonths?: number; key?: string; parentKey?: string };

function buildPlan(roomCodes: Map<string, { beds: number }>): Plan[] {
  const p: Plan[] = [];
  const add = (dept: string, room: string, type: string, extra: Partial<Plan> = {}) => {
    if (roomCodes.has(room)) p.push({ dept, room, type, ...extra });
  };
  const n2 = (i: number) => String(i).padStart(2, "0");

  // Critical care: every ICU and CCU bed space gets the full bedside set.
  for (const [dept, beds] of [["ICU", 12], ["CCU", 6]] as const) {
    for (let i = 1; i <= beds; i++) {
      const room = `3-${dept}-BED${n2(i)}`;
      add(dept, room, "FUR-BED-ICU", { makeIdx: dept === "ICU" ? 0 : 1 });
      add(dept, room, "MON-PAT-HIGH", { makeIdx: dept === "ICU" ? 0 : 2 });
      add(dept, room, "LIF-VEN-ICU", { makeIdx: dept === "ICU" ? 0 : 1, status: dept === "ICU" && i === 7 ? "UNDER_MAINTENANCE" : undefined });
      add(dept, room, "INF-PMP-SYR", { makeIdx: 0 });
      add(dept, room, "INF-PMP-SYR", { makeIdx: 0 });
      add(dept, room, "INF-PMP-VOL", { makeIdx: 0 });
      add(dept, room, "SUR-SUC-MOB", { makeIdx: 0 });
    }
  }
  for (const t of ["MON-PAT-CMS", "LIF-DEF-MAN", "FUR-CRT-CRASH", "LAB-BGA-ANL", "MON-ECG-12", "IMG-US-POC", "LIF-VEN-TRN", "MON-PAT-TRN", "IMG-XR-MDR"]) add("ICU", "3-ICU-NS", t, { makeIdx: 0 });
  add("CCU", "3-ICU-NS", "MON-PAT-CMS", { makeIdx: 1, ownerDept: "CCU", note: "CCU central station, shared nurse station with the adult ICU" });
  add("CCU", "3-CCU-BED01", "LIF-DEF-MAN", { makeIdx: 0 });
  add("CCU", "3-CCU-BED01", "FUR-CRT-CRASH", { makeIdx: 0 });
  add("CCU", "3-CCU-BED06", "MON-ECG-12", { makeIdx: 0 });

  // Emergency
  for (const r of ["0-ER-RES01", "0-ER-RES02"]) {
    for (const t of ["FUR-TRN-STR", "MON-PAT-HIGH", "LIF-VEN-TRN", "INF-PMP-VOL", "INF-PMP-SYR", "LIF-DEF-MAN"]) add("ER", r, t, { makeIdx: t === "MON-PAT-HIGH" ? 1 : 0 });
    add("ER", r, "SUR-SUC-MOB", { makeIdx: 1, status: r.endsWith("02") ? "OUT_OF_SERVICE" : undefined });
  }
  for (const r of ["0-ER-OBS01", "0-ER-OBS02"]) for (let b = 0; b < 5; b++) { add("ER", r, "FUR-TRN-STR", { makeIdx: 1 }); add("ER", r, "MON-PAT-MID", { makeIdx: 0 }); }
  for (const t of ["MON-PAT-CMS", "FUR-CRT-CRASH", "MON-ECG-12", "IMG-US-POC", "MON-OXI-HH", "MON-OXI-HH"]) add("ER", "0-ER-NS", t, { makeIdx: 1 });
  for (const t of ["MON-PAT-MID", "MON-OXI-HH", "LIF-DEF-AED"]) add("ER", "0-ER-TRI", t);

  // Radiology
  add("RAD", "0-RAD-CT", "IMG-CT-128", { install: "2020-05-20", status: "UNDER_MAINTENANCE" });
  add("RAD", "0-RAD-CT", "LIF-DEF-AED");
  add("RAD", "0-RAD-CT", "INF-PMP-VOL", { makeIdx: 1 });
  add("RAD", "0-RAD-MRI", "IMG-MRI-15T", { install: "2021-11-02" });
  add("RAD", "0-RAD-XR01", "IMG-XR-DR", { install: "2019-02-14" });
  add("RAD", "0-RAD-XR01", "FUR-CRT-CRASH");
  add("RAD", "0-RAD-XR02", "IMG-XR-FLUORO", { install: "2022-03-08" });
  add("RAD", "0-RAD-US01", "IMG-US-GEN", { makeIdx: 0, install: "2023-06-12" });
  add("RAD", "0-RAD-US02", "IMG-US-GEN", { makeIdx: 1, install: "2025-02-03", status: "OUT_OF_SERVICE" });
  add("RAD", "0-RAD-MAM", "IMG-MAM-DIG", { install: "2024-11-25" });

  // Outpatients
  add("OPD", "1-OPD-CLN01", "MON-ECG-12");
  add("OPD", "1-OPD-CLN02", "IMG-US-GEN");
  for (let i = 3; i <= 8; i++) add("OPD", `1-OPD-CLN${n2(i)}`, "MON-OXI-HH");
  add("OPD", "1-OPD-WAIT", "LIF-DEF-AED");

  // Laboratory
  add("LAB", "1-LAB-HEM", "LAB-HEM-5P", { makeIdx: 0 }); add("LAB", "1-LAB-HEM", "LAB-HEM-5P", { makeIdx: 1 });
  add("LAB", "1-LAB-HEM", "LAB-GEN-CENT");
  add("LAB", "1-LAB-CHE", "LAB-CHE-AUTO", { makeIdx: 0 }); add("LAB", "1-LAB-CHE", "LAB-CHE-AUTO", { makeIdx: 1 });
  add("LAB", "1-LAB-CHE", "LAB-BGA-ANL"); add("LAB", "1-LAB-CHE", "LAB-GEN-CENT");
  add("LAB", "1-LAB-SMP", "LAB-GEN-CENT", { makeIdx: 1 });

  // Endoscopy
  for (const r of ["1-ENDO-END01", "1-ENDO-END02"]) for (const t of ["END-FLX-GI", "MON-PAT-MID", "SUR-SUC-MOB", "FUR-TRN-STR"]) add("ENDO", r, t, { makeIdx: 0 });
  add("ENDO", "1-ENDO-END01", "FUR-CRT-CRASH"); add("ENDO", "1-ENDO-END01", "LIF-DEF-MAN", { makeIdx: 1 });

  // Operating theatres — the patient monitor is mounted on the anaesthesia workstation (component).
  for (let i = 1; i <= 4; i++) {
    const r = `2-OR-OR${n2(i)}`;
    add("OR", r, "LIF-ANE-WS", { makeIdx: i <= 2 ? 0 : 1, key: `ane${i}` });
    add("OR", r, "MON-PAT-HIGH", { makeIdx: i <= 2 ? 0 : 1, parentKey: `ane${i}` });
    add("OR", r, "SUR-OR-TABLE", { makeIdx: i <= 2 ? 0 : 1 });
    add("OR", r, "SUR-OR-LIGHT", { makeIdx: 0 });
    add("OR", r, "SUR-OR-ESU", { makeIdx: i % 2, status: i === 2 ? "UNDER_MAINTENANCE" : undefined });
    add("OR", r, "SUR-OR-PEND", { makeIdx: 0 });
    add("OR", r, "INF-PMP-SYR"); add("OR", r, "INF-PMP-SYR");
    add("OR", r, "SUR-SUC-MOB");
  }
  add("OR", "2-OR-OR01", "IMG-XR-CARM", { install: "2022-08-30" });
  add("OR", "2-OR-OR04", "FUR-CRT-CRASH"); add("OR", "2-OR-OR04", "LIF-DEF-MAN");

  // Recovery
  for (let b = 0; b < 6; b++) { add("PACU", "2-PACU-REC", "MON-PAT-HIGH", { makeIdx: 0 }); add("PACU", "2-PACU-REC", "FUR-TRN-STR", { makeIdx: 0 }); }
  for (const t of ["INF-PMP-VOL", "INF-PMP-VOL", "INF-PMP-VOL", "SUR-SUC-MOB", "SUR-SUC-MOB", "LIF-DEF-MAN", "FUR-CRT-CRASH", "MON-PAT-CMS"]) add("PACU", "2-PACU-REC", t);

  // Sterile services
  add("SSU", "2-SSU-SSU", "STR-STE-LG", { makeIdx: 1 }); add("SSU", "2-SSU-SSU", "STR-WSH-WD", { makeIdx: 1 });
  add("CSSD", "B-CSSD-DEC", "STR-WSH-WD", { makeIdx: 0 }); add("CSSD", "B-CSSD-DEC", "STR-WSH-WD", { makeIdx: 0 });
  add("CSSD", "B-CSSD-PAK", "STR-STE-LG", { makeIdx: 0 }); add("CSSD", "B-CSSD-PAK", "STR-STE-LG", { makeIdx: 0 });

  // Biomedical workshop: units in for repair (owned by their departments) and spare stock.
  add("BME", "B-BME-WS", "INF-PMP-VOL", { ownerDept: "MED", status: "UNDER_MAINTENANCE", note: "Occlusion alarm fault — in workshop" });
  add("BME", "B-BME-WS", "MON-PAT-MID", { ownerDept: "SURG", status: "OUT_OF_SERVICE", note: "Cracked display, awaiting part" });
  for (let i = 0; i < 4; i++) add("BME", "B-BME-ST", "INF-PMP-SYR", { status: "IN_STOCK", install: "", ownerDept: "BME" });

  // Wards: one bed per bed space, a mid-acuity monitor per room, shared kit at the nurse station.
  for (const dept of ["MED", "SURG"]) {
    for (let i = 1; i <= 6; i++) {
      const r = `4-${dept}-PR${n2(i)}`;
      const beds = roomCodes.get(r)?.beds ?? 0;
      for (let b = 0; b < beds; b++) add(dept, r, "FUR-BED-WARD", { makeIdx: dept === "MED" ? 0 : 1 });
      add(dept, r, "MON-PAT-MID", { makeIdx: dept === "MED" ? 0 : 2, status: dept === "MED" && i === 3 ? "OUT_OF_SERVICE" : undefined });
    }
    for (const t of ["LIF-DEF-MAN", "FUR-CRT-CRASH", "MON-ECG-12", "INF-PMP-VOL", "INF-PMP-VOL", "INF-PMP-VOL", "INF-PMP-VOL", "MON-OXI-HH"]) add(dept, `4-${dept}-NS`, t, { makeIdx: 1 });
  }
  return p;
}

export default async function seed(db: DB) {
  allowServerOnly();
  const { createAsset } = await import("../../src/lib/asset-factory");
  const { moveAsset } = await import("../../src/lib/assets/mutations");

  const [fac] = await db.select().from(facilities).where(eq(facilities.code, "DGH"));
  if (!fac) { console.log("  assets: facility DGH missing — run the facility seed first; skipped"); return; }
  const [{ n: existing }] = await db.select({ n: sql<number>`count(*)::int` }).from(assets).where(and(eq(assets.facilityId, fac.id), isNull(assets.poLineId)));
  if (existing > 0) { console.log(`  assets: ${existing} register assets already exist for DGH, skipped`); return; }

  const roomRows = await db.select({ id: rooms.id, code: rooms.code, beds: rooms.beds, type: rooms.type, departmentId: rooms.departmentId })
    .from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId))
    .where(eq(buildings.facilityId, fac.id));
  const roomByCode = new Map(roomRows.map((r) => [r.code, r]));
  const deptRows = await db.select({ id: departments.id, code: departments.code }).from(departments).where(eq(departments.facilityId, fac.id));
  const deptByCode = new Map(deptRows.map((d) => [d.code, d.id]));
  const types = await db.select({ id: deviceTypes.id, code: deviceTypes.code, ppm: deviceTypes.ppmIntervalMonths, calib: deviceTypes.requiresCalibration })
    .from(deviceTypes).where(eq(deviceTypes.level, 3));
  const typeByCode = new Map(types.map((t) => [t.code, t]));
  const typeById = new Map(types.map((t) => [t.id, t]));

  // Units already received by procurement and not yet in a room → pool by department + device type.
  const received = await db.select({ id: assets.id, deviceTypeId: assets.deviceTypeId, departmentId: assets.departmentId, dest: poLines.destinationDepartmentId, status: assets.status, installDate: assets.installDate })
    .from(assets).innerJoin(poLines, eq(poLines.id, assets.poLineId))
    .where(and(eq(assets.facilityId, fac.id), isNotNull(assets.poLineId), isNull(assets.roomId)));
  const pool = new Map<string, typeof received>();
  for (const r of received) {
    const d = r.dest ?? r.departmentId;
    if (!d) continue;
    const k = `${d}:${r.deviceTypeId}`;
    pool.set(k, [...(pool.get(k) ?? []), r]);
  }

  const plan = buildPlan(new Map(roomRows.map((r) => [r.code, { beds: r.beds }])));
  const created: { id: number; typeId: number; install: string | null; status: string; dept: string; idx: number }[] = [];
  const byKey = new Map<string, number>();
  let reused = 0, skipped = 0, serialN = 0;

  for (const [idx, it] of plan.entries()) {
    const dt = typeByCode.get(it.type);
    const room = roomByCode.get(it.room);
    const deptId = deptByCode.get(it.ownerDept ?? it.dept) ?? room?.departmentId ?? null;
    if (!dt || !room) { skipped++; continue; }
    const install = it.install === "" ? null : it.install ?? INSTALLED[it.dept] ?? "2023-01-01";
    const status = it.status ?? "IN_SERVICE";

    const fromPool = deptId ? pool.get(`${deptId}:${dt.id}`)?.shift() : undefined;
    if (fromPool) {
      await db.update(assets).set({
        roomId: room.id, departmentId: deptId, status: fromPool.status === "IN_STOCK" ? "INSTALLED" : fromPool.status,
        installDate: fromPool.installDate ?? TODAY,
      }).where(eq(assets.id, fromPool.id));
      reused++;
      continue;
    }

    const makes = MAKES[it.type] ?? [["Generic", "Standard", "SN", 1000, 24]];
    const [manufacturer, model, prefix, cost, warranty] = makes[(it.makeIdx ?? 0) % makes.length];
    serialN++;
    const serialNumber = `${prefix}${String(100000 + Math.floor(rand() * 899999))}${String(serialN).padStart(3, "0")}`;
    const purchaseDate = install ? addDays(install, -(21 + Math.floor(rand() * 40))) : addDays(TODAY, -60);
    const a = await createAsset({
      deviceTypeId: dt.id, facilityId: fac.id, roomId: room.id, departmentId: it.ownerDept ? deptId : null,
      manufacturer, model, serialNumber, status,
      condition: status === "OUT_OF_SERVICE" ? "POOR" : status === "UNDER_MAINTENANCE" ? "FAIR" : install && install < "2021-01-01" ? "GOOD" : "NEW",
      purchaseCost: Math.round(cost * (0.92 + rand() * 0.16)), currency: "USD", purchaseDate, installDate: install,
      warrantyMonths: it.warrantyMonths ?? warranty,
      parentAssetId: it.parentKey ? byKey.get(it.parentKey) ?? null : null,
      notes: it.note ?? null,
    }, "Seed");
    if (it.key) byKey.set(it.key, a.id);
    created.push({ id: a.id, typeId: dt.id, install, status, dept: it.dept, idx });
  }

  // Remaining received units go into rooms of their destination department (round-robin over non-corridor rooms).
  let placedLeftovers = 0;
  for (const [k, list] of pool) {
    const deptId = Number(k.split(":")[0]);
    const deptRooms = roomRows.filter((r) => r.departmentId === deptId && r.type !== "CORRIDOR");
    if (!deptRooms.length) continue;
    for (const [i, r] of list.entries()) {
      const room = deptRooms[i % deptRooms.length];
      await db.update(assets).set({ roomId: room.id, departmentId: deptId, status: r.status === "IN_STOCK" ? "INSTALLED" : r.status, installDate: r.installDate ?? TODAY })
        .where(eq(assets.id, r.id));
      placedLeftovers++;
    }
  }

  // Maintenance history: last two completed PPMs per asset; ~1 in 7 skipped its latest PPM (→ overdue);
  // upcoming PPMs in the next 45 days are scheduled. Faulty devices get their work orders in scripts/seed/workorders.ts.
  const events: (typeof maintenanceEvents.$inferInsert)[] = [];
  const techs = ["Ahmed Samir (BME)", "Mona Farouk (BME)", "Karim Adel (BME)", "Vendor field engineer"];
  for (const c of created) {
    if (!c.install || c.status === "IN_STOCK") continue;
    const interval = typeById.get(c.typeId)?.ppm ?? 12;
    const cycles: string[] = [];
    for (let d = addMonths(c.install, interval); d < TODAY && cycles.length < 40; d = addMonths(d, interval)) cycles.push(d);
    const behind = c.idx % 7 === 3 && cycles.length > 0;
    const missed = behind ? cycles.pop()! : null;
    for (const d of cycles.slice(-2)) {
      events.push({ assetId: c.id, type: "PPM", status: "COMPLETED", scheduledDate: d, completedDate: addDays(d, Math.floor(rand() * 6)),
        performedBy: pick(techs), downtimeHours: Math.round((0.5 + rand() * 2.5) * 10) / 10,
        findings: pick(["All checks passed. Electrical safety test passed.", "Passed. Replaced filters and seals per PPM kit.", "Passed. Battery capacity 86 %, recommend replacement at next visit.", "Passed after recalibration of sensors."]) });
    }
    if (missed && c.idx % 2 === 1) events.push({ assetId: c.id, type: "PPM", status: "SCHEDULED", scheduledDate: missed });
    const next = addMonths(cycles[cycles.length - 1] ?? missed ?? c.install, interval);
    if (!behind && next >= TODAY && next <= addDays(TODAY, 45)) events.push({ assetId: c.id, type: "PPM", status: "SCHEDULED", scheduledDate: next });
    if (typeById.get(c.typeId)?.calib && cycles.length && c.idx % 3 === 0) {
      const d = cycles[cycles.length - 1];
      events.push({ assetId: c.id, type: "CALIBRATION", status: "COMPLETED", scheduledDate: d, completedDate: d, performedBy: "Vendor field engineer", cost: "350.00", currency: "USD", findings: "Calibrated against reference; within tolerance." });
    }
  }
  for (let i = 0; i < events.length; i += 500) await db.insert(maintenanceEvents).values(events.slice(i, i + 500));

  // A couple of movements: a syringe pump borrowed between ICU beds, a ward monitor sent to the workshop earlier.
  const pumps = await db.select({ id: assets.id }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(eq(deviceTypes.code, "INF-PMP-SYR"), inArray(assets.roomId, [roomByCode.get("3-ICU-BED03")?.id ?? -1]))).limit(1);
  const bed5 = roomByCode.get("3-ICU-BED05"), bed3 = roomByCode.get("3-ICU-BED03");
  let moves = 0;
  if (pumps[0] && bed5) {
    await moveAsset({ assetId: pumps[0].id, toRoomId: bed5.id, reason: "Second infusion line needed for bed 5 admission", movedBy: "ICU charge nurse" });
    moves++;
  }
  const wardMon = await db.select({ id: assets.id }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(eq(deviceTypes.code, "MON-PAT-MID"), eq(assets.roomId, roomByCode.get("4-MED-PR01")?.id ?? -1))).limit(1);
  const ccu2 = roomByCode.get("3-CCU-BED02");
  if (wardMon[0] && ccu2 && bed3) {
    await moveAsset({ assetId: wardMon[0].id, toRoomId: ccu2.id, reason: "Temporary cover while CCU monitor is serviced", movedBy: "Biomedical engineering" });
    await moveAsset({ assetId: wardMon[0].id, toRoomId: roomByCode.get("4-MED-PR01")!.id, reason: "Returned to medical ward", movedBy: "Biomedical engineering" });
    moves += 2;
  }
  await db.execute(sql`update ${assetMovements} set moved_at = moved_at - (interval '1 day' * (12 - id % 10))`);

  console.log(`  assets: ${created.length} created, ${reused + placedLeftovers} received units placed in rooms, ${events.length} maintenance events, ${moves} movements${skipped ? `, ${skipped} plan lines skipped` : ""}`);
}
