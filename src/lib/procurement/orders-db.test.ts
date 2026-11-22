/**
 * Wave 33 (audit wave 30): framework call-off limits on PO edits (DL-04), invoice lines of another PO (DL-08),
 * budget use of cancelled and closed-short POs (DL-09, B3) and "Register missing assets" twice (DL-12).
 * Runs the real actions against an in-memory PGlite database with the real migrations; sign-in, activity log and
 * notifications are stubbed. Vitest has no "@/" alias, so each "@/…" module the code imports is mapped here.
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

const { assets, budgetLines, deliveries, deliveryLines, deviceTypes, facilities, frameworkItems, frameworks, invoiceLines, invoices, poLines, purchaseOrders, suppliers } = schema;
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
  [{ id: supplierId }] = await d.insert(suppliers).values({ name: "Test supplier" }).returning({ id: suppliers.id });
  [{ id: facilityId }] = await d.insert(facilities).values({ code: "TST", name: "Test hospital" }).returning({ id: facilities.id });
  [{ id: typeId }] = await d.insert(deviceTypes).values({ code: "PMP-TEST-X", level: 3, name: "Test pump" }).returning({ id: deviceTypes.id });
}, 180_000);

afterAll(async () => { await client?.close(); });

describe("framework call-off limits on PO edits (DL-04)", () => {
  it("refuses a draft quantity that takes the item past its limit or the agreement past its ceiling", async () => {
    const { updatePurchaseOrder } = await import("../../app/procurement/purchase-orders/actions");
    const [fw] = await d.insert(frameworks).values({ number: "FA-T-1", title: "Pumps", supplierId, startDate: "2000-01-01", endDate: "2100-12-31", ceiling: "10000.00", currency: "EGP" }).returning();
    await d.insert(frameworkItems).values({ frameworkId: fw.id, deviceTypeId: typeId, description: "Pump", unitPrice: "1000.00", maxQty: 5 });
    await po("ISSUED", [{ qty: 2, price: 1000 }], { frameworkId: fw.id });
    const { p, ls } = await po("DRAFT", [{ qty: 2, price: 1000 }], { frameworkId: fw.id });

    const over = await updatePurchaseOrder(p.id, null, form({ [`qty_${ls[0].id}`]: 4 }));
    expect(over?.errors?.join(" ")).toMatch(/Pump: 6 would exceed the 5 agreed/);
    expect((await d.select().from(poLines).where(eq(poLines.id, ls[0].id)))[0].quantity).toBe(2);
    expect(await updatePurchaseOrder(p.id, null, form({ [`qty_${ls[0].id}`]: 3 }))).toEqual({ message: "Saved." });

    // Within limits it saves; the other call-off isn't counted twice.
    await d.update(frameworkItems).set({ maxQty: null }).where(eq(frameworkItems.frameworkId, fw.id));
    expect(await updatePurchaseOrder(p.id, null, form({ [`qty_${ls[0].id}`]: 8 }))).toEqual({ message: "Saved." });
    const ceiling = await updatePurchaseOrder(p.id, null, form({ [`qty_${ls[0].id}`]: 9 }));
    expect(ceiling?.errors?.join(" ")).toMatch(/over its ceiling/);
    expect((await d.select().from(poLines).where(eq(poLines.id, ls[0].id)))[0].quantity).toBe(8);
  });
});

describe("invoice lines (DL-08)", () => {
  it("refuses a line that belongs to another purchase order", async () => {
    const { createInvoiceAction } = await import("../../app/procurement/invoices/actions");
    const a = await po("DELIVERED", [{ qty: 2, price: 100, received: 2 }]);
    const b = await po("DELIVERED", [{ qty: 2, price: 100, received: 2 }]);
    const res = await createInvoiceAction({}, form({
      poId: a.p.id, supplierInvoiceNo: "S-1", invoiceDate: "2026-01-10",
      [`qty_${a.ls[0].id}`]: 1, [`price_${a.ls[0].id}`]: 100, [`qty_${b.ls[0].id}`]: 2, [`price_${b.ls[0].id}`]: 100,
    })).catch((e: Error) => ({ error: e.message }));
    expect(res?.error).toMatch(/must be a line of/);
    expect(await d.select().from(invoiceLines).where(eq(invoiceLines.poLineId, b.ls[0].id))).toHaveLength(0);
  });
});

describe("budget use (DL-09, B3)", () => {
  it("keeps a cancelled PO's paid invoice as spent and commits only the received value of a PO closed short", async () => {
    const { budgetRows } = await import("./money-server");
    const [line] = await d.insert(budgetLines).values({ facilityId, year: 2026, name: "Test line", amount: "100000.00", currency: "EGP" }).returning();
    const cancelled = await po("CANCELLED", [{ qty: 4, price: 1000 }], { budgetLineId: line.id });
    const [inv] = await d.insert(invoices).values({ number: "INV-T-1", supplierInvoiceNo: "S-9", poId: cancelled.p.id, supplierId, invoiceDate: "2026-01-01", currency: "EGP", status: "PAID" }).returning();
    await d.insert(invoiceLines).values({ invoiceId: inv.id, poLineId: cancelled.ls[0].id, quantity: 1, unitPrice: "1000.00" });
    await po("CLOSED", [{ qty: 10, price: 500, received: 4 }], { budgetLineId: line.id }); // 5000 ordered, 2000 received

    const [row] = await budgetRows([line]);
    expect(row.spent).toBe(1000);
    expect(row.committed).toBe(2000);
  });
});

describe("register missing assets (DL-12)", () => {
  it("creates each received unit's asset once, even when clicked twice at the same time", async () => {
    const { createMissingAssets } = await import("./receiving");
    const { ls, p } = await po("DELIVERED", [{ qty: 3, price: 100, received: 3 }]);
    const [dl] = await d.insert(deliveries).values({ poId: p.id, reference: "GRN-T-1", deliveryDate: "2026-01-05" }).returning();
    await d.insert(deliveryLines).values({ deliveryId: dl.id, poLineId: ls[0].id, quantity: 3, serialNumbers: [] });

    const made = await Promise.all([createMissingAssets(dl.id), createMissingAssets(dl.id)]);
    expect(made[0] + made[1]).toBe(3);
    expect(await d.select().from(assets).where(eq(assets.poLineId, ls[0].id))).toHaveLength(3);
    expect(await createMissingAssets(dl.id)).toBe(0);
  });
});
