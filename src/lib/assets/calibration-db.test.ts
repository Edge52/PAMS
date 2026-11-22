/**
 * Wave 37: a failed calibration takes the device out of service, a work order can't put it back, and a passing
 * calibration does. Runs the real server code against an in-memory PGlite database with the real migrations.
 *
 * Skipped until the migration with the wave 37 tables exists in drizzle/ (the lead generates it at merge time):
 * then it runs on its own, nothing to change here.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";

const h = vi.hoisted(() => ({ d: null as unknown as DB }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/status", () => import("../status"));
vi.mock("@/lib/server-utils", () => ({ logActivity: async () => {} }));
vi.mock("@/lib/auth/permissions", () => import("../auth/permissions"));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => ({ id: 1, name: "Tester", role: "ADMIN" }), requireFacilityAccess: async () => {}, facilityScope: async () => null,
}));
vi.mock("@/lib/notifications", () => ({ notifyUsers: async () => {}, usersWithRole: async () => [], notifyRole: async () => {} }));
vi.mock("@/lib/assets/forms", () => import("./forms"));
vi.mock("@/lib/assets/calibration", () => import("./calibration"));
vi.mock("@/lib/assets/calibration-server", () => import("./calibration-server"));
vi.mock("@/lib/assets/work-order-server", () => import("./work-order-server"));
vi.mock("@/lib/procurement/forms", () => import("../procurement/forms"));

const client = new PGlite();
const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
h.d = d;
await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
const ready = (await client.query<{ t: string | null }>("select to_regclass('public.calibrations')::text as t")).rows[0]?.t != null;

afterAll(async () => { await client.close(); });

const form = (o: Record<string, string | number>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, String(v)); return f; };

describe.skipIf(!ready)("calibration and the device's status", async () => {
  const { assets, calibrations, deviceTypes, facilities, maintenanceEvents, workOrders, deviceTypeCalibration } = schema;
  const { recordCalibrationAction } = await import("../../app/assets/calibration/actions");
  const { applyAssetEffect } = await import("./work-order-server");
  const { calibrationHeld, calibrationDevices } = await import("./calibration-server");
  const statusOf = async (id: number) => (await d.select({ s: assets.status }).from(assets).where(eq(assets.id, id)))[0].s;
  const record = (assetId: number, result: string, calibratedOn: string) =>
    expect(recordCalibrationAction(null, form({ assetId, result, calibratedOn, performedBy: "Lab" }))).rejects.toThrow(/^redirect:\/assets\/calibration\//);

  it("fails, holds, then passes", async () => {
    await d.insert(schema.users).values({ id: 1, name: "Tester", email: "tester@test.hpams", role: "ADMIN" }).onConflictDoNothing();
    const [f] = await d.insert(facilities).values({ code: "CAL", name: "Calibration hospital" }).returning();
    const [t] = await d.insert(deviceTypes).values({ code: "LIF-DEF-TEST", level: 3, name: "Test defibrillator", requiresCalibration: true }).returning({ id: deviceTypes.id });
    await d.insert(deviceTypeCalibration).values({ deviceTypeId: t.id, intervalMonths: 6 });
    const [a] = await d.insert(assets).values({ assetTag: "CAL-1", deviceTypeId: t.id, facilityId: f.id, status: "IN_SERVICE" }).returning({ id: assets.id });

    await record(a.id, "FAIL", "2026-10-01");
    expect(await statusOf(a.id)).toBe("OUT_OF_SERVICE");
    expect(await calibrationHeld(a.id)).toBe(true);
    const [ev] = await d.select().from(maintenanceEvents).where(eq(maintenanceEvents.assetId, a.id));
    expect(ev).toMatchObject({ type: "CALIBRATION", status: "COMPLETED", completedDate: "2026-10-01" });

    // A repair job finished with "back in service" leaves it out while the calibration hold stands.
    const [w] = await d.insert(workOrders).values({ number: "WO-CAL-1", assetId: a.id, facilityId: f.id, status: "COMPLETED", title: "Repair", deviceDown: true }).returning();
    expect(await applyAssetEffect("complete", w, { returnToService: true, actor: "Tester", calibrationHeld: await calibrationHeld(a.id) })).toBeNull();
    expect(await statusOf(a.id)).toBe("OUT_OF_SERVICE");

    await record(a.id, "ADJUSTED", "2026-10-05");
    expect(await statusOf(a.id)).toBe("IN_SERVICE");
    const [last] = await d.select().from(calibrations).where(eq(calibrations.assetId, a.id)).orderBy(calibrations.id).offset(1);
    expect(last).toMatchObject({ result: "ADJUSTED", intervalMonths: 6, nextDue: "2027-04-05" });
    const [dev] = await calibrationDevices(null, "2026-11-22", { assetIds: [a.id] });
    expect(dev).toMatchObject({ months: 6, intervalSource: "type", state: "ok" });
  });

  it("refuses a date before the last calibration", async () => {
    const [a] = await d.select({ id: assets.id }).from(assets).where(eq(assets.assetTag, "CAL-1"));
    const r = await recordCalibrationAction(null, form({ assetId: a.id, result: "PASS", calibratedOn: "2026-09-01", performedBy: "Lab" }));
    expect(r?.errors?.[0]).toMatch(/in order/);
  });
});
