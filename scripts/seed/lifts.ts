/**
 * Lift cores (wave 7): every hospital with drawings and no lifts declared gets the lifts its lobbies suggest, marked as
 * assumptions to confirm under Facilities › Lifts. Skipped for hospitals that already have lifts.
 */
import { eq, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import { buildings, facilities, floorCad, floors, liftCores } from "../../src/db/schema";
import { addLiftSuggestions } from "../../src/lib/assets/lifts-data";

export default async function seed(db: DB) {
  const withCad = await db.selectDistinct({ id: facilities.id, name: facilities.name }).from(facilities)
    .innerJoin(buildings, eq(buildings.facilityId, facilities.id)).innerJoin(floors, eq(floors.buildingId, buildings.id))
    .innerJoin(floorCad, eq(floorCad.floorId, floors.id))
    .where(sql`not exists (select 1 from ${liftCores} l where l.facility_id = ${facilities.id})`);
  if (!withCad.length) { console.log("  lifts: nothing to add, skipped"); return; }
  for (const f of withCad) console.log(`  lifts: ${f.name} — ${await addLiftSuggestions(db, f.id)} suggested from the drawings`);
}
