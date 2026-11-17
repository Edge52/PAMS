/** Database rules (wave 24), checked on a real scratch database built from the migrations. */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pg: PGlite;
const fails = async (sql: string) => { try { await pg.exec(sql); return null; } catch (e) { return String((e as Error).message); } };

beforeAll(async () => {
  pg = new PGlite();
  const dir = path.resolve(__dirname, "../../drizzle");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
  }
  await pg.exec(`insert into activity_log (entity_type, entity_id, action, summary, actor) values ('asset', 1, 'created', 'First entry', 'Test')`);
}, 120_000);
afterAll(async () => { await pg?.close(); });

describe("database rules (wave 24)", () => {
  it("keeps the activity log insert-only", async () => {
    expect(await fails(`update activity_log set summary = 'changed'`)).toMatch(/can't be changed or deleted/);
    expect(await fails(`delete from activity_log`)).toMatch(/can't be changed or deleted/);
    expect(await fails(`insert into activity_log (entity_type, entity_id, action, summary) values ('asset', 1, 'updated', 'Second entry')`)).toBeNull();
    const r = await pg.query<{ n: number }>(`select count(*)::int as n from activity_log`);
    expect(r.rows[0].n).toBe(2);
  });
  it("lets a deleted account drop out of the log without losing the entry", async () => {
    await pg.exec(`insert into users (name, email, password_hash, role) values ('Temp', 'temp@example.test', 'x', 'VIEWER')`);
    await pg.exec(`insert into activity_log (entity_type, entity_id, action, summary, actor, actor_id) select 'asset', 1, 'updated', 'By temp', 'Temp', id from users where email = 'temp@example.test'`);
    expect(await fails(`delete from users where email = 'temp@example.test'`)).toBeNull();
    const r = await pg.query<{ actor: string; actor_id: number | null }>(`select actor, actor_id from activity_log where summary = 'By temp'`);
    expect(r.rows[0]).toEqual({ actor: "Temp", actor_id: null });
  });
  it("refuses impossible figures", async () => {
    const r = await pg.query<{ conname: string }>(`select conname from pg_constraint where contype = 'c' and conname like '%_check' order by 1`);
    const names = r.rows.map((x) => x.conname);
    for (const n of ["po_lines_quantity_check", "po_lines_price_check", "offer_lines_discount_check", "service_contracts_dates_check", "frameworks_dates_check", "buildings_north_check", "equipment_models_glb_bytes_check"]) expect(names).toContain(n);
  });
  it("keeps a device's history: nothing is deleted along with a device", async () => {
    const r = await pg.query<{ n: number }>(`select count(*)::int as n from pg_constraint c join pg_class t on t.oid = c.confrelid where c.contype = 'f' and t.relname = 'assets' and c.confdeltype = 'c'`);
    expect(r.rows[0].n).toBe(0);
  });
});
