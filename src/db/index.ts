/**
 * Database client.
 *
 *  - DATABASE_URL=postgres://…      → a real PostgreSQL server (production).
 *  - DATABASE_URL=pglite:./.pglite  → PGlite, Postgres compiled to WebAssembly running inside Node, with its data in a
 *    local folder. Nothing to install: used by `npm run demo`. Also the default when DATABASE_URL is not set.
 *
 * Both give the same Drizzle API. PGlite is single-user and runs in one process, so it's for demos and trying the
 * system on a laptop, not for a hospital deployment.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

export const DATABASE_URL = process.env.DATABASE_URL || "pglite:./.pglite";
export const isPglite = DATABASE_URL.startsWith("pglite:");

type Clients = { db: DB; close: () => Promise<void> };
const globalForDb = globalThis as unknown as { hpamsDb?: Clients };

function connect(): Clients {
  if (isPglite) {
    const dir = path.resolve(/* turbopackIgnore: true */ process.cwd(), DATABASE_URL.slice("pglite:".length) || ".pglite");
    const client = new PGlite(dir);
    // Same query API as node-postgres for everything this app uses (select/insert/update/delete, execute().rows, transactions).
    const db = drizzleLite(client, { schema, casing: "snake_case" }) as unknown as DB;
    return { db, close: () => client.close() };
  }
  const pool = new Pool({ connectionString: DATABASE_URL });
  return { db: drizzlePg(pool, { schema, casing: "snake_case" }), close: () => pool.end() };
}

// One client per process (also across dev hot reloads). PGlite must never be opened twice on the same folder.
const clients = globalForDb.hpamsDb ?? connect();
globalForDb.hpamsDb = clients;

export const db = clients.db;
/** Close the connection (scripts call this before exiting so PGlite flushes to disk). */
export const closeDb = clients.close;
export { schema };
