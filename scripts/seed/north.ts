/**
 * Demo north arrow (wave 28): the demo general hospital's main building gets a north angle, so the 3D view shows its
 * north arrow and compass. La Plaza is a real building and is left for someone who knows its north to enter.
 * Idempotent: only a building with no north and no recorded edit gets it, so a north cleared by hand stays cleared.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import { buildings, facilities } from "../../src/db/schema";

const DEMO_NORTH = 20;

export default async function seed(db: DB) {
  const rows = await db.select({ id: buildings.id }).from(buildings).innerJoin(facilities, eq(facilities.id, buildings.facilityId))
    .where(and(eq(facilities.code, "DGH"), eq(buildings.code, "B1"), isNull(buildings.northDeg),
      sql`not exists (select 1 from activity_log l where l.entity_type = 'building' and l.entity_id = ${buildings.id})`));
  if (!rows.length) { console.log("  north: nothing to set"); return; }
  await db.update(buildings).set({ northDeg: DEMO_NORTH }).where(eq(buildings.id, rows[0].id));
  console.log(`  north: demo hospital's main building, north ${DEMO_NORTH}°`);
}
