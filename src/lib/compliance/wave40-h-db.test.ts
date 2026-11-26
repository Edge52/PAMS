/**
 * Wave 40 (agent H): critical device backups and equipment plans against in-memory PGlite with the real migrations.
 * Skipped until the migration with the wave 40 tables exists in drizzle/ (the lead generates it at merge time).
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";

const h = vi.hoisted(() => ({ d: null as unknown as DB }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/assets/access", () => import("../assets/access"));

const client = new PGlite();
const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
h.d = d;
await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
const ready = (await client.query<{ t: string | null }>("select to_regclass('public.critical_backups')::text as t")).rows[0]?.t != null;

afterAll(async () => { await client.close(); });

describe.skipIf(!ready)("wave 40 GAHAR tables", async () => {
  const { backupRows } = await import("./critical-backup-server");
  const { assets, criticalBackups, departments, deviceTypes, equipmentPlans, facilities } = schema;
  let facilityId = 0, departmentId = 0, typeId = 0;

  it("sets up", async () => {
    [{ id: facilityId }] = await d.insert(facilities).values({ code: "W40", name: "Wave 40 hospital", type: "GENERAL" } as never).returning({ id: facilities.id });
    [{ id: departmentId }] = await d.insert(departments).values({ facilityId, code: "ICU", name: "ICU" } as never).returning({ id: departments.id });
    [{ id: typeId }] = await d.insert(deviceTypes).values({ code: "W40-VENT", level: 3, name: "Ventilator", criticality: "LIFE_SUPPORT" }).returning({ id: deviceTypes.id });
    await d.insert(assets).values(["IN_SERVICE", "IN_SERVICE", "OUT_OF_SERVICE"].map((status, i) => ({ assetTag: `W40-${i}`, deviceTypeId: typeId, facilityId, departmentId, status: status as never })));
  });

  it("shows a department with no working backup left", async () => {
    await d.insert(criticalBackups).values({ facilityId, departmentId, deviceTypeId: typeId, inUseCount: 2, backupCount: 1 });
    const [r] = await backupRows(null, facilityId);
    expect(r).toMatchObject({ working: 2, required: 3, short: 1, state: "none_left", criticality: "LIFE_SUPPORT", typeName: "Ventilator" });
  });

  it("refuses a second setting for the same department and type, and negative counts", async () => {
    await expect(d.insert(criticalBackups).values({ facilityId, departmentId, deviceTypeId: typeId, inUseCount: 1, backupCount: 1 })).rejects.toThrow();
    await expect(d.insert(criticalBackups).values({ facilityId, departmentId, deviceTypeId: typeId, inUseCount: -1, backupCount: 1 })).rejects.toThrow();
  });

  it("keeps one plan per hospital, year and version", async () => {
    const plan = { facilityId, year: 2026, version: 1, scope: "All", riskMethod: "Score", maintenanceStrategy: "PPM" };
    await d.insert(equipmentPlans).values(plan);
    await expect(d.insert(equipmentPlans).values(plan)).rejects.toThrow();
    await expect(d.insert(equipmentPlans).values({ ...plan, version: 0 })).rejects.toThrow();
  });
});
