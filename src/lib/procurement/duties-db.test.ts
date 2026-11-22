/**
 * Wave 34 (audit wave 30): framework items of another hospital's agreement (S3) and segregation of duties on
 * supplier invoices (S7 / DL-19). Runs the real actions against an in-memory PGlite database with the real
 * migrations. Sign-in is stubbed with a switchable user whose hospitals are checked like the real
 * requireFacilityAccess; the activity log and notifications are stubbed. Vitest has no "@/" alias, so each "@/…"
 * module the code imports is mapped here.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";

type Me = { id: number; name: string; role: string; scope: number[] | null };
const h = vi.hoisted(() => ({ d: null as unknown as DB, me: { id: 1, name: "Tester", role: "ADMIN", scope: null } as Me }));
const { logStub, serverStub } = vi.hoisted(() => ({
  logStub: () => ({ logActivity: async () => {}, nextNumber: async (p: string) => `${p}-${Math.random().toString(36).slice(2, 10)}` }),
  serverStub: () => ({ fxFactors: async (cs: string[]) => Object.fromEntries(cs.map((c) => [c, 1])) }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/audit-diff", () => import("../audit-diff"));
vi.mock("@/lib/server-utils", logStub);
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => h.me,
  requireFacilityAccess: async (facilityId: number | null | undefined) => {
    if (facilityId != null && h.me.scope && !h.me.scope.includes(facilityId)) throw new Error("redirect:/forbidden?need=facility");
  },
}));
vi.mock("@/lib/notifications", () => ({ notifyRole: async () => {} }));
vi.mock("@/lib/procurement/server", serverStub);
vi.mock("./server", serverStub);
vi.mock("@/lib/procurement/money", () => import("./money"));
vi.mock("@/lib/procurement/money-server", () => import("./money-server"));
vi.mock("@/lib/procurement/delay-penalty", () => import("./delay-penalty"));
vi.mock("@/lib/procurement/penalty-server", () => import("./penalty-server"));
vi.mock("@/lib/settings", () => import("../settings"));

const { addFrameworkItemAction, removeFrameworkItemAction } = await import("../../app/procurement/frameworks/actions");
const { createInvoiceAction, decideInvoiceAction, markPaidAction } = await import("../../app/procurement/invoices/actions");

const { deviceTypes, facilities, frameworkItems, frameworks, invoices, poLines, purchaseOrders, suppliers, users } = schema;
let client: PGlite;
let d: DB;
let supplierId = 0, facA = 0, facB = 0, typeId = 0, type2Id = 0, n = 0;
const people: Record<string, Me> = {};

const form = (o: Record<string, string | number>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, String(v)); return f; };
const as = (who: string) => { h.me = people[who]; };

async function framework(facilityId: number) {
  const [fw] = await d.insert(frameworks).values({ number: `FA-T-${++n}`, title: "Pumps", supplierId, facilityId, startDate: "2026-01-01", endDate: "2027-12-31", ceiling: "1000000.00" }).returning();
  const [item] = await d.insert(frameworkItems).values({ frameworkId: fw.id, deviceTypeId: typeId, description: "Pump", unitPrice: "1000.00" }).returning();
  return { fw, item };
}
const itemCount = async (frameworkId: number) => (await d.select().from(frameworkItems).where(eq(frameworkItems.frameworkId, frameworkId))).length;

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
  h.d = d;
  await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
  [{ id: supplierId }] = await d.insert(suppliers).values({ name: "Test supplier" }).returning({ id: suppliers.id });
  [{ id: facA }] = await d.insert(facilities).values({ code: "TSA", name: "Hospital A" }).returning({ id: facilities.id });
  [{ id: facB }] = await d.insert(facilities).values({ code: "TSB", name: "Hospital B" }).returning({ id: facilities.id });
  [{ id: typeId }] = await d.insert(deviceTypes).values({ code: "PMP-TEST-X", level: 3, name: "Test pump" }).returning({ id: deviceTypes.id });
  [{ id: type2Id }] = await d.insert(deviceTypes).values({ code: "MON-TEST-X", level: 3, name: "Test monitor" }).returning({ id: deviceTypes.id });
  for (const [key, name, role, scope] of [
    ["buyerB", "Buyer B", "PROCUREMENT", [facB]], ["buyerA", "Buyer A", "PROCUREMENT", [facA]],
    ["fin1", "Finance one", "FINANCE", null], ["fin2", "Finance two", "FINANCE", null], ["admin", "Admin", "ADMIN", null],
  ] as const) {
    const [u] = await d.insert(users).values({ name, email: `${key}@test.local`, role }).returning({ id: users.id });
    people[key] = { id: u.id, name, role, scope: scope ? [...scope] : null };
  }
}, 180_000);

afterAll(async () => { await client?.close(); });

describe("framework items and hospital access (S3)", () => {
  it("a user of another hospital can't add or remove items", async () => {
    const { fw, item } = await framework(facA);
    as("buyerB");
    await expect(addFrameworkItemAction({}, form({ frameworkId: fw.id, deviceTypeId: type2Id, unitPrice: 500 }))).rejects.toThrow(/forbidden/);
    await expect(removeFrameworkItemAction(form({ frameworkId: fw.id, itemId: item.id }))).rejects.toThrow(/forbidden/);
    expect(await itemCount(fw.id)).toBe(1);
  });
  it("an item can't be removed through another agreement's id", async () => {
    const { fw, item } = await framework(facA);
    const { fw: mine } = await framework(facB); // an agreement the user may edit, with no POs
    as("buyerB");
    await removeFrameworkItemAction(form({ frameworkId: mine.id, itemId: item.id }));
    expect(await itemCount(fw.id)).toBe(1);
  });
  it("an item called off by a PO stays; an unused one is removed", async () => {
    const { fw, item } = await framework(facA);
    const [spare] = await d.insert(frameworkItems).values({ frameworkId: fw.id, deviceTypeId: type2Id, description: "Monitor", unitPrice: "900.00" }).returning();
    const [po] = await d.insert(purchaseOrders).values({ number: `PO-T-${++n}`, supplierId, facilityId: facA, frameworkId: fw.id, status: "DRAFT", currency: "EGP" }).returning();
    await d.insert(poLines).values({ poId: po.id, deviceTypeId: typeId, description: "Pump", quantity: 2, unitPrice: "1000.00" });
    as("buyerA");
    await removeFrameworkItemAction(form({ frameworkId: fw.id, itemId: item.id }));
    await removeFrameworkItemAction(form({ frameworkId: fw.id, itemId: spare.id }));
    const left = await d.select({ id: frameworkItems.id }).from(frameworkItems).where(eq(frameworkItems.frameworkId, fw.id));
    expect(left.map((r) => r.id)).toEqual([item.id]);
  });
  it("the owner can still add an item", async () => {
    const { fw } = await framework(facA);
    as("buyerA");
    expect(await addFrameworkItemAction({}, form({ frameworkId: fw.id, deviceTypeId: type2Id, unitPrice: 500 }))).toMatchObject({ ok: expect.any(String) });
    expect(await itemCount(fw.id)).toBe(2);
  });
});

describe("segregation of duties on invoices (S7 / DL-19)", () => {
  async function recordInvoice(who: string) {
    const [po] = await d.insert(purchaseOrders).values({ number: `PO-T-${++n}`, supplierId, facilityId: facA, status: "ISSUED", currency: "EGP" }).returning();
    const [line] = await d.insert(poLines).values({ poId: po.id, deviceTypeId: typeId, description: "Pump", quantity: 1, unitPrice: "1000.00", receivedQty: 1 }).returning();
    as(who);
    await expect(createInvoiceAction({}, form({ poId: po.id, supplierInvoiceNo: `S-${++n}`, invoiceDate: "2026-11-01", [`qty_${line.id}`]: 1, [`price_${line.id}`]: 1000 }))).rejects.toThrow(/^redirect:/);
    const [inv] = await d.select().from(invoices).where(eq(invoices.poId, po.id));
    return inv;
  }
  const status = async (id: number) => (await d.select({ s: invoices.status }).from(invoices).where(eq(invoices.id, id)))[0].s;

  it("the person who recorded an invoice can't approve or reject it", async () => {
    const inv = await recordInvoice("fin1");
    expect(inv.createdById).toBe(people.fin1.id);
    expect(await decideInvoiceAction({}, form({ invoiceId: inv.id, decision: "approve" }))).toMatchObject({ error: expect.stringMatching(/You recorded this invoice/) });
    expect(await decideInvoiceAction({}, form({ invoiceId: inv.id, decision: "reject", note: "Wrong" }))).toMatchObject({ error: expect.stringMatching(/You recorded this invoice/) });
    expect(await status(inv.id)).toBe("MATCHED");
  });
  it("the approver can't mark it paid, nor can the recorder; a third person can", async () => {
    const inv = await recordInvoice("fin1");
    as("fin2");
    expect(await decideInvoiceAction({}, form({ invoiceId: inv.id, decision: "approve" }))).toMatchObject({ ok: expect.any(String) });
    expect(await markPaidAction({}, form({ invoiceId: inv.id, paidAt: "2026-11-20" }))).toMatchObject({ error: expect.stringMatching(/You approved this invoice/) });
    as("fin1");
    expect(await markPaidAction({}, form({ invoiceId: inv.id, paidAt: "2026-11-20" }))).toMatchObject({ error: expect.stringMatching(/You recorded this invoice/) });
    expect(await status(inv.id)).toBe("APPROVED");
    as("admin");
    expect(await markPaidAction({}, form({ invoiceId: inv.id, paidAt: "2026-11-20" }))).toMatchObject({ ok: expect.any(String) });
    expect(await status(inv.id)).toBe("PAID");
  });
  it("administrators are held to the same rule", async () => {
    const inv = await recordInvoice("admin");
    expect(await decideInvoiceAction({}, form({ invoiceId: inv.id, decision: "approve" }))).toMatchObject({ error: expect.stringMatching(/You recorded this invoice/) });
  });
  it("invoices from before wave 34 (names only) are checked by name", async () => {
    const inv = await recordInvoice("fin1");
    await d.update(invoices).set({ createdById: null }).where(eq(invoices.id, inv.id));
    as("fin1");
    expect(await decideInvoiceAction({}, form({ invoiceId: inv.id, decision: "approve" }))).toMatchObject({ error: expect.stringMatching(/You recorded this invoice/) });
  });
});
