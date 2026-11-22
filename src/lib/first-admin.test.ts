/**
 * S10 (audit, wave 30): setup needs SETUP_CODE on a server, and two setups at once make one administrator.
 * In-memory PGlite with the real migrations; the parallel test also runs on PostgreSQL when TEST_DATABASE_URL is set.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/pglite/migrator";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema";
import type { DB } from "../db";
import { claimFirstAdmin, setupCodeRule } from "./first-admin";

const migrations = path.resolve(__dirname, "..", "..", "drizzle");
const admin = (i: number) => ({ name: `Admin ${i}`, email: `admin${i}@hospital.eg`, passwordHash: `hash${i}` });

describe("setupCodeRule", () => {
  it("asks for the code when set", () => { expect(setupCodeRule({ SETUP_CODE: "x", NODE_ENV: "production", DATABASE_URL: "postgres://h/db" })).toEqual({ ask: true, locked: false }); });
  it("locks a production server with PostgreSQL and no code", () => { expect(setupCodeRule({ NODE_ENV: "production", DATABASE_URL: "postgres://h/db" })).toEqual({ ask: false, locked: true }); });
  it("leaves the embedded database and development open", () => {
    expect(setupCodeRule({ NODE_ENV: "production", DATABASE_URL: "pglite:./.pglite-data" }).locked).toBe(false);
    expect(setupCodeRule({ NODE_ENV: "production" }).locked).toBe(false); // no DATABASE_URL = embedded
    expect(setupCodeRule({ NODE_ENV: "development", DATABASE_URL: "postgres://h/db" }).locked).toBe(false);
  });
});

describe("claimFirstAdmin (PGlite)", () => {
  let client: PGlite;
  afterAll(async () => { await client?.close(); });
  it("makes one administrator when two setups arrive together", async () => {
    client = new PGlite();
    const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
    await migrate(d as never, { migrationsFolder: migrations });
    const ids = await Promise.all([claimFirstAdmin(d, admin(1)), claimFirstAdmin(d, admin(2))]);
    expect(ids.filter((x) => x !== null)).toHaveLength(1);
    const r = await client.query<{ n: number }>("select count(*)::int as n from users where role = 'ADMIN'");
    expect(r.rows[0].n).toBe(1);
    expect(await claimFirstAdmin(d, admin(3))).toBeNull();
  }, 60_000);
});

const server = process.env.TEST_DATABASE_URL;
describe.skipIf(!server)("claimFirstAdmin (PostgreSQL, parallel connections)", () => {
  const name = `hpams_setup_${process.pid}`;
  let pool: Pool | undefined;
  afterAll(async () => {
    await pool?.end();
    const c = new Client({ connectionString: server }); await c.connect();
    await c.query(`drop database if exists ${name} with (force)`); await c.end();
  });
  it("makes one administrator out of eight setups at once", async () => {
    const c = new Client({ connectionString: server }); await c.connect();
    await c.query(`create database ${name}`); await c.end();
    const u = new URL(server!); u.pathname = `/${name}`;
    pool = new Pool({ connectionString: u.toString(), max: 8 });
    const d = drizzlePg(pool, { schema, casing: "snake_case" }) as unknown as DB;
    await migratePg(d, { migrationsFolder: migrations });
    const ids = await Promise.all(Array.from({ length: 8 }, (_, i) => claimFirstAdmin(d, admin(i))));
    expect(ids.filter((x) => x !== null)).toHaveLength(1);
    const r = await pool.query<{ n: number }>("select count(*)::int as n from users where role = 'ADMIN'");
    expect(r.rows[0].n).toBe(1);
  }, 120_000);
});
