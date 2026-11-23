/**
 * Wave 38 (agent M): exam count import replaces a device's day and fills imaging use; a tube replacement closes the
 * old tube; the cryogen log refuses bad readings; covered hours save. Real server code against in-memory PGlite with
 * the real migrations.
 *
 * Skipped until the migration with the wave 38 tables exists in drizzle/ (the lead generates it at merge time).
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
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
vi.mock("@/lib/server-utils", () => ({ logActivity: async () => {} }));
vi.mock("@/lib/audit-diff", () => import("../audit-diff"));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => ({ id: 1, name: "Tester", role: "ADMIN" }), requireFacilityAccess: async () => {}, facilityScope: async () => null,
}));
vi.mock("@/lib/procurement/forms", () => import("../procurement/forms"));
vi.mock("@/lib/assets/exam-import", () => import("./exam-import"));
vi.mock("@/lib/assets/exam-counts-server", () => import("./exam-counts-server"));
vi.mock("@/lib/assets/tubes", () => import("./tubes"));
vi.mock("@/lib/assets/cryogen", () => import("./cryogen"));
vi.mock("@/lib/assets/coverage", () => import("./coverage"));
vi.mock("@/lib/assets/dates", () => import("./dates"));

const client = new PGlite();
const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
h.d = d;
await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
const ready = (await client.query<{ t: string | null }>("select to_regclass('public.exam_counts')::text as t")).rows[0]?.t != null;

afterAll(async () => { await client.close(); });

const form = (o: Record<string, string | number | File>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v instanceof File ? v : String(v)); return f; };

describe.skipIf(!ready)("wave 38 imaging records", async () => {
  const { assets, deviceTypes, facilities, examCounts, imagingUsage, xrayTubes, tubeReadings, cryogenReadings, contractCoverage, serviceContracts, suppliers } = schema;
  const imp = await import("../../app/assets/imaging/import/actions");
  const tubes = await import("../../app/assets/tubes/actions");
  const cryo = await import("../../app/assets/cryogen/actions");
  const cov = await import("../../app/assets/contracts/coverage-actions");
  let ct = 0, mr = 0, fac = 0;

  it("sets up", async () => {
    await d.insert(schema.users).values({ id: 1, name: "Tester", email: "tester@test.hpams", role: "ADMIN" }).onConflictDoNothing();
    const [f] = await d.insert(facilities).values({ code: "W38", name: "Wave 38 hospital" }).returning();
    fac = f.id;
    const [tc] = await d.insert(deviceTypes).values({ code: "IMG-CT-W38", level: 3, name: "CT test" }).returning({ id: deviceTypes.id });
    const [tm] = await d.insert(deviceTypes).values({ code: "IMG-MRI-W38", level: 3, name: "MRI test" }).returning({ id: deviceTypes.id });
    ct = (await d.insert(assets).values({ assetTag: "W38-CT-1", deviceTypeId: tc.id, facilityId: f.id, status: "IN_SERVICE" }).returning({ id: assets.id }))[0].id;
    mr = (await d.insert(assets).values({ assetTag: "W38-MR-1", deviceTypeId: tm.id, facilityId: f.id, status: "IN_SERVICE" }).returning({ id: assets.id }))[0].id;
    expect((await imp.addAeTitleAction(null, form({ assetId: ct, aeTitle: "ct_w38" })))?.message).toMatch(/added/);
    expect((await imp.addAeTitleAction(null, form({ assetId: mr, aeTitle: "CT_W38" })))?.errors?.[0]).toMatch(/already belongs to W38-CT-1/);
  });

  it("previews, saves, and replaces a re-imported day", async () => {
    const csv = (body: string) => new File([`AE title,Date,Exams,Procedure\n${body}`], "ris.csv", { type: "text/csv" });
    const pv = await imp.previewExamImportAction(null, form({ file: csv("CT_W38,2026-10-01,20,Head\nCT_W38,2026-10-01,5,Chest\nCT_W38,2026-10-02,7,\nNOPE,2026-10-02,1,") }));
    expect(pv).toMatchObject({ validCount: 3, errorCount: 1, days: 2 });
    expect((await imp.commitExamImportAction(null, form({ payload: pv!.payload! })))?.done).toMatch(/2 device-days/);
    const month = async () => (await d.select().from(imagingUsage).where(and(eq(imagingUsage.assetId, ct), eq(imagingUsage.month, "2026-10-01"))))[0]?.exams;
    expect(await month()).toBe(32);
    // A corrected export for 1 Oct replaces both of that day's rows; 2 Oct is kept.
    const pv2 = await imp.previewExamImportAction(null, form({ file: csv("W38-CT-1,01/10/2026,30,") }));
    await imp.commitExamImportAction(null, form({ payload: pv2!.payload! }));
    expect((await d.select().from(examCounts).where(eq(examCounts.assetId, ct))).map((r) => [r.day, r.exams]).sort()).toEqual([["2026-10-01", 30], ["2026-10-02", 7]]);
    expect(await month()).toBe(37);
    expect((await imp.commitExamImportAction(null, form({ payload: JSON.stringify({ fileName: "x", valid: [{ assetId: 999, tag: "X", day: "2026-10-01", procedure: "", modality: null, exams: 1 }] }) })))?.error).toMatch(/no longer/);
  });

  it("fits and replaces a tube", async () => {
    const fit = (o: Record<string, string | number>) => tubes.fitTubeAction(null, form({ assetId: ct, counterUnit: "scan_seconds", ...o }));
    expect((await fit({ serialNumber: "T1", installedOn: "2025-01-01" }))?.errors?.[0]).toMatch(/warranty or the expected life/);
    expect((await fit({ serialNumber: "T1", installedOn: "2025-01-01", warrantyMonths: 12, expectedLife: 300000 }))?.message).toMatch(/recorded/);
    const [t1] = await d.select().from(xrayTubes).where(eq(xrayTubes.assetId, ct));
    expect((await tubes.recordTubeReadingAction(null, form({ tubeId: t1.id, readOn: "2025-06-01", counter: 90000 })))?.message).toMatch(/saved/);
    expect((await tubes.recordTubeReadingAction(null, form({ tubeId: t1.id, readOn: "2025-07-01", counter: 80000 })))?.errors?.[0]).toMatch(/backwards/);
    expect((await fit({ serialNumber: "T2", installedOn: "2026-02-01", warrantyMonths: 12, expectedLife: 300000, counterAtInstall: 250000, oldCounter: 250000, removedReason: "Arcing", cost: 2000000 }))?.message).toMatch(/fitted/);
    const all = await d.select().from(xrayTubes).where(eq(xrayTubes.assetId, ct)).orderBy(xrayTubes.id);
    expect(all.map((t) => [t.serialNumber, t.removedOn, t.removedReason])).toEqual([["T1", "2026-02-01", "Arcing"], ["T2", null, null]]);
    expect((await d.select().from(tubeReadings).where(eq(tubeReadings.tubeId, t1.id))).map((r) => r.counter)).toEqual([90000, 250000]);
    expect((await tubes.fitTubeAction(null, form({ assetId: mr, counterUnit: "exposures", serialNumber: "X", installedOn: "2026-01-01", warrantyMonths: 12 })))?.errors?.[0]).toMatch(/CT, X-ray/);
  });

  it("records helium readings and refuses bad ones", async () => {
    expect((await cryo.recordCryoReadingAction(null, form({ assetId: mr, readOn: "2026-11-01", heliumPct: 120 })))?.fields?.heliumPct).toMatch(/0 and 100/);
    expect((await cryo.recordCryoReadingAction(null, form({ assetId: ct, readOn: "2026-11-01", heliumPct: 80 })))?.fields?.assetId).toBeDefined();
    expect((await cryo.recordCryoReadingAction(null, form({ assetId: mr, readOn: "2026-11-01", heliumPct: 80.5, coldHead: "RUNNING", compressor: "RUNNING", chillerTempC: 17 })))?.message).toMatch(/saved/);
    const [r] = await d.select().from(cryogenReadings).where(eq(cryogenReadings.assetId, mr));
    expect(r).toMatchObject({ heliumPct: 80.5, readBy: "Tester", coldHead: "RUNNING" });
    expect((await cryo.saveMagnetSettingsAction(null, form({ assetId: mr, cryogenic: "on", heliumMinPct: 65, maxDropPct: 3, dropWindowDays: 30, maxGapDays: 3 })))?.message).toMatch(/saved/);
  });

  it("saves covered hours", async () => {
    const [s] = await d.insert(suppliers).values({ name: "W38 service" }).returning({ id: suppliers.id });
    const [c] = await d.insert(serviceContracts).values({ number: "SC-W38-1", facilityId: fac, supplierId: s.id, title: "CT service", startDate: "2026-01-01", endDate: "2026-12-31" }).returning({ id: serviceContracts.id });
    const f = form({ contractId: c.id, fromTime: "08:00", toTime: "20:00", excludeHolidays: "on" });
    for (const day of ["0", "1", "2", "3", "4"]) f.append("day", day);
    expect((await cov.saveCoverageAction(null, f))?.message).toBe("Covered hours saved: Sun–Thu 08:00–20:00, not on public holidays.");
    expect((await d.select().from(contractCoverage).where(eq(contractCoverage.contractId, c.id)))[0]).toMatchObject({ days: [0, 1, 2, 3, 4], allHours: false });
    expect((await cov.saveCoverageAction(null, form({ contractId: c.id, fromTime: "08:00", toTime: "20:00" })))?.fields?.day).toMatch(/at least one/);
  });
});
