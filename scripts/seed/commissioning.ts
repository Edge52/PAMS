/**
 * Commissioning (demo, wave 14): La Plaza's busiest equipped floor as if it were opening now, departments handed
 * over two weeks apart from eight weeks ago, a few handovers late. Skipped when any plan exists. Dates are made up.
 */
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import { assets, buildings, commissioningPlans, commissioningRooms, facilities, floors, rooms } from "../../src/db/schema";
import { coreKind } from "../../src/components/assets/twin/geometry";
import { addDays, NO_EQUIPMENT_TYPES, weekStart } from "../../src/lib/assets/commissioning";

export default async function seed(db: DB) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(commissioningPlans);
  if (n > 0) { console.log("  commissioning: a plan exists, skipped"); return; }
  const [fac] = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.code, "LPH"));
  if (!fac) { console.log("  commissioning: no La Plaza, skipped"); return; }
  // The floor with the most equipped rooms.
  const [best] = await db.select({ floorId: rooms.floorId, name: floors.name, n: sql<number>`count(distinct ${rooms.id})::int` })
    .from(assets).innerJoin(rooms, eq(rooms.id, assets.roomId)).innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId))
    .where(and(eq(buildings.facilityId, fac.id), ne(assets.status, "DISPOSED"))).groupBy(rooms.floorId, floors.name).orderBy(sql`3 desc`).limit(1);
  if (!best) { console.log("  commissioning: no equipped rooms, skipped"); return; }
  const rs = (await db.select({ id: rooms.id, name: rooms.name, type: rooms.type, departmentId: rooms.departmentId }).from(rooms).where(eq(rooms.floorId, best.floorId)).orderBy(asc(rooms.code)))
    .filter((r) => r.type !== "CORRIDOR" && !coreKind(r.name));
  const today = new Date().toISOString().slice(0, 10);
  const start = addDays(weekStart(today), -56);
  const depts = [...new Set(rs.map((r) => r.departmentId ?? 0))];
  await db.transaction(async (tx) => {
    const [p] = await tx.insert(commissioningPlans).values({ facilityId: fac.id, name: `${best.name} opening (demo)`, startsOn: start, installWeeks: 2, acceptWeeks: 2,
      notes: "Demo plan: dates are made up.", createdByName: "Demo data" }).returning({ id: commissioningPlans.id });
    const values = rs.map((r) => {
      const i = depts.indexOf(r.departmentId ?? 0);
      const planned = addDays(start, i * 14);
      // Handovers recorded up to last week; every third department a week late.
      const actual = addDays(planned, i % 3 === 2 ? 7 : 0);
      return { planId: p.id, roomId: r.id, handoverPlanned: planned, handoverOn: actual <= addDays(today, -7) ? actual : null, noEquipment: NO_EQUIPMENT_TYPES.has(r.type) };
    });
    for (let k = 0; k < values.length; k += 500) await tx.insert(commissioningRooms).values(values.slice(k, k + 500));
  });
  console.log(`  commissioning: demo plan for ${best.name} (${rs.length} rooms)`);
}
