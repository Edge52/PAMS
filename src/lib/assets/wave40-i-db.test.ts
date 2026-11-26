/**
 * Wave 40 (agent I) against in-memory PGlite with the real migrations: a device kept as found blocks repair work and
 * disposal until released; giving a job to someone not authorised records an override; a QC run is judged and saved.
 *
 * Skipped until the migration with the wave 40 tables exists in drizzle/ (the lead generates it at merge time).
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";

type Me = { id: number; name: string; email: string; role: string; jobTitle: string | null; allFacilities: boolean };
const h = vi.hoisted(() => ({ d: null as unknown as DB, me: { id: 1, name: "Admin", email: "a@t.hpams", role: "ADMIN", jobTitle: null, allFacilities: true } as Me }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/server-utils", () => ({ logActivity: async () => {}, nextNumber: async (p: string) => `${p}-T-${Math.random().toString(36).slice(2, 8)}` }));
vi.mock("@/lib/notifications", () => ({ notifyRole: async () => {}, notifyUsers: async () => 0, usersWithRole: async () => [] }));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/audit-diff", () => import("../audit-diff"));
vi.mock("@/lib/auth/permissions", () => import("../auth/permissions"));
vi.mock("@/lib/auth/departments", () => import("../auth/departments"));
vi.mock("@/lib/assets/forms", () => import("./forms"));
vi.mock("@/lib/assets/vigilance", () => import("./vigilance"));
vi.mock("@/lib/assets/vigilance-server", () => import("./vigilance-server"));
vi.mock("@/lib/assets/imaging-qc", () => import("./imaging-qc"));
vi.mock("@/lib/assets/imaging-qc-server", () => import("./imaging-qc-server"));
vi.mock("@/lib/assets/work-orders", () => import("./work-orders"));
vi.mock("@/lib/assets/work-order-server", () => ({ applyAssetEffect: async () => {}, coverForAsset: async () => ({ kind: "NONE" }), notifyAssigners: async () => 0 }));
vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("../auth/permissions");
  return {
    requirePermission: async (p: Parameters<typeof can>[1]) => { if (!can(h.me.role, p)) throw new Error(`forbidden:${p}`); return h.me; },
    requireFacilityAccess: async () => {}, facilityScope: async () => null,
  };
});

const client = new PGlite();
const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
h.d = d;
await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
const ready = (await client.query<{ t: string | null }>("select to_regclass('public.asset_quarantines')::text as t")).rows[0]?.t != null;

afterAll(async () => { await client.close(); });

const form = (o: Record<string, string | number | (string | number)[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, String(x));
  return f;
};

describe.skipIf(!ready)("wave 40 (I): kept as found, competency overrides, imaging QC", async () => {
  const vig = await import("../../app/assets/incidents/vigilance-actions");
  const qc = await import("../../app/assets/imaging-qc/actions");
  const vs = await import("./vigilance-server");
  const comp = await import("./competency-server");
  const { assets, deviceTypes, facilities, users, competencies, competencyOverrides, imagingQcRecords, imagingQcTemplates } = schema;
  let fac = 0, asset = 0, ct = 0, tech = 0;

  it("sets up", async () => {
    await d.insert(users).values({ id: 1, name: "Admin", email: "a@t.hpams", role: "ADMIN" }).onConflictDoNothing();
    // The admin's fixed id doesn't move the sequence: move it on so the next user gets a new id.
    await d.execute(sql`select setval('users_id_seq', (select max(id) from users))`);
    [{ id: tech }] = await d.insert(users).values({ name: "Tech", email: "t@t.hpams", role: "TECHNICIAN" }).returning({ id: users.id });
    [{ id: fac }] = await d.insert(facilities).values({ code: "W40I", name: "Wave 40 hospital" }).returning({ id: facilities.id });
    [{ id: ct }] = await d.insert(deviceTypes).values({ code: "IMG-CT-W40", level: 3, name: "CT scanner" }).returning({ id: deviceTypes.id });
    [{ id: asset }] = await d.insert(assets).values({ assetTag: "W40-CT-1", deviceTypeId: ct, facilityId: fac, status: "IN_SERVICE" }).returning({ id: assets.id });
  });

  it("keeps a device as found and releases it with a reason", async () => {
    expect((await vig.placeQuarantineAction(null, form({ assetId: asset, reason: "Patient burn", keptAt: "Store 2" })))?.ok).toMatch(/kept as found/);
    expect((await vig.placeQuarantineAction(null, form({ assetId: asset, reason: "Again" })))?.error).toMatch(/already/);
    const hold = await vs.quarantineFor(asset);
    expect(hold?.keptAt).toBe("Store 2");
    const [a] = await d.select({ status: assets.status }).from(assets).where(eq(assets.id, asset));
    expect(a.status).toBe("OUT_OF_SERVICE");
    expect((await vig.releaseQuarantineAction(null, form({ assetId: asset, releaseReason: "" })))?.error).toMatch(/Say why/);
    expect((await vig.releaseQuarantineAction(null, form({ assetId: asset, releaseReason: "Maker inspected it" })))?.ok).toMatch(/Released/);
    expect(await vs.quarantineFor(asset)).toBeNull();
  });

  it("records an override when the person is not authorised", async () => {
    const today = "2026-11-26";
    let c = await comp.assignmentCheck({ assetId: asset, facilityId: fac, userId: tech, userName: "Tech", today });
    expect(c.warning).toBe("Tech has no training record for CT scanner.");
    await d.transaction(async (tx) => { await c.record(tx as never, null, { id: 1, name: "Admin" }, "Only one on shift"); });
    const [o] = await d.select().from(competencyOverrides).where(eq(competencyOverrides.assetId, asset));
    expect(o).toMatchObject({ problem: "none", reason: "Only one on shift", userName: "Tech" });
    await d.insert(competencies).values({ userId: tech, deviceTypeId: ct, kind: "MAKER", trainedOn: "2026-01-01", authorised: true });
    c = await comp.assignmentCheck({ assetId: asset, facilityId: fac, userId: tech, userName: "Tech", today });
    expect(c.warning).toBeNull();
  });

  it("adds the example templates and judges a run", async () => {
    await expect(qc.addExampleTemplatesAction(null, form({ facilityId: fac }))).rejects.toThrow(/redirect:/);
    const [t] = await d.select().from(imagingQcTemplates).where(eq(imagingQcTemplates.name, "CT daily water phantom (example)"));
    expect(t.isExample).toBe(true);
    const answers: Record<string, string> = {};
    t.items.forEach((it, i) => { if (it.kind === "VALUE") answers[`v_${i}`] = it.label.startsWith("Water") ? "6" : "1"; else answers[`r_${i}`] = "PASS"; });
    await expect(qc.recordQcRunAction(null, form({ assetId: asset, templateId: t.id, performedOn: "2026-11-25", ...answers }))).rejects.toThrow(/QC%20failed/);
    const [r] = await d.select().from(imagingQcRecords).where(eq(imagingQcRecords.assetId, asset));
    expect(r).toMatchObject({ passed: false, failedCount: 1 });
  });
});
