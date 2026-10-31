/**
 * Apply database migrations (drizzle/*.sql) to DATABASE_URL — a Postgres server or a PGlite folder.
 *   npm run db:migrate
 */
import path from "node:path";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migrateLite } from "drizzle-orm/pglite/migrator";
import { closeDb, db, DATABASE_URL, isPglite } from "../src/db";

export async function runMigrations() {
  const migrationsFolder = path.resolve(__dirname, "..", "drizzle");
  // The two migrators take the same options; the db handle is the matching driver underneath.
  if (isPglite) await migrateLite(db as never, { migrationsFolder });
  else await migratePg(db, { migrationsFolder });
  console.log(`migrations applied to ${isPglite ? DATABASE_URL : "PostgreSQL"}`);
}

if (/migrate\.ts$/.test(process.argv[1] ?? "")) {
  runMigrations().then(() => closeDb()).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
