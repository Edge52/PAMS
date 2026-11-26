/**
 * Wave 40 (agent G), against in-memory PGlite with the real migrations: the BI views in docs/bi-views.sql create and
 * read, and the capital scenario actions save, overwrite by name and delete. The scenario part is skipped until the
 * migration with capital_scenarios exists in drizzle/ (the lead generates it at merge time).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";
import { BI_VIEWS } from "./bi-views";

const h = vi.hoisted(() => ({ d: null as unknown as DB, me: { id: 1, name: "Tester", email: "t@test.hpams", role: "ADMIN" as string, jobTitle: null, allFacilities: true } }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/server-utils", () => ({ logActivity: async () => {} }));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => h.me, requireUser: async () => h.me, getCurrentUser: async () => h.me,
  requireFacilityAccess: async () => {}, facilityScope: async () => null,
}));
vi.mock("@/lib/analytics/capital-whatif", () => import("./capital-whatif"));

const client = new PGlite();
const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
h.d = d;
await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
const ready = (await client.query<{ t: string | null }>("select to_regclass('public.capital_scenarios')::text as t")).rows[0]?.t != null;

afterAll(async () => { await client.close(); });

describe("BI views", () => {
  it("create from docs/bi-views.sql and can be read", async () => {
    await client.exec(readFileSync(path.resolve(__dirname, "..", "..", "..", "docs", "bi-views.sql"), "utf8"));
    for (const v of BI_VIEWS) {
      const r = await client.query(`select * from ${v.name} limit 1`);
      expect(r.fields.length, v.name).toBeGreaterThan(0);
    }
    const cols = (await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_name like 'bi\\_%'")).rows.map((r) => r.column_name);
    for (const secret of ["password_hash", "totp_secret", "email", "phone", "notes"]) expect(cols).not.toContain(secret);
  });
});

describe.skipIf(!ready)("capital scenarios", () => {
  it("saves, overwrites by name and deletes", async () => {
    const { saveScenarioAction, deleteScenarioAction } = await import("../../app/analytics/lifecycle/actions");
    await client.exec("insert into facilities (code, name) values ('TST', 'Test hospital')");
    const fac = (await client.query<{ id: number }>("select id from facilities where code = 'TST'")).rows[0].id;
    h.me.id = (await client.query<{ id: number }>("insert into users (name, email, role) values ('Tester', 'w40g@test.hpams', 'ADMIN') returning id")).rows[0].id;
    const fd = (o: Record<string, string>) => { const x = new FormData(); for (const [k, v] of Object.entries(o)) x.set(k, v); return x; };
    expect(await saveScenarioAction(null, fd({ facilityId: String(fac), name: "Cap", delayYears: "1", budgetPerYear: "5,000,000", includeTypes: "img" }))).toMatchObject({ ok: expect.any(String) });
    expect(await saveScenarioAction(null, fd({ facilityId: String(fac), name: "Cap", delayYears: "2", budgetPerYear: "", includeTypes: "" }))).toMatchObject({ ok: expect.any(String) });
    const rows = (await client.query<{ id: number; settings: unknown }>("select id, settings from capital_scenarios")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].settings).toEqual({ delayYears: 2, budgetPerYear: null, includeTypes: [] });
    expect(await saveScenarioAction(null, fd({ facilityId: String(fac), name: " " }))).toMatchObject({ error: expect.any(String) });
    expect(await deleteScenarioAction(null, fd({ id: String(rows[0].id) }))).toMatchObject({ ok: expect.any(String) });
    expect((await client.query("select 1 from capital_scenarios")).rows).toHaveLength(0);
  });
});
