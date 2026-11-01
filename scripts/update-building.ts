/**
 * Update a hospital's drawings in place from a revised building file (wave 7): rooms matched by code, only changes
 * written, rooms that still hold equipment kept. Equipment, history and lifts are kept.
 *   npm run cad:update -- seed-data/cad/la-plaza.json            list the changes (nothing written)
 *   npm run cad:update -- seed-data/cad/la-plaza.json --apply    apply them
 * The facility is found by the file's facilityCode (or pass --facility=LPH).
 * The same is available in the app under Facilities › (hospital) › Update drawings.
 */
import { existsSync, readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db";
import { facilities } from "../src/db/schema";
import { checkBuilding } from "../src/lib/assets/cad-merge";
import { applyMerge, planFor } from "../src/lib/assets/cad-merge-data";
import type { CadBuilding } from "../src/lib/assets/cad-rooms";

async function main() {
  const file = process.argv.slice(2).find((a) => a.endsWith(".json"));
  if (!file || !existsSync(file)) throw new Error("Give the revised building file, e.g. npm run cad:update -- seed-data/cad/la-plaza.json");
  const b = JSON.parse(readFileSync(file, "utf8")) as CadBuilding;
  const bad = checkBuilding(b); if (bad) throw new Error(bad);
  const code = (process.argv.find((a) => a.startsWith("--facility="))?.slice(11) ?? b.facilityCode ?? "").toUpperCase();
  const [fac] = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(eq(facilities.code, code));
  if (!fac) throw new Error(`No facility with code "${code}". Import the building first (npm run cad:load), or pass --facility=CODE.`);
  const apply = process.argv.includes("--apply");
  const plan = apply ? await applyMerge(db, fac.id, b, "cad:update") : await planFor(db, fac.id, b);
  const n = plan.counts;
  console.log(`${fac.name}: ${n.added} rooms to add, ${n.renamed} renamed, ${n.reshaped} reshaped, ${n.department} change department, ${n.removed} to remove, ${n.kept} kept (still hold equipment)`);
  if (plan.floorsAdded.length) console.log(`  New floors: ${plan.floorsAdded.map((f) => f.name).join(", ")}`);
  if (plan.floorsMissing.length) console.log(`  Not in the new drawing (left as they are): ${plan.floorsMissing.map((f) => f.name).join(", ")}`);
  if (plan.newDepartments.length) console.log(`  New departments: ${plan.newDepartments.join(", ")}`);
  for (const c of plan.changes.slice(0, 60)) console.log(`  ${c.kind.padEnd(10)} ${c.floorName.padEnd(14)} ${c.code.padEnd(14)} ${c.name}${c.was ? ` (was ${c.was})` : ""}${c.assets ? ` — ${c.assets} devices` : ""}`);
  if (plan.changes.length > 60) console.log(`  … and ${plan.changes.length - 60} more`);
  console.log(apply ? "Applied." : "Nothing written. Run again with --apply to apply these changes.");
}

main().then(() => closeDb()).then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
