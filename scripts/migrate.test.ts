/**
 * CO-12 (audit, wave 30): migrations on start take a lock and copy the database first.
 * The PostgreSQL part needs a server where it may create scratch databases: TEST_DATABASE_URL=postgres://… (CI sets
 * it; without it those tests are skipped).
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { pendingMigrations, runMigrations } from "./migrate";

vi.mock("server-only", () => ({}));

const folder = path.resolve(__dirname, "..", "drizzle");
const journal = JSON.parse(readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };

describe("pendingMigrations", () => {
  it("lists everything for a new database and only newer ones after", () => {
    const j = { entries: [{ tag: "a", when: 1 }, { tag: "b", when: 2 }, { tag: "c", when: 3 }] };
    expect(pendingMigrations(j, null)).toEqual(["a", "b", "c"]);
    expect(pendingMigrations(j, 2)).toEqual(["c"]);
    expect(pendingMigrations(j, 3)).toEqual([]);
  });
});

const server = process.env.TEST_DATABASE_URL;
const made: string[] = [];
async function scratchDb(): Promise<string> {
  const name = `hpams_mig_${process.pid}_${made.length}_${Date.now() % 100000}`;
  const c = new Client({ connectionString: server }); await c.connect();
  await c.query(`create database ${name}`); await c.end();
  made.push(name);
  const u = new URL(server!); u.pathname = `/${name}`;
  return u.toString();
}
afterAll(async () => {
  if (!server || !made.length) return;
  const c = new Client({ connectionString: server }); await c.connect();
  for (const n of made) await c.query(`drop database if exists ${n} with (force)`).catch(() => {});
  await c.end();
});
const quiet = () => {};

describe.skipIf(!server)("migrating PostgreSQL (CO-12)", () => {
  it("two instances starting together both succeed", async () => {
    const url = await scratchDb();
    const backupDir = mkdtempSync(path.join(tmpdir(), "mig-"));
    await Promise.all([runMigrations({ url, backupDir, log: quiet }), runMigrations({ url, backupDir, log: quiet })]);
    const c = new Client({ connectionString: url }); await c.connect();
    const r = await c.query<{ n: number }>("select count(*)::int as n from drizzle.__drizzle_migrations");
    await c.end();
    expect(r.rows[0].n).toBe(journal.entries.length);
    expect(readdirSync(backupDir)).toEqual([]); // a new database: nothing to copy
  }, 120_000);

  it("copies a database that has data before applying new migrations", async () => {
    const url = await scratchDb();
    // Migrate to the previous release first: a copy of the folder without the newest migration.
    const old = mkdtempSync(path.join(tmpdir(), "mig-old-"));
    cpSync(folder, old, { recursive: true });
    const last = journal.entries[journal.entries.length - 1];
    writeFileSync(path.join(old, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) }));
    await runMigrations({ url, migrationsFolder: old, log: quiet });
    const c = new Client({ connectionString: url }); await c.connect();
    await c.query("insert into facilities (code, name) values ('T', 'Test hospital')");
    await c.end();

    const backupDir = mkdtempSync(path.join(tmpdir(), "mig-bk-"));
    const lines: string[] = [];
    await runMigrations({ url, backupDir, log: (s) => lines.push(s) });
    const dumps = readdirSync(backupDir).filter((n) => /^hpams-premigrate-.*\.dump$/.test(n));
    if (lines.some((l) => /pg_dump isn't installed/.test(l))) return; // no client tools on this machine
    expect(dumps).toHaveLength(1);
    const f = path.join(backupDir, dumps[0]);
    expect(readFileSync(f).subarray(0, 5).toString()).toBe("PGDMP");
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(lines.join("\n")).toContain(last.tag);

    await runMigrations({ url, backupDir, log: quiet }); // up to date: no second copy
    expect(readdirSync(backupDir).filter((n) => n.endsWith(".dump"))).toHaveLength(1);
    expect(existsSync(path.join(backupDir, `.partial-${dumps[0]}`))).toBe(false);
  }, 120_000);
});
