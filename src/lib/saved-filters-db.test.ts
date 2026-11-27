/**
 * Wave 41 (agent K): saved filters against in-memory PGlite with the real migrations. Skipped until the migration
 * with `saved_filters` exists in drizzle/ (the lead generates it at merge time).
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema";
import type { DB } from "../db";

const h = vi.hoisted(() => ({ d: null as unknown as DB, me: { id: 1, name: "Ana", email: "a@test.hpams", role: "BIOMEDICAL" as string, jobTitle: null, allFacilities: true } }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../db/schema"));
vi.mock("./server-utils", () => ({ logActivity: async () => {} }));
vi.mock("./auth/session", () => ({ requirePermission: async () => h.me, requireUser: async () => h.me, getCurrentUser: async () => h.me }));

const client = new PGlite();
const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
h.d = d;
await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "drizzle") });
const ready = (await client.query<{ t: string | null }>("select to_regclass('public.saved_filters')::text as t")).rows[0]?.t != null;

afterAll(async () => { await client.close(); });

describe.skipIf(!ready)("saved filters on the server (wave 41)", async () => {
  const act = await import("./saved-filters-actions");
  const { listSavedFilters } = await import("./saved-filters-server");
  const { users } = schema;
  const ana = { id: 1, role: "BIOMEDICAL" as const }, ben = { id: 2, role: "BIOMEDICAL" as const }, tom = { id: 3, role: "TECHNICIAN" as const };

  it("sets up", async () => {
    await d.insert(users).values([
      { id: 1, name: "Ana", email: "a@test.hpams", role: "BIOMEDICAL" }, { id: 2, name: "Ben", email: "b@test.hpams", role: "BIOMEDICAL" },
      { id: 3, name: "Tom", email: "t@test.hpams", role: "TECHNICIAN" },
    ]).onConflictDoNothing();
  });

  it("saves, replaces by name and lists", async () => {
    const r = await act.saveFilterAction({ page: "work-orders", path: "/assets/work-orders", name: "Urgent", query: "priority=URGENT&page=2" });
    expect(r.ok).toMatch(/Saved/);
    expect(r.list?.map((s) => [s.name, s.query])).toEqual([["Urgent", "priority=URGENT"]]);
    await act.saveFilterAction({ page: "work-orders", path: "/assets/work-orders", name: "Urgent", query: "priority=HIGH" });
    expect((await listSavedFilters(ana, "work-orders")).map((s) => s.query)).toEqual(["priority=HIGH"]);
  });

  it("refuses bad input", async () => {
    expect((await act.saveFilterAction({ page: "nope", path: "/x", name: "A", query: "a=1" })).error).toBeTruthy();
    expect((await act.saveFilterAction({ page: "assets", path: "/admin/users", name: "A", query: "a=1" })).error).toMatch(/no saved filters/);
    expect((await act.saveFilterAction({ page: "assets", path: "/assets", name: " ", query: "a=1" })).error).toMatch(/name/);
    expect((await act.saveFilterAction({ page: "assets", path: "/assets", name: "Empty", query: "page=2" })).error).toMatch(/filter first/);
  });

  it("shares with the role only", async () => {
    await act.saveFilterAction({ page: "work-orders", path: "/assets/work-orders", name: "ICU", query: "dept=4", share: true });
    expect((await listSavedFilters(ben, "work-orders")).map((s) => [s.name, s.mine, s.owner])).toEqual([["ICU", false, "Ana"]]);
    expect(await listSavedFilters(tom, "work-orders")).toEqual([]);
  });

  it("removes only your own", async () => {
    const [icu] = (await listSavedFilters(ana, "work-orders")).filter((s) => s.name === "ICU");
    h.me = { ...h.me, id: 2, name: "Ben" };
    expect((await act.deleteFilterAction({ page: "work-orders", id: icu.id })).error).toMatch(/own/);
    h.me = { ...h.me, id: 1, name: "Ana" };
    expect((await act.deleteFilterAction({ page: "work-orders", id: icu.id })).ok).toMatch(/Removed/);
    expect((await listSavedFilters(ben, "work-orders"))).toEqual([]);
  });
});
