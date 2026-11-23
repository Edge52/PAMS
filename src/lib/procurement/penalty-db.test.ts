/**
 * Wave 37: the late-delivery penalty of a purchase order from its goods receipts, and Finance deducting it on an
 * invoice. Real actions against in-memory PGlite with the real migrations; sign-in and the activity log are stubbed
 * (as in duties-db.test.ts). Skipped until the migration with the wave 37 columns exists (the lead generates it).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";

const MIGRATIONS = path.resolve(__dirname, "..", "..", "..", "drizzle");
const ready = readdirSync(MIGRATIONS).some((f) => f.endsWith(".sql") && readFileSync(path.join(MIGRATIONS, f), "utf8").includes("\"delay_penalty_rate_pct\""));

type Me = { id: number; name: string; role: string; scope: number[] | null };
const h = vi.hoisted(() => ({ d: null as unknown as DB, me: { id: 1, name: "Finance", role: "FINANCE", scope: null } as Me }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/audit-diff", () => import("../audit-diff"));
vi.mock("@/lib/settings", () => import("../settings"));
vi.mock("@/lib/server-utils", () => ({ logActivity: async () => {}, nextNumber: async (p: string) => `${p}-${Math.random().toString(36).slice(2, 10)}` }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: async () => h.me, requireFacilityAccess: async () => {} }));
vi.mock("@/lib/notifications", () => ({ notifyRole: async () => {} }));
vi.mock("@/lib/procurement/budget-year-server", () => ({ budgetYear: async () => ({ startMonth: 7, current: 2026, label: (y: number) => `FY ${y}` }) })); // wave 38
vi.mock("@/lib/procurement/server", () => ({ fxFactors: async (cs: string[]) => Object.fromEntries(cs.map((c) => [c, 1])) }));
vi.mock("@/lib/procurement/money", () => import("./money"));
vi.mock("@/lib/procurement/money-server", () => import("./money-server"));
vi.mock("@/lib/procurement/delay-penalty", () => import("./delay-penalty"));
vi.mock("@/lib/procurement/penalty-server", () => import("./penalty-server"));

describe.skipIf(!ready)("delay penalty on a purchase order and its invoices (wave 37)", () => {
  let client: PGlite;
  let d: DB;
  let poId = 0, lineId = 0, invId = 0, inv2Id = 0;
  const { deliveries, deliveryLines, deviceTypes, facilities, invoiceLines, invoices, poLines, purchaseOrders, suppliers } = schema;
  const form = (o: Record<string, string | number>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, String(v)); return f; };

  beforeAll(async () => {
    client = new PGlite();
    d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
    h.d = d;
    await migrate(d as never, { migrationsFolder: MIGRATIONS });
    const [{ id: supplierId }] = await d.insert(suppliers).values({ name: "Late supplier" }).returning({ id: suppliers.id });
    const [{ id: facilityId }] = await d.insert(facilities).values({ code: "TPN", name: "Penalty hospital" }).returning({ id: facilities.id });
    const [{ id: typeId }] = await d.insert(deviceTypes).values({ code: "MON-PEN-X", level: 3, name: "Monitor" }).returning({ id: deviceTypes.id });
    [{ id: poId }] = await d.insert(purchaseOrders).values({ number: "PO-T-1", supplierId, facilityId, status: "PARTIALLY_DELIVERED", currency: "USD", expectedDelivery: "2026-10-01", delayPenaltyRatePct: 1, delayPenaltyCapPct: 15 }).returning({ id: purchaseOrders.id });
    [{ id: lineId }] = await d.insert(poLines).values({ poId, deviceTypeId: typeId, description: "Monitor", quantity: 10, unitPrice: "1000.00", receivedQty: 10 }).returning({ id: poLines.id });
    const [d1] = await d.insert(deliveries).values({ poId, reference: "DN-1", deliveryDate: "2026-09-30" }).returning();
    const [d2] = await d.insert(deliveries).values({ poId, reference: "DN-2", deliveryDate: "2026-10-16" }).returning();
    await d.insert(deliveryLines).values([{ deliveryId: d1.id, poLineId: lineId, quantity: 6 }, { deliveryId: d2.id, poLineId: lineId, quantity: 4 }]);
    for (const [no, qty] of [["S-1", 6], ["S-2", 4]] as const) {
      const [i] = await d.insert(invoices).values({ number: `INV-T-${no}`, supplierInvoiceNo: no, poId, supplierId, invoiceDate: "2026-10-20", currency: "USD", status: "MATCHED", createdByName: "Clerk" }).returning({ id: invoices.id });
      await d.insert(invoiceLines).values({ invoiceId: i.id, poLineId: lineId, quantity: qty, unitPrice: "1000.00" });
      if (no === "S-1") invId = i.id; else inv2Id = i.id;
    }
  }, 180_000);
  afterAll(async () => { await client?.close(); });

  it("charges only the late delivery: 4 units, 15 days late = 3 weeks × 1 %", async () => {
    const { poDelayPenalty } = await import("./penalty-server");
    const p = await poDelayPenalty(poId, { asOf: "2026-11-01" });
    expect(p?.amount).toBe(120);
    expect(p?.ownTerms).toBe(true);
    expect(p?.deducted).toBe(0);
  });

  it("deducts it on one invoice, refuses to deduct it twice, and stores the calculation", async () => {
    const { setInvoicePenaltyAction } = await import("../../app/procurement/invoices/actions");
    expect(await setInvoicePenaltyAction(null, form({ invoiceId: invId, delayPenalty: "120" }))).toMatchObject({ ok: expect.stringContaining("deducted") });
    const [row] = await d.select().from(invoices).where(eq(invoices.id, invId));
    expect(row.delayPenalty).toBe("120.00");
    expect(row.delayPenaltyNote).toContain("4 × Monitor: delivered 2026-10-16, 15 days late = 3 weeks × 1 % = 3 %");
    const twice = await setInvoicePenaltyAction(null, form({ invoiceId: inv2Id, delayPenalty: "50" }));
    expect(twice?.error).toMatch(/left to deduct on this order is 0.00/);
    // 0 removes it, and then the other invoice may take it.
    await setInvoicePenaltyAction(null, form({ invoiceId: invId, delayPenalty: "0" }));
    expect((await d.select().from(invoices).where(eq(invoices.id, invId)))[0].delayPenalty).toBeNull();
    expect(await setInvoicePenaltyAction(null, form({ invoiceId: inv2Id, delayPenalty: "120" }))).toMatchObject({ ok: expect.any(String) });
  });

  it("won't change an approved invoice", async () => {
    const { setInvoicePenaltyAction } = await import("../../app/procurement/invoices/actions");
    await d.update(invoices).set({ status: "APPROVED" }).where(eq(invoices.id, invId));
    expect((await setInvoicePenaltyAction(null, form({ invoiceId: invId, delayPenalty: "10" })))?.error).toMatch(/already decided/);
  });
});
