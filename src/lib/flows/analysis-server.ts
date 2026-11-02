import "server-only";
/** Pathway analysis for one hospital (wave 7, step 7d): every published pathway, with the hospital's rooms and devices. */
import { and, asc, eq, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db } from "@/db";
import { assets, buildings, departments, deviceTypes, floors, patientFlows, rooms } from "@/db/schema";
import { analyse, type AFlow } from "./analysis";
import { readiness, readinessLine as readinessLineOf } from "./readiness";
import { equipmentNames, loadFlow } from "./server";

export async function hospitalAnalysis(facilityId: number) {
  const pub = await db.select({ id: patientFlows.id }).from(patientFlows)
    .where(and(eq(patientFlows.facilityId, facilityId), eq(patientFlows.status, "PUBLISHED"))).orderBy(asc(patientFlows.name));
  const loaded = (await Promise.all(pub.map((p) => loadFlow(p.id)))).filter((f) => f != null);
  const flows: (AFlow & { version: number })[] = loaded.map((f) => ({
    id: f.flow.id, name: f.flow.name, version: f.flow.version, dailyVolume: f.flow.dailyVolume, arrivalProfile: f.flow.arrivalProfile, steps: f.steps, links: f.links,
  }));
  const rs = await db.select({ id: rooms.id, name: rooms.name, type: rooms.type, departmentId: rooms.departmentId }).from(rooms)
    .innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facilityId));
  const ds = await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.facilityId, facilityId));
  const kit = await db.select({ id: assets.id, typeCode: deviceTypes.code, typeName: deviceTypes.name, roomId: assets.roomId, status: assets.status })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(eq(assets.facilityId, facilityId), sql`${assets.status} <> 'DISPOSED'`, sql`${assets.roomId} is not null`));
  const names = await equipmentNames(flows.flatMap((f) => f.steps.flatMap((s) => s.equipment)));
  return {
    flows,
    analysis: analyse(flows, rs, ds, kit),
    readiness: flows.map((f) => ({ id: f.id, name: f.name, ...readiness(f.steps, rs, kit, undefined, names) })),
  };
}

export type HospitalAnalysis = Awaited<ReturnType<typeof hospitalAnalysis>>;

/** The "Pathway analysis" workbook: load, beds, scanners, readiness, and the assumptions. */
export async function analysisWorkbook(facilityName: string, a: HospitalAnalysis) {
  const wb = new ExcelJS.Workbook(); wb.creator = "Hospital PAMS"; wb.created = new Date();
  const head = (ws: ExcelJS.Worksheet, cols: { h: string; w: number }[]) => {
    ws.columns = cols.map((c) => ({ header: c.h, width: c.w }));
    const r = ws.getRow(1); r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D5C4D" } }; r.alignment = { vertical: "middle", wrapText: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const pctFmt = "0%";
  const load = wb.addWorksheet("Room load");
  head(load, [{ h: "Place", w: 30 }, { h: "Steps", w: 50 }, { h: "Patients a day", w: 14 }, { h: "Busiest hour", w: 12 }, { h: "At once, busiest hour", w: 16 }, { h: "Rooms", w: 8 }, { h: "Load", w: 9 }, { h: "Over 85 %", w: 10 }, { h: "How it's worked out", w: 90 }]);
  for (const r of a.analysis.load) load.addRow([r.place, r.steps.join("; "), r.patientsPerDay, `${String(r.peakHour).padStart(2, "0")}:00`, r.atOncePeak, r.rooms, r.utilisation, r.flag ? "Yes" : "", r.formula]);
  load.getColumn(7).numFmt = pctFmt;
  const beds = wb.addWorksheet("Beds");
  head(beds, [{ h: "Department", w: 30 }, { h: "Steps", w: 50 }, { h: "Patients a day", w: 14 }, { h: "Beds needed", w: 12 }, { h: "Beds", w: 8 }, { h: "Counted from", w: 14 }, { h: "Short", w: 8 }, { h: "How it's worked out", w: 90 }]);
  for (const r of a.analysis.beds) beds.addRow([r.department, r.steps.join("; "), r.patientsPerDay, r.bedsNeeded, r.beds, r.source === "devices" ? "Beds registered" : "Bed rooms", r.flag ? "Yes" : "", r.formula]);
  const sc = wb.addWorksheet("Scanners");
  head(sc, [{ h: "Place", w: 30 }, { h: "Modality", w: 12 }, { h: "Exams a year", w: 13 }, { h: "Devices", w: 9 }, { h: "Capacity a year", w: 14 }, { h: "Load", w: 9 }, { h: "Over 85 %", w: 10 }, { h: "How it's worked out", w: 90 }]);
  for (const r of a.analysis.scanners) sc.addRow([r.place, r.modality, r.examsPerYear, r.devices, r.capacity, r.utilisation, r.flag ? "Yes" : "", r.formula]);
  sc.getColumn(6).numFmt = pctFmt;
  const rd = wb.addWorksheet("Equipment readiness");
  head(rd, [{ h: "Pathway", w: 36 }, { h: "Step", w: 24 }, { h: "Equipment", w: 36 }, { h: "Looked in", w: 12 }, { h: "Found", w: 8 }, { h: "Working", w: 9 }, { h: "State", w: 10 }]);
  for (const f of a.readiness) for (const r of f.rows) rd.addRow([f.name, r.step, r.typeName, r.scope === "room" ? "Room" : "Department", r.found, r.working, r.state === "ok" ? "Ready" : r.state === "down" ? "Down" : "Missing"]);
  const as = wb.addWorksheet("Assumptions");
  as.columns = [{ width: 120 }];
  for (const line of [
    `Pathway analysis — ${facilityName}, ${new Date().toISOString().slice(0, 10)}. All figures are estimates.`,
    `Pathways: ${a.flows.map((f) => `${f.name} v${f.version} (${f.dailyVolume ?? "no"} patients a day)`).join("; ") || "none published"}.`,
    "Room load: in each hour, patients arriving that hour × minutes at the step ÷ 60 (average number there at once), summed over pathways; the busiest hour ÷ rooms. A patient is counted at every step in the hour they arrive. Flag above 85 %.",
    "Rooms: the step's own room, or the department's care rooms (patient rooms, wards, ICU bays, theatres, procedure, imaging and consultation rooms).",
    "Beds needed: stays of 12 hours or more; patients a day × days in bed, against registered beds in the department (or its bed rooms when no beds are registered).",
    "Scanners: exams a year from these pathways only, against devices × 12,000 (CT), 6,000 (MRI), 10,000 (X-ray), 6,000 (ultrasound) a year.",
    "Equipment readiness: device types each step needs, in its room or else its department; in service or installed counts as working. As of the export.",
    ...a.analysis.skipped.map((s) => `Not counted: ${s}`),
  ]) as.addRow([line]).alignment = { wrapText: true };
  return wb;
}

/** Published pathways missing working equipment, for the dashboard (hospitals in the user's scope; null = all). */
export async function pathwayRisks(scope: number[] | null) {
  const pub = await db.select({ id: patientFlows.id, facilityId: patientFlows.facilityId }).from(patientFlows).where(eq(patientFlows.status, "PUBLISHED"));
  const mine = pub.filter((p) => scope === null || scope.includes(p.facilityId));
  if (!mine.length) return [];
  const out: { id: number; name: string; facilityId: number; problems: string[]; total: number }[] = [];
  for (const facilityId of [...new Set(mine.map((p) => p.facilityId))]) {
    const a = await hospitalAnalysis(facilityId);
    for (const r of a.readiness) if (r.blocked) out.push({ id: r.id, name: r.name, facilityId, total: r.total, problems: r.rows.filter((x) => x.state !== "ok").map(readinessLineOf) });
  }
  return out;
}
