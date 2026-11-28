/**
 * Wave 43 (agent Q) against in-memory PGlite with the real migrations:
 * - planned visits without a job show in My jobs for the device's usual technician, or for the team;
 * - "Start" raises the job for the person and starts it;
 * - bulk "Assign" on the schedule goes back to the schedule with a message, also for a single visit.
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
  scope: null as number[] | null, team: [] as { id: number; name: string; role: string; jobTitle: null }[],
  session: async () => {
    const { can } = await import("../auth/permissions");
    return {
      requirePermission: async (p: Parameters<typeof can>[1]) => { if (!can(h.me.role, p)) throw new Error(`forbidden:${p}`); return h.me; },
      requireUser: async () => h.me, getCurrentUser: async () => h.me,
      requireFacilityAccess: async (f: number | null | undefined) => { if (f != null && h.scope && !h.scope.includes(f)) throw new Error("redirect:/forbidden"); },
      facilityScope: async () => h.scope,
    };
  },
  wos: () => ({
    applyAssetEffect: async () => {}, coverForAsset: async () => ({ kind: "NONE" }), notifyAssigners: async () => 0,
    assignableUsers: async () => h.team, checklistForType: async () => ({ items: [] }),
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/server-utils", () => ({ logActivity: async () => {}, nextNumber: async (p: string) => `${p}-T-${Math.random().toString(36).slice(2, 8)}` }));
vi.mock("@/lib/notifications", () => ({ notifyRole: async () => {}, notifyUsers: async () => 0, usersWithRole: async () => [] }));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/status", () => import("../status"));
vi.mock("@/lib/bulk", () => import("../bulk"));
vi.mock("@/lib/auth/permissions", () => import("../auth/permissions"));
vi.mock("@/lib/auth/session", () => h.session());
vi.mock("../auth/session", () => h.session());
vi.mock("@/lib/assets/access", () => import("./access"));
vi.mock("@/lib/assets/forms", () => import("./forms"));
vi.mock("@/lib/assets/checklists", () => import("./checklists"));
vi.mock("@/lib/assets/contracts", () => import("./contracts"));
vi.mock("@/lib/assets/failure-codes", () => import("./failure-codes"));
vi.mock("@/lib/assets/work-orders", () => import("./work-orders"));
vi.mock("@/lib/assets/vigilance", () => import("./vigilance"));
vi.mock("@/lib/assets/vigilance-server", () => ({ quarantineFor: async () => null, safetyGate: async () => null }));
vi.mock("./vigilance-server", () => ({ quarantineFor: async () => null, safetyGate: async () => null }));
vi.mock("@/lib/assets/calibration-server", () => ({ calibrationHeld: async () => null }));
vi.mock("@/lib/assets/competency-server", () => ({ assignmentCheck: async () => ({ warning: null, record: async () => {} }) }));
vi.mock("@/lib/assets/test-equipment-server", () => ({ saveInstruments: async () => {} }));
vi.mock("@/lib/assets/offline-jobs", () => import("./offline-jobs"));
vi.mock("@/lib/assets/my-jobs-server", () => import("./my-jobs-server"));
vi.mock("@/lib/assets/work-order-steps-server", () => import("./work-order-steps-server"));
vi.mock("@/lib/assets/work-order-server", () => h.wos());
vi.mock("./work-order-server", () => h.wos());

const client = new PGlite();
const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
h.d = d;
await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });

afterAll(async () => { await client.close(); });

const plus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const redirectOf = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e) { return decodeURIComponent((e as Error).message); } };

describe("planned visits in My jobs and bulk Assign (wave 43)", async () => {
  const { myVisits } = await import("./my-jobs-server");
  const { startVisitAction } = await import("../../app/assets/my-jobs/visit-actions");
  const { bulkAssignPpmAction } = await import("../../app/assets/maintenance/bulk-actions");
  const { assets, deviceTypes, facilities, maintenanceEvents, users, workOrders } = schema;
  let fac = 0, type = 0, tech = 0, tech2 = 0, a1 = 0, a2 = 0, v1 = 0, v2 = 0, v3 = 0;
  const as = (id: number, name: string): Me => ({ id, name, email: `${name}@t.hpams`, role: "TECHNICIAN", jobTitle: null, allFacilities: true });

  it("sets up", async () => {
    await d.insert(users).values({ id: 1, name: "Admin", email: "a@t.hpams", role: "ADMIN" }).onConflictDoNothing();
    await d.execute(sql`select setval('users_id_seq', (select max(id) from users))`);
    [{ id: tech }, { id: tech2 }] = await d.insert(users).values([{ name: "Tech", email: "t@t.hpams", role: "TECHNICIAN" }, { name: "Tech2", email: "t2@t.hpams", role: "TECHNICIAN" }]).returning({ id: users.id });
    h.team = [{ id: tech, name: "Tech", role: "TECHNICIAN", jobTitle: null }, { id: tech2, name: "Tech2", role: "TECHNICIAN", jobTitle: null }, { id: 1, name: "Admin", role: "ADMIN", jobTitle: null }];
    [{ id: fac }] = await d.insert(facilities).values({ code: "W43Q", name: "Wave 43 hospital" }).returning({ id: facilities.id });
    [{ id: type }] = await d.insert(deviceTypes).values({ code: "PUMP-W43", level: 3, name: "Pump" }).returning({ id: deviceTypes.id });
    [{ id: a1 }, { id: a2 }] = await d.insert(assets).values([{ assetTag: "W43-P-1", deviceTypeId: type, facilityId: fac, status: "IN_SERVICE" }, { assetTag: "W43-P-2", deviceTypeId: type, facilityId: fac, status: "IN_SERVICE" }]).returning({ id: assets.id });
    // a1's last planned job was Tech2's: a1 is Tech2's device.
    const [old] = await d.insert(maintenanceEvents).values({ assetId: a1, type: "PPM", status: "COMPLETED", scheduledDate: plus(-180), completedDate: plus(-180) }).returning({ id: maintenanceEvents.id });
    await d.insert(workOrders).values({ number: "WO-T-OLD", assetId: a1, facilityId: fac, type: "PPM", status: "CLOSED", title: "Old PPM", assignedToId: tech2, plannedEventId: old.id });
    [{ id: v1 }, { id: v2 }, { id: v3 }] = await d.insert(maintenanceEvents).values([
      { assetId: a1, type: "PPM", status: "SCHEDULED", scheduledDate: plus(2) },
      { assetId: a2, type: "PPM", status: "OVERDUE", scheduledDate: plus(-10) },
      { assetId: a2, type: "CALIBRATION", status: "SCHEDULED", scheduledDate: plus(30) },
    ]).returning({ id: maintenanceEvents.id });
  });

  it("shows the team's visits to everyone and a device's visit only to its usual technician", async () => {
    const today = plus(0);
    const mine = await myVisits(as(tech, "Tech") as never, null, today);
    expect(mine.map((v) => [v.eventId, v.for])).toEqual([[v2, "team"]]);
    const t2 = await myVisits(as(tech2, "Tech2") as never, null, today);
    expect(t2.map((v) => [v.eventId, v.for])).toEqual([[v2, "team"], [v1, "mine"]]);
    expect(t2.some((v) => v.eventId === v3)).toBe(false); // a month ahead
  });

  it("starts a visit: the job is raised for me and in progress", async () => {
    h.me = as(tech, "Tech"); h.scope = null;
    expect(await startVisitAction(v1)).toMatchObject({ error: expect.stringMatching(/no longer waiting/) }); // Tech2's device
    const r = await startVisitAction(v2);
    expect(r).toMatchObject({ ok: expect.stringMatching(/started/) });
    const [wo] = await d.select().from(workOrders).where(eq(workOrders.plannedEventId, v2));
    expect(wo).toMatchObject({ assignedToId: tech, status: "IN_PROGRESS" });
    expect((await myVisits(as(tech, "Tech") as never, null, plus(0))).length).toBe(0);
  });

  it("bulk Assign of one visit goes back to the schedule with a message", async () => {
    h.me = { ...h.me, id: 1, name: "Admin", role: "ADMIN" }; h.scope = null;
    const f = new FormData();
    f.append("eventIds", String(v1)); f.set("assigneeId", String(tech2)); f.set("returnPath", "/assets/maintenance?tab=schedule");
    const to = await redirectOf(bulkAssignPpmAction(f));
    expect(to).toMatch(/^redirect:\/assets\/maintenance\?tab=schedule&notice=WO-T-\w+ created and assigned to Tech2\./);
  });
});
