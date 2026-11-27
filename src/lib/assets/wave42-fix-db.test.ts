/**
 * Wave 42 review fixes against in-memory PGlite with the real migrations:
 * - the same offline change synced twice at once is applied once (stock moves once, one note);
 * - a phone's complete that fails leaves an unstarted job unstarted, and the resend then works;
 * - bulk restore of documents keeps to the person's hospitals, as bulk remove does;
 * - the director decides an equipment request before the department head only with a reason.
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
const h = vi.hoisted(() => ({
  d: null as unknown as DB, me: { id: 1, name: "Admin", email: "a@t.hpams", role: "ADMIN", jobTitle: null, allFacilities: true } as Me,
  scope: null as number[] | null, log: [] as { type: string; id: number; action: string }[],
  session: async () => {
    const { can } = await import("../auth/permissions");
    return {
      requirePermission: async (p: Parameters<typeof can>[1]) => { if (!can(h.me.role, p)) throw new Error(`forbidden:${p}`); return h.me; },
      requireUser: async () => h.me, getCurrentUser: async () => h.me,
      requireFacilityAccess: async (f: number | null | undefined) => { if (f != null && h.scope && !h.scope.includes(f)) throw new Error("redirect:/forbidden"); },
      facilityScope: async () => h.scope,
    };
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/server-utils", () => ({
  logActivity: async (type: string, id: number, action: string) => { h.log.push({ type, id, action }); },
  nextNumber: async (p: string) => `${p}-T-${Math.random().toString(36).slice(2, 8)}`, convert: async (n: number) => n,
}));
vi.mock("@/lib/notifications", () => ({ notifyRole: async () => {}, notifyUsers: async () => 0, usersWithRole: async () => [] }));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/status", () => import("../status"));
vi.mock("@/lib/bulk", () => import("../bulk"));
vi.mock("@/lib/documents-access", () => import("../documents-access"));
vi.mock("@/lib/auth/permissions", () => import("../auth/permissions"));
vi.mock("@/lib/auth/departments", () => ({ myDepartments: async () => new Set<number>() }));
vi.mock("@/lib/auth/session", () => h.session());
vi.mock("../auth/session", () => h.session());
vi.mock("@/lib/assets/forms", () => import("./forms"));
vi.mock("@/lib/assets/offline-jobs", () => import("./offline-jobs"));
vi.mock("@/lib/assets/my-jobs-server", () => import("./my-jobs-server"));
vi.mock("@/lib/assets/work-order-steps-server", () => import("./work-order-steps-server"));
vi.mock("@/lib/assets/request-rules", () => import("./request-rules"));
vi.mock("@/lib/assets/request-rules-server", () => import("./request-rules-server"));
vi.mock("./work-order-server", () => ({ applyAssetEffect: async () => {}, coverForAsset: async () => ({ kind: "NONE" }), notifyAssigners: async () => 0 }));
vi.mock("@/lib/boq/generate", () => ({ defaultUnitPrices: async () => new Map() }));
vi.mock("@/lib/boq/replacement-set", () => ({ replacementSetId: async () => 1 }));
vi.mock("@/lib/procurement/budget-year-server", () => ({ budgetYear: async () => ({ current: 2026, label: (y: number) => `${y}/${y + 1}` }) }));

const client = new PGlite();
const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
h.d = d;
await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });

afterAll(async () => { await client.close(); });

const form = (o: Record<string, string | number | (string | number)[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, String(x));
  return f;
};
const redirectOf = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e) { return decodeURIComponent((e as Error).message); } };

describe("wave 42 review fixes", async () => {
  const sync = (await import("../../app/assets/my-jobs/actions")).syncMyJobsAction;
  const docs = await import("../../app/admin/documents/bulk-actions");
  const req = await import("../../app/assets/requests/actions");
  const { jobVersion } = await import("./offline-jobs");
  const { assets, deviceTypes, departments, documents, equipmentRequests, facilities, offlineSyncLog, spareParts, userDepartments, users, workOrders } = schema;
  let fac = 0, fac2 = 0, asset = 0, asset2 = 0, type = 0, tech = 0, head = 0, dept = 0, part = 0;
  const techMe = (): Me => ({ id: tech, name: "Tech", email: "t@t.hpams", role: "TECHNICIAN", jobTitle: null, allFacilities: true });
  const job = async (status: "ASSIGNED" | "IN_PROGRESS", extra: Partial<typeof workOrders.$inferInsert> = {}) =>
    (await d.insert(workOrders).values({ number: `WO-T-${Math.random().toString(36).slice(2, 8)}`, assetId: asset, facilityId: fac, status, title: "Job", assignedToId: tech, ...extra }).returning())[0];

  it("sets up", async () => {
    await d.insert(users).values({ id: 1, name: "Admin", email: "a@t.hpams", role: "ADMIN" }).onConflictDoNothing();
    await d.execute(sql`select setval('users_id_seq', (select max(id) from users))`);
    [{ id: tech }] = await d.insert(users).values({ name: "Tech", email: "t@t.hpams", role: "TECHNICIAN" }).returning({ id: users.id });
    [{ id: head }] = await d.insert(users).values({ name: "Head", email: "h@t.hpams", role: "DEPARTMENT_HEAD" }).returning({ id: users.id });
    [{ id: fac }] = await d.insert(facilities).values({ code: "W42", name: "Wave 42 hospital" }).returning({ id: facilities.id });
    [{ id: fac2 }] = await d.insert(facilities).values({ code: "W42B", name: "Other hospital" }).returning({ id: facilities.id });
    [{ id: type }] = await d.insert(deviceTypes).values({ code: "MON-W42", level: 3, name: "Monitor" }).returning({ id: deviceTypes.id });
    [{ id: asset }] = await d.insert(assets).values({ assetTag: "W42-MON-1", deviceTypeId: type, facilityId: fac, status: "IN_SERVICE" }).returning({ id: assets.id });
    [{ id: asset2 }] = await d.insert(assets).values({ assetTag: "W42-MON-2", deviceTypeId: type, facilityId: fac2, status: "IN_SERVICE" }).returning({ id: assets.id });
    [{ id: part }] = await d.insert(spareParts).values({ facilityId: fac, partNumber: "W42-FUSE", name: "Fuse", stockQty: 5 }).returning({ id: spareParts.id });
    [{ id: dept }] = await d.insert(departments).values({ facilityId: fac, code: "ICU", name: "ICU" }).returning({ id: departments.id });
    await d.insert(userDepartments).values({ userId: head, departmentId: dept });
  });

  it("applies the same change once when two syncs send it at the same time", async () => {
    h.me = techMe(); h.scope = null;
    const wo = await job("IN_PROGRESS");
    const base = { jobId: wo.id, baseVersion: jobVersion(wo) };
    const partChange = { ...base, key: "part-key-0001", kind: "part" as const, partId: part, quantity: 1 };
    const noteChange = { ...base, key: "note-key-0001", kind: "note" as const, note: "Fan noisy" };
    const [a, b] = await Promise.all([sync([partChange, noteChange]), sync([partChange, noteChange])]);
    const results = [a, b].flatMap((r) => ("results" in r ? r.results : []));
    expect(results.every((r) => r.outcome === "synced")).toBe(true);
    expect(results.filter((r) => r.message === "Already saved.")).toHaveLength(2);
    const [p] = await d.select({ stock: spareParts.stockQty }).from(spareParts).where(eq(spareParts.id, part));
    expect(p.stock).toBe(4);
    expect(h.log.filter((l) => l.id === wo.id && l.action === "note")).toHaveLength(1);
    expect(h.log.filter((l) => l.id === wo.id && l.action === "part_used")).toHaveLength(1);
    expect(await d.select().from(offlineSyncLog).where(eq(offlineSyncLog.workOrderId, wo.id))).toHaveLength(2);
  });

  it("leaves an unstarted job unstarted when the phone's complete fails, and the resend works", async () => {
    h.me = techMe(); h.scope = null;
    const wo = await job("ASSIGNED", { type: "PPM", checklist: [{ text: "Visual check", result: null }] });
    const change = { key: "done-key-0001", jobId: wo.id, kind: "complete" as const, baseVersion: jobVersion(wo), complete: { returnToService: false, checklist: [{}] } };
    const first = await sync([change]);
    expect("results" in first && first.results[0]).toMatchObject({ outcome: "conflict", message: expect.stringMatching(/Finish the checklist/) });
    const [still] = await d.select().from(workOrders).where(eq(workOrders.id, wo.id));
    expect(still.status).toBe("ASSIGNED");
    expect(still.startedAt).toBeNull();
    expect(await d.select().from(offlineSyncLog).where(eq(offlineSyncLog.key, "done-key-0001"))).toHaveLength(0);
    // The technician fixes the checklist and sends again on the same base version: no conflict with their own start.
    const again = await sync([{ ...change, complete: { returnToService: false, checklist: [{ result: "PASS" as const }] } }]);
    expect("results" in again && again.results[0].outcome).toBe("synced");
    const [done] = await d.select().from(workOrders).where(eq(workOrders.id, wo.id));
    expect(done.status).toBe("COMPLETED");
    expect(done.startedAt).not.toBeNull();
  });

  it("restores documents only on records in the person's hospitals", async () => {
    h.me = { id: 1, name: "Admin", email: "a@t.hpams", role: "ADMIN", jobTitle: null, allFacilities: false };
    h.scope = [fac];
    const gone = new Date();
    const [mine, other] = await d.insert(documents).values([
      { entityType: "asset", entityId: asset, fileName: "mine.pdf", url: "/files/x/1", deletedAt: gone },
      { entityType: "asset", entityId: asset2, fileName: "other.pdf", url: "/files/x/2", deletedAt: gone },
    ]).returning({ id: documents.id });
    const msg = await redirectOf(docs.bulkRestoreDocumentsAction(form({ ids: [mine.id, other.id] })));
    expect(msg).toMatch(/1 document restored/);
    expect(msg).toMatch(/Left alone: other\.pdf/);
    const rows = await d.select({ id: documents.id, deletedAt: documents.deletedAt }).from(documents).where(sql`${documents.id} in (${mine.id}, ${other.id})`);
    expect(rows.find((r) => r.id === mine.id)?.deletedAt).toBeNull();
    expect(rows.find((r) => r.id === other.id)?.deletedAt).not.toBeNull();
    h.scope = null;
  });

  it("needs a reason for the director to decide before the department head", async () => {
    h.me = { id: 1, name: "Admin", email: "a@t.hpams", role: "ADMIN", jobTitle: null, allFacilities: true };
    const [r] = await d.insert(equipmentRequests).values({ number: "REQ-T-1", facilityId: fac, departmentId: dept, deviceTypeId: type, reason: "Old monitors fail weekly" }).returning();
    const no = await req.decideRequestAction(null, form({ requestId: r.id, decision: "approve", planYear: 2026 }));
    expect(no?.error).toMatch(/department head hasn't approved/);
    expect((await d.select().from(equipmentRequests).where(eq(equipmentRequests.id, r.id)))[0].status).toBe("SUBMITTED");
    const yes = await req.decideRequestAction(null, form({ requestId: r.id, decision: "approve", planYear: 2026, overrideReason: "Head on leave; ICU needs them before winter." }));
    expect(yes?.ok).toMatch(/approved/);
    const [after] = await d.select().from(equipmentRequests).where(eq(equipmentRequests.id, r.id));
    expect(after.status).toBe("APPROVED");
    expect(after.decisionNote).toMatch(/^Decided before the department head approved — reason: Head on leave/);
    expect(h.log.some((l) => l.id === r.id && l.action === "department_override")).toBe(true);
    // A department without a head: no wait, no reason needed.
    await d.delete(userDepartments).where(eq(userDepartments.departmentId, dept));
    const [r2] = await d.insert(equipmentRequests).values({ number: "REQ-T-2", facilityId: fac, departmentId: dept, deviceTypeId: type, reason: "Second monitor needed" }).returning();
    expect((await req.decideRequestAction(null, form({ requestId: r2.id, decision: "approve", planYear: 2026 })))?.ok).toMatch(/approved/);
  });
});
