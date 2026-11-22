/**
 * Wave 36 (audit wave 30): receipts on cancelled or closed orders (DL-13), manual status changes as compare-and-set
 * (DL-14), over-ordering and over-invoicing when two saves run at once (DL-15) and PO prices that add up to the offer
 * total (DL-10). Same set-up as orders-db.test.ts: real actions on in-memory PGlite with the real migrations.
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
const { logStub, serverStub } = vi.hoisted(() => ({
  logStub: () => ({
    logActivity: async () => {}, convert: async (n: number) => n, nextNumber: async (p: string) => `${p}-${Math.random().toString(36).slice(2, 10)}`,
  }),
  serverStub: () => ({
    advanceProject: async () => {},
    fxFactors: async (cs: string[]) => Object.fromEntries(cs.map((c) => [c, 1])),
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/audit-diff", () => import("../audit-diff"));
vi.mock("@/lib/server-utils", logStub);
vi.mock("../server-utils", logStub);
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => ({ id: 1, name: "Tester", role: "ADMIN" }), requireFacilityAccess: async () => {},
}));
vi.mock("@/lib/approvals/server", () => ({ cancelApproval: async () => true, startApproval: async () => ({ status: "APPROVED" }) }));
vi.mock("@/lib/notifications", () => ({ notifyRole: async () => {} }));
vi.mock("@/lib/procurement/server", serverStub);
vi.mock("./server", serverStub);
vi.mock("@/lib/asset-factory", () => import("../asset-factory"));
vi.mock("@/lib/procurement/forms", () => import("./forms"));
vi.mock("@/lib/procurement/labels", () => import("./labels"));
vi.mock("@/lib/procurement/po-status", () => import("./po-status"));
vi.mock("@/lib/procurement/receipt", () => import("./receipt"));
vi.mock("@/lib/procurement/money", () => import("./money"));
vi.mock("@/lib/procurement/money-server", () => import("./money-server"));
vi.mock("@/lib/procurement/delay-penalty", () => import("./delay-penalty"));
vi.mock("@/lib/procurement/penalty-server", () => import("./penalty-server"));
vi.mock("@/lib/settings", () => import("../settings"));
vi.mock("@/lib/procurement/receiving", () => import("./receiving"));
vi.mock("@/lib/procurement/scoring", () => import("./scoring"));

const { deliveries, deviceTypes, facilities, invoices, offerLines, offers, poLines, projects, purchaseOrders, suppliers } = schema;
let client: PGlite;
let d: DB;
let supplierId = 0, facilityId = 0, typeId = 0, n = 0;

const form = (o: Record<string, string | number>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, String(v)); return f; };

async function po(status: (typeof purchaseOrders.$inferInsert)["status"], lines: { qty: number; price: number; received?: number; description?: string }[], extra: Partial<typeof purchaseOrders.$inferInsert> = {}) {
  const [p] = await d.insert(purchaseOrders).values({ number: `PO-T-${++n}`, supplierId, facilityId, status, currency: "EGP", ...extra }).returning();
  const ls = await d.insert(poLines).values(lines.map((l) => ({
    poId: p.id, deviceTypeId: typeId, description: l.description ?? "Pump", quantity: l.qty, unitPrice: l.price.toFixed(2), receivedQty: l.received ?? 0,
  }))).returning();
  return { p, ls };
}

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
  h.d = d;
  await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
  await d.insert(schema.users).values({ id: 1, name: "Tester", email: "tester@test.hpams", role: "ADMIN" });
  [{ id: supplierId }] = await d.insert(suppliers).values({ name: "Test supplier" }).returning({ id: suppliers.id });
  [{ id: facilityId }] = await d.insert(facilities).values({ code: "TST", name: "Test hospital" }).returning({ id: facilities.id });
  [{ id: typeId }] = await d.insert(deviceTypes).values({ code: "PMP-TEST-X", level: 3, name: "Test pump" }).returning({ id: deviceTypes.id });
}, 180_000);

afterAll(async () => { await client?.close(); });


async function awardedOffer(lines: { qty: number; price: string; discount?: number }[]) {
  const [pr] = await d.insert(projects).values({ code: `T-${++n}`, title: "Test tender", facilityId }).returning();
  const [o] = await d.insert(offers).values({ projectId: pr.id, supplierId, reference: `Q-${n}`, offerDate: "2026-01-01", currency: "EGP", status: "AWARDED", awardApprovedOn: "2026-01-02" }).returning();
  const ls = await d.insert(offerLines).values(lines.map((l) => ({ offerId: o.id, deviceTypeId: typeId, description: "Pump", quantity: l.qty, unitPrice: l.price, discountPct: l.discount ?? 0 }))).returning();
  return { o, ls };
}
const poIdOf = (e: unknown) => Number(/purchase-orders\/(\d+)/.exec(String((e as Error).message))?.[1]);
const orderedOf = async (offerLineId: number) => (await d.select().from(poLines).where(eq(poLines.offerLineId, offerLineId))).reduce((s, l) => s + l.quantity, 0);

describe("goods receipts on closed or cancelled orders (DL-13)", () => {
  it("refuses a receipt on a cancelled order and leaves its status alone", async () => {
    const { receiveGoods } = await import("./receiving");
    for (const status of ["CANCELLED", "CLOSED"] as const) {
      const { p, ls } = await po(status, [{ qty: 2, price: 100 }]);
      const res = await receiveGoods(p.id, { reference: `GRN-${status}`, deliveryDate: "2026-01-05", receivedBy: null, notes: null }, [{ poLineId: ls[0].id, qty: 1, serials: [] }]);
      expect(res.ok).toBe(false);
      expect(await d.select().from(deliveries).where(eq(deliveries.poId, p.id))).toHaveLength(0);
      expect((await d.select().from(poLines).where(eq(poLines.id, ls[0].id)))[0].receivedQty).toBe(0);
      expect((await d.select().from(purchaseOrders).where(eq(purchaseOrders.id, p.id)))[0].status).toBe(status);
    }
  });

  it("a cancel and a receipt at the same time: only one of them happens", async () => {
    const { receiveGoods } = await import("./receiving");
    const { setPoStatus } = await import("../../app/procurement/purchase-orders/actions");
    const { p, ls } = await po("ISSUED", [{ qty: 2, price: 100 }]);
    const [cancel, receipt] = await Promise.all([
      setPoStatus(null, form({ poId: p.id, status: "CANCELLED", from: "ISSUED" })),
      receiveGoods(p.id, { reference: "GRN-RACE", deliveryDate: "2026-01-05", receivedBy: null, notes: null }, [{ poLineId: ls[0].id, qty: 1, serials: [] }]),
    ]);
    const [after] = await d.select().from(purchaseOrders).where(eq(purchaseOrders.id, p.id));
    const received = (await d.select().from(poLines).where(eq(poLines.id, ls[0].id)))[0].receivedQty;
    expect(Boolean(cancel?.message) !== receipt.ok).toBe(true);
    expect(after.status === "CANCELLED" ? received : 1).toBe(after.status === "CANCELLED" ? 0 : received);
  });
});

describe("manual PO status changes (DL-14)", () => {
  it("refuses a change made from a status the order no longer has", async () => {
    const { setPoStatus } = await import("../../app/procurement/purchase-orders/actions");
    const { p } = await po("ACKNOWLEDGED", [{ qty: 2, price: 100 }]);
    // The page still showed "Issued" when the user clicked "Cancel order".
    const res = await setPoStatus(null, form({ poId: p.id, status: "CANCELLED", from: "ISSUED" }));
    expect(res?.errors?.join(" ")).toMatch(/changed this purchase order a moment ago/);
    expect((await d.select().from(purchaseOrders).where(eq(purchaseOrders.id, p.id)))[0].status).toBe("ACKNOWLEDGED");
    expect((await setPoStatus(null, form({ poId: p.id, status: "CANCELLED", from: "ACKNOWLEDGED" })))?.message).toMatch(/cancelled/);
  });

  it("two clicks at once change the status once", async () => {
    const { setPoStatus } = await import("../../app/procurement/purchase-orders/actions");
    const { p } = await po("DELIVERED", [{ qty: 1, price: 100, received: 1 }]);
    const res = await Promise.all([1, 2].map(() => setPoStatus(null, form({ poId: p.id, status: "CLOSED" }))));
    expect(res.filter((r) => r?.message)).toHaveLength(1);
  });
});

describe("ordering and invoicing at the same time (DL-15)", () => {
  it("two orders raised at once can't order more than the offer", async () => {
    const { createPurchaseOrder } = await import("../../app/procurement/purchase-orders/actions");
    const { o, ls } = await awardedOffer([{ qty: 3, price: "100.00" }]);
    const f = () => form({ [`include_${ls[0].id}`]: "on", [`qty_${ls[0].id}`]: 2 });
    const res = await Promise.all([1, 2].map(() => createPurchaseOrder(o.id, null, f()).catch((e: Error) => ({ redirected: e.message }))));
    expect(await orderedOf(ls[0].id)).toBeLessThanOrEqual(3);
    expect(res.filter((r) => r && "redirected" in r)).toHaveLength(1);
  });

  it("two draft edits at once can't take an offer line past what was offered", async () => {
    const { createPurchaseOrder, updatePurchaseOrder } = await import("../../app/procurement/purchase-orders/actions");
    const { o, ls } = await awardedOffer([{ qty: 4, price: "100.00" }]);
    const ids: number[] = [];
    for (let i = 0; i < 2; i++) ids.push(await createPurchaseOrder(o.id, null, form({ [`include_${ls[0].id}`]: "on", [`qty_${ls[0].id}`]: 1 })).then(() => 0, poIdOf));
    const lineOf = async (poId: number) => (await d.select().from(poLines).where(eq(poLines.poId, poId)))[0].id;
    const [a, b] = [await lineOf(ids[0]), await lineOf(ids[1])];
    await Promise.all([updatePurchaseOrder(ids[0], null, form({ [`qty_${a}`]: 3 })), updatePurchaseOrder(ids[1], null, form({ [`qty_${b}`]: 3 }))]);
    expect(await orderedOf(ls[0].id)).toBeLessThanOrEqual(4);
  });

  it("two invoices saved at once: the second one is not marked as matching", async () => {
    const { createInvoiceAction } = await import("../../app/procurement/invoices/actions");
    const { p, ls } = await po("DELIVERED", [{ qty: 2, price: 100, received: 2 }]);
    const f = (no: string) => form({ poId: p.id, supplierInvoiceNo: no, invoiceDate: "2026-01-10", [`qty_${ls[0].id}`]: 2, [`price_${ls[0].id}`]: 100 });
    await Promise.all([createInvoiceAction({}, f("R-1")), createInvoiceAction({}, f("R-2"))].map((x) => x.catch((e: Error) => { if (!e.message.startsWith("redirect:")) throw e; })));
    const rows = await d.select().from(invoices).where(eq(invoices.poId, p.id));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status).sort()).toEqual(["EXCEPTION", "MATCHED"]);
  });
});

describe("PO prices from an offer (DL-10)", () => {
  it("adds up to the offer's line total when the discount leaves half a cent per unit", async () => {
    const { createPurchaseOrder } = await import("../../app/procurement/purchase-orders/actions");
    const { lineTotal } = await import("../format");
    // 2 × 100.05 at 50 % off: the offer says 100.05; 2 × 50.03 (the rounded unit price) would be 100.06.
    const { o, ls } = await awardedOffer([{ qty: 2, price: "100.05", discount: 50 }, { qty: 3, price: "10.01", discount: 15 }]);
    const id = await createPurchaseOrder(o.id, null, form({ [`include_${ls[0].id}`]: "on", [`qty_${ls[0].id}`]: 2, [`include_${ls[1].id}`]: "on", [`qty_${ls[1].id}`]: 3 })).then(() => 0, poIdOf);
    const lines = await d.select().from(poLines).where(eq(poLines.poId, id));
    const total = lines.reduce((s, l) => s + l.quantity * Number(l.unitPrice), 0);
    expect(Math.round(total * 100)).toBe(Math.round((lineTotal(2, "100.05", 50) + lineTotal(3, "10.01", 15)) * 100));
    expect(lines.filter((l) => l.offerLineId === ls[0].id).map((l) => [l.quantity, l.unitPrice])).toEqual([[1, "50.02"], [1, "50.03"]]);
  });
});
