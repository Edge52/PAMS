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
//
// The client is opened on first use, never at import. `next dev` forks short-lived helper processes that import
// page modules without serving requests (the static-paths worker for dynamic routes like /assets/[id], re-forked
// after every revalidatePath). Opening PGlite at import made each of them open the live data folder from a second
// process: it either PANICked ("Unhandled Rejection: RuntimeError: Aborted()") or ran crash recovery on the folder
// while the server was writing to it, which can corrupt it. Postgres pools connect lazily, so they were unaffected.
function clients(): Clients {
  return (globalForDb.hpamsDb ??= connect());
}

/** The Drizzle client. Connects on first query, not when imported. */
export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    if (prop === "then") return undefined; // `await db` / returning db from an async function must not connect
    const real = clients().db;
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
  has: (_target, prop) => prop in clients().db,
});

/** Close the connection if one was opened (scripts call this before exiting so PGlite flushes to disk). */
export async function closeDb(): Promise<void> {
  const open = globalForDb.hpamsDb;
  if (!open) return;
  globalForDb.hpamsDb = undefined;
  await open.close();
}
export { schema };
