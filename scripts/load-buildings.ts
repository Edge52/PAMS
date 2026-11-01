/**
 * Load real buildings for go-live: floors, rooms and departments from the CAD imports in seed-data/cad/, with NO demo
 * equipment. Buildings whose facility code already exists are left alone. Safe to run more than once.
 *   npm run cad:load                      every building in seed-data/cad/
 *   npm run cad:load -- la-plaza.json     one building
 * On the Docker server: docker compose exec app npx tsx scripts/load-buildings.ts
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { closeDb, db } from "../src/db";
import { importBuilding, type CadBuilding } from "./seed/cad";

async function main() {
  const dir = path.join(__dirname, "..", "seed-data", "cad");
  if (!existsSync(dir)) throw new Error("No seed-data/cad folder: import the drawings first (npm run cad:import).");
  const only = process.argv.slice(2).filter((a) => a.endsWith(".json"));
  const files = only.length ? only : readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const file = path.isAbsolute(f) ? f : path.join(dir, path.basename(f));
    if (!existsSync(file)) throw new Error(`Not found: ${file}`);
    await importBuilding(db, JSON.parse(readFileSync(file, "utf8")) as CadBuilding, { equipment: false });
  }
  console.log("Done. Add the equipment through Assets › Import, Register asset or Bulk placement.");
}

main().then(() => closeDb()).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
