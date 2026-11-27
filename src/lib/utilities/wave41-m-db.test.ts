/**
 * Wave 41 (agent M): utility systems, tests and water samples against in-memory PGlite with the real migrations.
 * Skipped until the migration with the wave 41 tables exists in drizzle/ (the lead generates it at merge time).
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
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/assets/access", () => import("../assets/access"));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/assets/work-order-server", () => ({ applyAssetEffect: vi.fn(), coverForAsset: vi.fn(), notifyAssigners: vi.fn() }));
vi.mock("@/lib/assets/work-orders", () => ({ responseDue: () => new Date() }));
vi.mock("@/lib/assets/vigilance-server", () => ({ quarantineFor: async () => null }));
vi.mock("@/lib/server-utils", () => ({ logActivity: vi.fn(), nextNumber: vi.fn() }));

const client = new PGlite();
const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
h.d = d;
await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
const ready = (await client.query<{ t: string | null }>("select to_regclass('public.water_samples')::text as t")).rows[0]?.t != null;

afterAll(async () => { await client.close(); });

describe.skipIf(!ready)("wave 41 utilities and water tables", async () => {
  const { pointRows, utilityDue, utilityEvidence } = await import("./utilities-server");
  const { assets, deviceTypes, facilities, utilitySystems, utilityTests, waterPoints, waterSamples } = schema;
  let facilityId = 0, assetId = 0, systemId = 0;

  it("sets up", async () => {
    [{ id: facilityId }] = await d.insert(facilities).values({ code: "W41", name: "Wave 41 hospital", type: "GENERAL_HOSPITAL" }).returning({ id: facilities.id });
    const [{ id: typeId }] = await d.insert(deviceTypes).values({ code: "W41-GEN", level: 3, name: "Generator", criticality: "LIFE_SUPPORT" }).returning({ id: deviceTypes.id });
    [{ id: assetId }] = await d.insert(assets).values({ assetTag: "W41-GEN-1", deviceTypeId: typeId, facilityId, status: "IN_SERVICE" }).returning({ id: assets.id });
    [{ id: systemId }] = await d.insert(utilitySystems).values({ assetId, facilityId, kind: "GENERATOR", ratedKw: 400 }).returning({ id: utilitySystems.id });
  });

  it("keeps one system per device and checks its figures", async () => {
    await expect(d.insert(utilitySystems).values({ assetId, facilityId, kind: "UPS" })).rejects.toThrow();
    await expect(d.update(utilitySystems).set({ minFuelPct: 120 }).where(eq(utilitySystems.id, systemId))).rejects.toThrow();
    await expect(d.insert(utilityTests).values({ systemId, assetId, facilityId, kind: "FUEL", testedOn: "2026-11-01", fuelPct: -1, passed: false })).rejects.toThrow();
  });

  it("lists what is due from the latest test of each kind", async () => {
    await d.insert(utilityTests).values([
      { systemId, assetId, facilityId, kind: "GEN_NO_LOAD", testedOn: "2026-11-01", durationMin: 10, checksOk: true, passed: true },
      { systemId, assetId, facilityId, kind: "GEN_NO_LOAD", testedOn: "2026-11-25", durationMin: 10, checksOk: true, passed: true },
      { systemId, assetId, facilityId, kind: "GEN_LOAD", testedOn: "2026-10-01", loadKw: 50, durationMin: 30, transferSec: 8, checksOk: true, passed: false },
    ]);
    const { rows } = await utilityDue(null, facilityId, "2026-11-27");
    const by = Object.fromEntries(rows.map((r) => [r.test, r]));
    expect(by.GEN_NO_LOAD).toMatchObject({ state: "ok", lastOn: "2026-11-25" });
    expect(by.GEN_LOAD).toMatchObject({ state: "overdue", lastPassed: false });
    expect(by.FUEL.state).toBe("never");
  });

  it("keeps water points and samples, with the last result per point", async () => {
    const [{ id: pointId }] = await d.insert(waterPoints).values({ facilityId, name: "RO outlet", kind: "DIALYSIS_RO", tvcAction: 50, tvcLimit: 100 }).returning({ id: waterPoints.id });
    await expect(d.insert(waterPoints).values({ facilityId, name: "Bad", kind: "OTHER", everyDays: 0 })).rejects.toThrow();
    await d.insert(waterSamples).values([
      { pointId, facilityId, sampledOn: "2026-10-01", tvc: 10, level: "OK" },
      { pointId, facilityId, sampledOn: "2026-11-01", tvc: 140, level: "FAIL" },
    ]);
    await expect(d.insert(waterSamples).values({ pointId, facilityId, sampledOn: "2026-11-02", tvc: -5, level: "OK" })).rejects.toThrow();
    const [p] = await pointRows(null, facilityId);
    expect(p).toMatchObject({ lastOn: "2026-11-01", lastLevel: "FAIL" });
    const ev = await utilityEvidence(null, facilityId, "2026-01-01", "2026-11-27", "2026-11-27");
    expect(ev).toMatchObject({ systems: 1, generators: 1, generatorsBoth: 1, failedTests: 1, failedWithJob: 0, points: 1, dialysisPoints: 1, sampleFails: 1, sampleFailsWithJob: 0 });
  });
});
