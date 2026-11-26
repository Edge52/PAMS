/**
 * Wave 39 (agent C): equipment requests by role and department, and acceptance signatures tied to the signed-in
 * account. Real server actions against in-memory PGlite with the real migrations.
 *
 * Skipped until the migration with the wave 39 columns exists in drizzle/ (the lead generates it at merge time).
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";

type Me = { id: number; name: string; email: string; role: string; jobTitle: null; allFacilities: boolean };
const h = vi.hoisted(() => ({ d: null as unknown as DB, me: null as unknown as Me }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/server-utils", () => ({ logActivity: async () => {}, nextNumber: async (p: string) => `${p}-T-${Math.random().toString(36).slice(2, 8)}`, convert: async (n: number) => n }));
vi.mock("@/lib/notifications", () => ({ notifyRole: async () => {}, notifyUsers: async () => {} }));
vi.mock("@/lib/boq/replacement-set", () => ({ replacementSetId: async () => 1 }));
vi.mock("@/lib/boq/generate", () => ({ defaultUnitPrices: async () => new Map() }));
vi.mock("@/lib/settings", () => ({ getSetting: async () => 7 }));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/fiscal-year", () => import("../fiscal-year"));
vi.mock("@/lib/procurement/budget-year-server", () => import("../procurement/budget-year-server"));
vi.mock("@/lib/auth/departments", () => import("../auth/departments"));
vi.mock("@/lib/auth/permissions", () => import("../auth/permissions"));
vi.mock("@/lib/assets/request-rules", () => import("./request-rules"));
vi.mock("@/lib/assets/checklists", () => import("./checklists"));
vi.mock("@/lib/assets/dates", () => import("./dates"));
vi.mock("@/lib/procurement/acceptance-server", () => import("../procurement/acceptance-server"));
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
const ready = (await client.query<{ t: string | null }>("select column_name as t from information_schema.columns where table_name = 'equipment_requests' and column_name = 'dept_approved_by_id'")).rows[0]?.t != null;

afterAll(async () => { await client.close(); });

const form = (o: Record<string, string | number>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, String(v)); return f; };
const user = (id: number, role: string): Me => ({ id, name: `${role} ${id}`, email: `${id}@t.hpams`, role, jobTitle: null, allFacilities: true });

describe.skipIf(!ready)("wave 39 requests and signatures", async () => {
  const req = await import("../../app/assets/requests/actions");
  const acc = await import("../../app/assets/acceptance-actions");
  const { assets, departments, deviceTypes, equipmentRequests, facilities, userDepartments, users, acceptances } = schema;
  let fac = 0, icu = 0, er = 0, type = 0, asset = 0;
  const head = user(2, "DEPARTMENT_HEAD"), viewer = user(3, "VIEWER"), biomed = user(4, "BIOMEDICAL"), director = user(5, "DIRECTOR");

  it("sets up", async () => {
    await d.insert(users).values([head, viewer, biomed, director].map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role as "VIEWER" })));
    await d.insert(schema.departmentTypes).values([{ code: "ICU", name: "ICU" }, { code: "ER", name: "Emergency" }]).onConflictDoNothing();
    [{ id: fac }] = await d.insert(facilities).values({ code: "W39", name: "Wave 39 hospital" }).returning({ id: facilities.id });
    [{ id: icu }] = await d.insert(departments).values({ facilityId: fac, code: "ICU", name: "ICU", departmentTypeCode: "ICU" }).returning({ id: departments.id });
    [{ id: er }] = await d.insert(departments).values({ facilityId: fac, code: "ER", name: "ER", departmentTypeCode: "ER" }).returning({ id: departments.id });
    await d.insert(userDepartments).values({ userId: head.id, departmentId: icu });
    [{ id: type }] = await d.insert(deviceTypes).values({ code: "MON-W39", level: 3, name: "Monitor" }).returning({ id: deviceTypes.id });
    [{ id: asset }] = await d.insert(assets).values({ assetTag: "W39-MON-1", deviceTypeId: type, facilityId: fac, departmentId: icu, status: "IN_STOCK" }).returning({ id: assets.id });
  });

  const ask = (departmentId: number) => req.createRequestAction(null, form({ facilityId: fac, departmentId, deviceTypeId: type, quantity: 2, reason: "Two more beds open in January." }));

  it("viewers can't ask for equipment", async () => {
    h.me = viewer;
    await expect(ask(icu)).rejects.toThrow(/forbidden:requests.create/);
  });

  it("department heads ask for their own department only, approved by the department on sending", async () => {
    h.me = head;
    expect((await ask(er))?.error).toMatch(/departments you look after/);
    expect((await ask(icu))?.ok).toMatch(/sent to the director/);
    const [r] = await d.select().from(equipmentRequests).where(eq(equipmentRequests.departmentId, icu));
    expect(r).toMatchObject({ deptApprovedById: head.id, deptApprovedByName: head.name });
  });

  it("a biomedical request waits for the head's approval; another head's department is refused", async () => {
    h.me = biomed;
    await ask(icu); await ask(er);
    const rows = await d.select().from(equipmentRequests).where(eq(equipmentRequests.requestedById, biomed.id)).orderBy(equipmentRequests.id);
    expect(rows.map((r) => r.deptApprovedById)).toEqual([null, null]);
    h.me = head;
    expect((await req.approveForDepartmentAction(null, form({ requestId: rows[1].id })))?.error).toMatch(/only for the departments/);
    expect((await req.approveForDepartmentAction(null, form({ requestId: rows[0].id })))?.ok).toMatch(/director decides next/);
    // Heads can't make the director's decision.
    await expect(req.decideRequestAction(null, form({ requestId: rows[0].id, decision: "approve" }))).rejects.toThrow(/forbidden:boq.approve/);
    h.me = director;
    expect((await req.decideRequestAction(null, form({ requestId: rows[0].id, decision: "approve" })))?.ok).toMatch(/approved for FY 20\d\d\/\d\d/);
  });

  it("acceptance signatures carry the signed-in account; a witness is optional", async () => {
    await d.insert(acceptances).values({ assetId: asset, results: [] });
    h.me = biomed;
    const all = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`res_${i}`, "NA"]));
    const signed = await acc.saveAcceptanceAction(null, form({ assetId: asset, intent: "sign_biomed", ...all }));
    expect(signed, JSON.stringify(signed)).toMatchObject({ ok: expect.stringMatching(/Signed for biomedical/) });
    // The same person can't sign both sides without naming the department's witness.
    expect((await acc.saveAcceptanceAction(null, form({ assetId: asset, intent: "sign_dept" })))?.error).toMatch(/witness/);
    h.me = head;
    expect((await acc.saveAcceptanceAction(null, form({ assetId: asset, intent: "sign_dept", witness: "Nurse Huda" })))?.ok).toMatch(/Accepted/);
    const [a] = await d.select().from(acceptances).where(eq(acceptances.assetId, asset));
    expect(a).toMatchObject({ status: "ACCEPTED", biomedSignedById: biomed.id, biomedSignedBy: biomed.name, departmentSignedById: head.id, departmentSignedBy: head.name, departmentWitness: "Nurse Huda" });
  });
});
