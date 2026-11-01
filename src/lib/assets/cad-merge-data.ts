/**
 * Update a hospital's drawings in place (wave 7, step 7-0): load what the hospital has, plan the merge (cad-merge.ts)
 * and apply it in one transaction. Takes the database as a parameter, so the command-line script can use it too.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../../db";
import { activityLog, assets, buildings, departments, floorCad, floors, rooms } from "../../db/schema";
import { classifyRoom, DEPARTMENTS, titleCase, type CadBuilding, type CadRoom } from "./cad-rooms";
import { deptKey, deptOf, planMerge, type ExistingFloor, type ExistingRoom, type MergePlan } from "./cad-merge";

export async function mergeInputs(db: DB, facilityId: number) {
  const fl: ExistingFloor[] = await db.select({ id: floors.id, level: floors.level, name: floors.name }).from(floors)
    .innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facilityId)).orderBy(asc(floors.level));
  const ids = fl.map((f) => f.id);
  const rs: ExistingRoom[] = ids.length ? (await db.select({
    id: rooms.id, floorId: rooms.floorId, code: rooms.code, name: rooms.name, deptCode: departments.code, poly: rooms.polygon,
    assets: sql<number>`(select count(*) from ${assets} a where a.room_id = ${rooms.id} and a.status <> 'DISPOSED')::int`,
  }).from(rooms).leftJoin(departments, eq(departments.id, rooms.departmentId)).where(inArray(rooms.floorId, ids)))
    .map((r) => ({ ...r, poly: r.poly && r.poly.length >= 3 ? r.poly : null, assets: Number(r.assets) })) : [];
  const deptRows = await db.select({ id: departments.id, code: departments.code }).from(departments).where(eq(departments.facilityId, facilityId));
  return { floors: fl, rooms: rs, departments: deptRows };
}

export async function planFor(db: DB, facilityId: number, b: CadBuilding): Promise<MergePlan> {
  const inp = await mergeInputs(db, facilityId);
  return planMerge(inp.floors, inp.rooms, b, inp.departments.map((d) => d.code));
}

const rect = (r: CadRoom) => {
  const xs = r.poly.map((p) => p[0]), ys = r.poly.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return {
    x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
    w: Math.max(5, Math.round((Math.max(...xs) - x) * 10) / 10), h: Math.max(5, Math.round((Math.max(...ys) - y) * 10) / 10),
  };
};

/** Apply the merge. The plan is worked out again inside the transaction, so it matches the data at that moment. */
export async function applyMerge(db: DB, facilityId: number, b: CadBuilding, actor: string): Promise<MergePlan> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const inp = await mergeInputs(t, facilityId);
    const plan = planMerge(inp.floors, inp.rooms, b, inp.departments.map((d) => d.code));

    // Building to add new floors to (the first one, or a new main building).
    let [bld] = await tx.select({ id: buildings.id }).from(buildings).where(eq(buildings.facilityId, facilityId)).orderBy(asc(buildings.id)).limit(1);
    if (!bld) [bld] = await tx.insert(buildings).values({ facilityId, code: "MAIN", name: "Main building" }).returning({ id: buildings.id });

    // Departments: existing by code, new ones created from the drawing codes.
    const deptId = new Map(inp.departments.map((d) => [deptKey(d.code)!, d.id]));
    for (const dc of plan.newDepartments) {
      const m = DEPARTMENTS[dc] ?? { name: `Department ${dc}`, type: null };
      const [d] = await tx.insert(departments).values({ facilityId, code: deptKey(dc)!, name: m.name, departmentTypeCode: m.type }).returning({ id: departments.id });
      deptId.set(deptKey(dc)!, d.id);
    }
    const deptFor = (r: CadRoom) => { const d = deptOf(r); return d ? deptId.get(deptKey(d)!) ?? null : null; };
    const newRoom = (floorId: number, r: CadRoom) => ({ floorId, code: r.code, name: titleCase(r.name), departmentId: deptFor(r), ...classifyRoom(r.name, r.dept), ...rect(r), polygon: r.poly });
    const cadRow = (floorId: number, f: CadBuilding["floors"][number]) => ({ floorId, sourceFile: f.sourceFile, walls: f.walls, doors: f.doors, glass: f.glass, columns: f.columns });

    // Floors in both: new linework, name, height and scale.
    for (const { floorId, cad } of plan.floorsUpdated) {
      await tx.update(floors).set({ name: cad.name, elevation: cad.elevation, unitsPerMetre: b.unitsPerMetre, planWidth: b.planWidth, planHeight: b.planHeight }).where(eq(floors.id, floorId));
      await tx.delete(floorCad).where(eq(floorCad.floorId, floorId));
      await tx.insert(floorCad).values(cadRow(floorId, cad));
    }
    // New floors with all their rooms.
    for (const cad of plan.floorsAdded) {
      const [fl] = await tx.insert(floors).values({ buildingId: bld.id, level: cad.level, name: cad.name, planWidth: b.planWidth, planHeight: b.planHeight, elevation: cad.elevation, unitsPerMetre: b.unitsPerMetre }).returning({ id: floors.id });
      await tx.insert(floorCad).values(cadRow(fl.id, cad));
      const values = cad.rooms.map((r) => newRoom(fl.id, r));
      for (let i = 0; i < values.length; i += 200) await tx.insert(rooms).values(values.slice(i, i + 200));
    }
    // Rooms on floors in both: only what changed.
    const cadByKey = new Map(plan.floorsUpdated.flatMap(({ floorId, cad }) => cad.rooms.map((r) => [`${floorId}|${r.code.toUpperCase()}`, r] as const)));
    const floorOfLevel = new Map(inp.floors.map((f) => [f.level, f.id]));
    const added = plan.changes.filter((c) => c.kind === "added" && floorOfLevel.has(c.floorLevel));
    const addRows = added.map((c) => { const floorId = floorOfLevel.get(c.floorLevel)!; return newRoom(floorId, cadByKey.get(`${floorId}|${c.code.toUpperCase()}`)!); });
    for (let i = 0; i < addRows.length; i += 200) await tx.insert(rooms).values(addRows.slice(i, i + 200));
    for (const c of plan.changes) {
      if (!c.roomId || c.kind === "added" || c.kind === "kept") continue;
      if (c.kind === "removed") { await tx.delete(rooms).where(and(eq(rooms.id, c.roomId), sql`not exists (select 1 from ${assets} a where a.room_id = ${c.roomId})`)); continue; }
      const floorId = floorOfLevel.get(c.floorLevel)!;
      const r = cadByKey.get(`${floorId}|${c.code.toUpperCase()}`); if (!r) continue;
      if (c.kind === "renamed") await tx.update(rooms).set({ name: c.name, ...classifyRoom(r.name, r.dept) }).where(eq(rooms.id, c.roomId));
      if (c.kind === "reshaped") await tx.update(rooms).set({ polygon: r.poly, ...rect(r) }).where(eq(rooms.id, c.roomId));
      if (c.kind === "department") await tx.update(rooms).set({ departmentId: deptFor(r) }).where(eq(rooms.id, c.roomId));
    }
    const n = plan.counts;
    await tx.insert(activityLog).values({
      entityType: "facility", entityId: facilityId, action: "drawings_updated", actor,
      summary: `Drawings updated: ${n.added} rooms added, ${n.renamed} renamed, ${n.reshaped} reshaped, ${n.department} moved department, ${n.removed} removed, ${n.kept} kept (still hold equipment); ${plan.floorsAdded.length} floors added.`,
    });
    return plan;
  });
}
