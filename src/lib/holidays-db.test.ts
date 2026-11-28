/**
 * Wave 43 (agent Q): public holidays against in-memory PGlite with the real migrations — the Setup actions (add,
 * import, copy last year, move the older contract list) and the reads every working-day count uses.
 *
 * Skipped until the migration with the `holidays` table exists in drizzle/ (the lead generates it at merge time).
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema";
import type { DB } from "../db";

const h = vi.hoisted(() => ({ d: null as unknown as DB, scope: null as number[] | null, me: { id: 1, name: "Tester", email: "t@test.hpams", role: "ADMIN" as string, jobTitle: null, allFacilities: true } }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../db/schema"));
vi.mock("@/lib/server-utils", () => ({ logActivity: async () => {} }));
vi.mock("@/lib/format", () => import("./format"));
vi.mock("@/lib/assets/dates", () => import("./assets/dates"));
vi.mock("@/lib/holidays", () => import("./holidays"));
vi.mock("@/lib/imports/read-server", () => import("./imports/read-server"));
vi.mock("@/lib/procurement/forms", () => import("./procurement/forms"));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => h.me, requireUser: async () => h.me,
  requireFacilityAccess: async (id: number) => { if (h.scope && !h.scope.includes(id)) throw new Error("forbidden"); },
  facilityScope: async () => h.scope,
}));

const client = new PGlite();
const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
h.d = d;
await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "drizzle") });
const ready = (await client.query<{ t: string | null }>("select to_regclass('public.holidays')::text as t")).rows[0]?.t != null;

afterAll(async () => { await client.close(); });

const form = (o: Record<string, string | File>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

describe.skipIf(!ready)("public holidays (wave 43)", async () => {
  const a = await import("../app/admin/holidays/actions");
  const srv = await import("./holidays-server");
  const { facilities, holidays, publicHolidays } = schema;
  let f1 = 0, f2 = 0;

  it("sets up two hospitals", async () => {
    [{ id: f1 }, { id: f2 }] = await d.insert(facilities).values([{ code: "H1", name: "First Hospital" }, { code: "H2", name: "Second Hospital" }]).returning({ id: facilities.id });
  });

  it("adds a holiday for every hospital and one for a hospital, and renames on the same date", async () => {
    expect((await a.saveHolidayAction(null, form({ facilityId: "", day: "2026-10-06", name: "Armed Forces Day" })))?.message).toMatch(/saved/);
    expect((await a.saveHolidayAction(null, form({ facilityId: String(f2), day: "2026-11-01", name: "Hospital day" })))?.message).toMatch(/saved/);
    await a.saveHolidayAction(null, form({ facilityId: "", day: "2026-10-06", name: "Armed Forces Day (6 October)" }));
    const rows = await d.select().from(holidays);
    expect(rows.map((r) => [r.day, r.name, r.facilityId]).sort()).toEqual([["2026-10-06", "Armed Forces Day (6 October)", null], ["2026-11-01", "Hospital day", f2]]);
  });

  it("refuses a holiday for every hospital from an account limited to some", async () => {
    h.scope = [f1];
    expect((await a.saveHolidayAction(null, form({ facilityId: "", day: "2026-12-01", name: "X" })))?.errors?.[0]).toMatch(/limited/);
    h.scope = null;
  });

  it("imports a CSV, checking every row first", async () => {
    const bad = new File(["Date,Holiday,Hospital\n2026-12-24,Eve,Nowhere\n"], "h.csv", { type: "text/csv" });
    expect((await a.importHolidaysAction(null, form({ file: bad })))?.errors?.[0]).toMatch(/Row 2/);
    const good = new File(["Date,Holiday,Hospital,Moves each year\n2026-03-20,Eid al-Fitr,,Yes\n2026-07-23,Revolution Day,,\n2026-05-05,Local day,H1,No\n"], "h.csv", { type: "text/csv" });
    expect((await a.importHolidaysAction(null, form({ file: good })))?.message).toMatch(/3 holidays added/);
  });

  it("copies last year's fixed-date holidays only", async () => {
    expect((await a.copyLastYearAction(null, form({ year: "2026" })))?.message).toMatch(/4 holidays copied to 2027/);
    const y27 = (await d.select().from(holidays)).filter((r) => r.day.startsWith("2027")).map((r) => r.day).sort();
    expect(y27).toEqual(["2027-05-05", "2027-07-23", "2027-10-06", "2027-11-01"]);
    expect((await a.copyLastYearAction(null, form({ year: "2026" })))?.message).toMatch(/Nothing to copy/);
  });

  it("reads group-wide, own and older contract holidays for working-day counts", async () => {
    await d.insert(publicHolidays).values({ facilityId: f1, day: "2026-12-10", name: "Old contract day" });
    const one = await srv.holidayDates(f1, "2026-01-01", "2026-12-31");
    expect([...one].sort()).toEqual(["2026-03-20", "2026-05-05", "2026-07-23", "2026-10-06", "2026-12-10"]);
    expect([...(await srv.holidayDates(null, "2026-01-01", "2026-12-31"))].sort()).toEqual(["2026-03-20", "2026-07-23", "2026-10-06"]);
    const by = await srv.holidayDatesBy([f1, f2, null], "2026-01-01", "2026-12-31");
    expect(by(f2).has("2026-11-01") && !by(f2).has("2026-05-05") && !by(null).has("2026-11-01")).toBe(true);
  });

  it("moves the older contract list into the one list", async () => {
    expect((await a.moveOldHolidaysAction(null, form({})))?.message).toMatch(/1 holiday moved/);
    expect(await d.select().from(publicHolidays)).toEqual([]);
    expect((await d.select().from(holidays)).some((r) => r.day === "2026-12-10" && r.facilityId === f1)).toBe(true);
  });
});
