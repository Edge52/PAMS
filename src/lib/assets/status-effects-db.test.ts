/**
 * Wave 34 (audit wave 30): asset status after work orders, loans and disposals, and PPM for run-to-failure types.
 *  - A3: cancelling the open jobs a disposal asks for must not put a condemned device back in service;
 *  - A4: a fault on a device on loan keeps it on loan, and the return then leaves it down until the job is done;
 *  - A5: run-to-failure device types are left out of PPM compliance.
 * Runs the real server code against an in-memory PGlite database with the real migrations; sign-in, activity log
 * and notifications are stubbed. Vitest has no "@/" alias, so each "@/…" module the code imports is mapped here.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";

const h = vi.hoisted(() => ({ d: null as unknown as DB }));
const { logStub } = vi.hoisted(() => ({
  logStub: () => ({ logActivity: async () => {}, rateToEgp: async () => 1, nextNumber: async (p: string) => `${p}-${Math.random().toString(36).slice(2, 10)}` }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/status", () => import("../status"));
vi.mock("@/lib/server-utils", logStub);
vi.mock("@/lib/auth/permissions", () => import("../auth/permissions"));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => ({ id: 1, name: "Tester", role: "ADMIN" }), requireFacilityAccess: async () => {}, facilityScope: async () => null,
}));
vi.mock("@/lib/notifications", () => ({ notifyUsers: async () => {}, usersWithRole: async () => [], notifyRole: async () => {} }));
vi.mock("@/lib/assets/filters", () => import("./filters"));
vi.mock("@/lib/assets/forms", () => import("./forms"));
vi.mock("@/lib/assets/loans", () => import("./loans"));
vi.mock("@/lib/assets/maintenance", () => import("./maintenance"));
vi.mock("@/lib/assets/meters-server", () => import("./meters-server"));
vi.mock("@/lib/assets/work-order-server", () => import("./work-order-server"));
vi.mock("@/lib/assets/work-orders", () => import("./work-orders"));
vi.mock("@/lib/procurement/forms", () => import("../procurement/forms"));

const { applyAssetEffect } = await import("./work-order-server");
const { returnLoanAction } = await import("../../app/assets/loans/actions");
const { ppmComplianceReport } = await import("../reports/ppm-compliance");

const { assets, deviceTypes, disposals, equipmentLoans, facilities, maintenanceEvents, workOrders } = schema;
let client: PGlite;
let d: DB;
let facilityId = 0, typeId = 0, rtfTypeId = 0, n = 0;

const form = (o: Record<string, string | number>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, String(v)); return f; };
const statusOf = async (id: number) => (await d.select({ s: assets.status }).from(assets).where(eq(assets.id, id)))[0].s;

async function asset(status: (typeof assets.$inferInsert)["status"], deviceTypeId = typeId, installDate = "2024-01-15") {
  const [a] = await d.insert(assets).values({ assetTag: `TST-${++n}`, deviceTypeId, facilityId, status, installDate }).returning();
  return a;
}
async function job(assetId: number, status: (typeof workOrders.$inferInsert)["status"] = "OPEN") {
  const [w] = await d.insert(workOrders).values({ number: `WO-T-${++n}`, assetId, facilityId, status, title: "Fault", deviceDown: true }).returning();
  return w;
}

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
  h.d = d;
  await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
  [{ id: facilityId }] = await d.insert(facilities).values({ code: "TST", name: "Test hospital" }).returning({ id: facilities.id });
  [{ id: typeId }] = await d.insert(deviceTypes).values({ code: "PMP-TEST-X", level: 3, name: "Test pump", ppmIntervalMonths: 12, maintenanceStrategy: "MANUFACTURER" }).returning({ id: deviceTypes.id });
  // The strategy page clears the interval for run to failure.
  [{ id: rtfTypeId }] = await d.insert(deviceTypes).values({ code: "THM-TEST-X", level: 3, name: "Test thermometer", ppmIntervalMonths: null, maintenanceStrategy: "RUN_TO_FAILURE", strategyReason: "Cheap, replaced on failure" }).returning({ id: deviceTypes.id });
}, 180_000);

afterAll(async () => { await client?.close(); });

describe("disposal and work orders (A3)", () => {
  it("cancelling an open job while a disposal waits for approval leaves the device out of service", async () => {
    const a = await asset("OUT_OF_SERVICE");
    const w = await job(a.id);
    await d.insert(disposals).values({ number: `DSP-T-${++n}`, assetId: a.id, facilityId, reason: "BEYOND_REPAIR", justification: "Repair costs more than a new one", status: "PENDING_APPROVAL" });
    await d.update(workOrders).set({ status: "CANCELLED" }).where(eq(workOrders.id, w.id));
    expect(await applyAssetEffect("cancel", w, { actor: "Tester" })).toBeNull();
    expect(await statusOf(a.id)).toBe("OUT_OF_SERVICE");
  });
  it("still puts a false alarm back in service when there is no disposal, or it was rejected", async () => {
    const a = await asset("OUT_OF_SERVICE");
    const w = await job(a.id);
    await d.insert(disposals).values({ number: `DSP-T-${++n}`, assetId: a.id, facilityId, reason: "OTHER", justification: "Asked by mistake", status: "REJECTED" });
    await d.update(workOrders).set({ status: "CANCELLED" }).where(eq(workOrders.id, w.id));
    expect(await applyAssetEffect("cancel", w, { actor: "Tester" })).toBe("IN_SERVICE");
  });
});

describe("faults on a device on loan (A4)", () => {
  it("keeps it on loan, returns it out of service, and the job's completion puts it in service", async () => {
    const a = await asset("ON_LOAN");
    const [loan] = await d.insert(equipmentLoans).values({ number: `LN-T-${++n}`, facilityId, direction: "LENT", otherParty: "Other hospital", assetId: a.id, outOn: "2026-11-01", statusBefore: "IN_SERVICE" }).returning();
    const w = await job(a.id);
    expect(await applyAssetEffect("report", w, { actor: "Tester" })).toBeNull();
    expect(await statusOf(a.id)).toBe("ON_LOAN");

    await expect(returnLoanAction({}, form({ loanId: loan.id, returnedOn: "2026-11-10" }))).rejects.toThrow(/^redirect:/);
    expect(await statusOf(a.id)).toBe("OUT_OF_SERVICE");

    await d.update(workOrders).set({ status: "COMPLETED" }).where(eq(workOrders.id, w.id));
    expect(await applyAssetEffect("complete", w, { returnToService: true, actor: "Tester" })).toBe("IN_SERVICE");
  });
  it("a loan with no fault still goes back to the status it had", async () => {
    const a = await asset("ON_LOAN");
    const [loan] = await d.insert(equipmentLoans).values({ number: `LN-T-${++n}`, facilityId, direction: "LENT", otherParty: "Other hospital", assetId: a.id, outOn: "2026-11-01", statusBefore: "INSTALLED" }).returning();
    await expect(returnLoanAction({}, form({ loanId: loan.id, returnedOn: "2026-11-10" }))).rejects.toThrow(/^redirect:/);
    expect(await statusOf(a.id)).toBe("INSTALLED");
  });
});

describe("PPM compliance and run-to-failure types (A5)", () => {
  it("leaves run-to-failure devices out, scheduled or not", async () => {
    const [fac2] = await d.insert(facilities).values({ code: "TS2", name: "Second hospital" }).returning({ id: facilities.id });
    const keep = facilityId;
    facilityId = fac2.id;
    try {
      await asset("IN_SERVICE", rtfTypeId, "2025-03-01");                     // on a 12-month default: "due, not scheduled" in March
      const rtfSched = await asset("IN_SERVICE", rtfTypeId, "2024-01-15");     // has an old overdue PPM from before the strategy changed
      await d.insert(maintenanceEvents).values({ assetId: rtfSched.id, type: "PPM", status: "SCHEDULED", scheduledDate: "2026-03-01" });
      const ctx = { filters: { facilityId: fac2.id, from: "2026-01-01", to: "2026-11-20", days: 30, grace: 7, projectStatus: "open" as const }, scope: null, today: "2026-11-21" };
      const r = await ppmComplianceReport(ctx);
      expect(r.sections[0].rows).toEqual([]);
      expect(r.summary?.[0].value).toBe("0");
    } finally { facilityId = keep; }
  });
});
