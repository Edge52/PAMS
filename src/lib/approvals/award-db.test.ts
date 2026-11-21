/**
 * Audit DL-24/DL-25: one award per tender, and an approval whose effect was lost gets repaired.
 * Real code against in-memory PGlite with the real migrations; logging, settings and scoring are stubbed.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";

const h = vi.hoisted(() => ({ d: null as unknown as DB, log: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/server-utils", () => ({ logActivity: async (_t: string, _id: number, action: string) => { h.log.push(action); }, convert: async (n: number) => n }));
vi.mock("@/lib/settings", () => ({ getSettings: async () => ({ complaintDays: 7, acceptanceNoticeDays: 15 }) }));
vi.mock("@/lib/procurement/tender", () => import("../procurement/tender"));
vi.mock("./server", () => ({ advanceProject: async () => {}, offerTotals: async () => new Map(), recomputeOfferScores: async () => {} }));
vi.mock("../procurement/server", () => ({ advanceProject: async () => {}, offerTotals: async () => new Map(), recomputeOfferScores: async () => {} }));

const { approvalRequests, offers, projects, purchaseOrders, suppliers, facilities } = schema;
let client: PGlite; let d: DB;
let projectId = 0, offerA = 0, offerB = 0, supplierId = 0, facilityId = 0;

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
  h.d = d;
  await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
  [{ id: supplierId }] = await d.insert(suppliers).values({ name: "Supplier" }).returning({ id: suppliers.id });
  [{ id: facilityId }] = await d.insert(facilities).values({ code: "TST", name: "Test hospital" }).returning({ id: facilities.id });
  [{ id: projectId }] = await d.insert(projects).values({ code: "T-1", title: "CT tender" }).returning({ id: projects.id });
  [{ id: offerA }] = await d.insert(offers).values({ projectId, supplierId, reference: "A", offerDate: "2026-10-01", currency: "USD", status: "SHORTLISTED" }).returning({ id: offers.id });
  [{ id: offerB }] = await d.insert(offers).values({ projectId, supplierId, reference: "B", offerDate: "2026-10-01", currency: "USD", status: "SHORTLISTED" }).returning({ id: offers.id });
}, 180_000);
afterAll(async () => { await client?.close(); });

describe("one award per tender (DL-24/DL-25)", () => {
  it("a second approved award is not applied while another offer holds the award", async () => {
    const { applyApprovedAward } = await import("../procurement/tender");
    expect(await applyApprovedAward(offerA, "Tester")).toBe(true);
    expect(await applyApprovedAward(offerB, "Tester")).toBe(false);
    const rows = await d.select({ id: offers.id, status: offers.status }).from(offers).where(eq(offers.projectId, projectId));
    expect(rows.filter((r) => r.status === "AWARDED").map((r) => r.id)).toEqual([offerA]);
    expect(h.log).toContain("award_blocked");
    expect(await applyApprovedAward(offerA, "Tester")).toBe(true); // running it again is harmless
  });

  it("re-applies an approval whose effect was lost, once", async () => {
    const { reconcileApprovalEffects } = await import("./effects");
    const [p] = await d.insert(purchaseOrders).values({ number: "PO-R-1", supplierId, facilityId, status: "PENDING_APPROVAL", currency: "EGP" }).returning();
    await d.insert(approvalRequests).values({ entity: "PO", entityId: p.id, status: "APPROVED", title: "PO-R-1", href: "/x", decidedAt: new Date() });
    expect(await reconcileApprovalEffects()).toBe(1);
    expect((await d.select().from(purchaseOrders).where(eq(purchaseOrders.id, p.id)))[0].status).toBe("APPROVED");
    expect(await reconcileApprovalEffects()).toBe(0);
  });

  it("doesn't re-award an offer whose award was revoked after the decision", async () => {
    const { reconcileApprovalEffects } = await import("./effects");
    await d.insert(approvalRequests).values({ entity: "AWARD", entityId: offerB, status: "APPROVED", title: "Award B", href: "/x", decidedAt: new Date(Date.now() - 60_000) });
    await d.update(offers).set({ notes: "touched after the decision" }).where(eq(offers.id, offerB));
    expect(await reconcileApprovalEffects()).toBe(0);
  });
});
