/**
 * Wave 43 (agent R): patient dose against DRLs on in-memory PGlite with the real migrations — monthly medians,
 * the physicist's review and the GAHAR DAS.09 summary.
 *
 * Skipped until the migration with the wave 43 dose tables exists in drizzle/ (the lead generates it at merge time).
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
vi.mock("@/lib/notifications/prefs-server", () => ({ isMissingTable: (e: { code?: string; cause?: { code?: string } }) => (e?.code ?? e?.cause?.code) === "42P01" }));

const client = new PGlite();
const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
h.d = d;
await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
const ready = (await client.query<{ t: string | null }>("select to_regclass('public.dose_records')::text as t")).rows[0]?.t != null;

afterAll(async () => { await client.close(); });

describe.skipIf(!ready)("patient dose (wave 43)", async () => {
  const srv = await import("./patient-dose-server");
  const { reviewKey } = await import("./patient-dose");
  const { assets, deviceTypes, doseRecords, doseReferenceLevels, doseReviews, facilities } = schema;
  let facilityId = 0, assetId = 0;

  it("sets up a CT scanner", async () => {
    [{ id: facilityId }] = await d.insert(facilities).values({ code: "DOS", name: "Dose Hospital" } as never).returning({ id: facilities.id });
    const [t] = await d.insert(deviceTypes).values({ code: "IMG-CT-64", name: "CT 64 slice", level: 3 } as never).onConflictDoNothing().returning({ id: deviceTypes.id });
    const typeId = t?.id ?? (await d.select({ id: deviceTypes.id }).from(deviceTypes)).find(() => true)!.id;
    [{ id: assetId }] = await d.insert(assets).values({ assetTag: "DOS-CT-000001", facilityId, deviceTypeId: typeId, status: "IN_SERVICE" } as never).returning({ id: assets.id });
    expect((await srv.doseScanners(null, facilityId)).map((s) => s.modality)).toEqual(["CT"]);
  });

  it("compares the month's median with the DRL and counts the review", async () => {
    await d.insert(doseReferenceLevels).values({ facilityId, modality: "CT", examType: "CT head", ageGroup: "ADULT", quantity: "ctdivol", value: 60, source: "Local survey", sourceYear: 2026 });
    await d.insert(doseRecords).values([50, 70, 72].map((v) => ({ facilityId, assetId, examDate: "2026-10-05", modality: "CT", examType: "CT Head", ageGroup: "ADULT", ctdivol: v })));
    const { checks } = await srv.doseChecks([facilityId], "2026-10", "2026-10");
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ n: 3, state: "above", medians: { ctdivol: 70 } });
    let ev = await srv.patientDoseEvidence([facilityId], "2026-11-15");
    expect(ev).toMatchObject({ compared: 1, ok: 0, above: 1, drls: 1, anyRecords: true });
    await d.insert(doseReviews).values({ facilityId, assetId, modality: "CT", examKey: checks[0].key, examType: "CT Head", ageGroup: "ADULT", month: "2026-10", findings: "Wrong protocol", action: "Protocol changed", reviewedOn: "2026-11-02", reviewedByName: "Physicist" });
    const again = await srv.doseChecks([facilityId], "2026-10", "2026-10");
    expect(again.reviews.has(reviewKey(checks[0]))).toBe(true);
    ev = await srv.patientDoseEvidence([facilityId], "2026-11-15");
    expect(ev?.ok).toBe(1);
  });

  it("finds the scanner by tag for the import", async () => {
    expect((await srv.doseLookups([facilityId])).scanners.get("dos-ct-000001")).toMatchObject({ assetId, modality: "CT" });
    expect((await srv.doseLookups([])).scanners.size).toBe(0);
  });
});
