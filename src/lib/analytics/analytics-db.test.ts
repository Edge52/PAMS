/**
 * Wave 40: the Cost and Procurement analytics queries against in-memory PGlite with the real migrations. Sign-in
 * is stubbed; exchange rates come from the database (rate on each date).
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";
import { FxTable } from "../fx";

const MIGRATIONS = path.resolve(__dirname, "..", "..", "..", "drizzle");
const h = vi.hoisted(() => ({ d: null as unknown as DB }));

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/assets/dates", () => import("../assets/dates"));
vi.mock("@/lib/assets/planning", () => import("../assets/planning"));
vi.mock("@/lib/reports/service-cost", () => import("../reports/service-cost"));
vi.mock("@/lib/auth/session", () => ({ facilityScope: async () => null, requireFacilityAccess: async () => {} }));
vi.mock("@/lib/server-utils", async () => {
  const s = await import("../../db/schema");
  const loadFx = async () => new FxTable((await h.d.select().from(s.exchangeRates)).map((r) => ({ currency: r.currency, rateToEgp: Number(r.rateToEgp), effectiveDate: r.effectiveDate })));
  return { loadFx, rateToEgp: async (c: string) => (c === "EGP" ? 1 : (await loadFx()).rateOn(c, "2099-01-01")?.rate ?? null) };
});

describe("analytics cost and procurement queries (wave 40)", () => {
  let client: PGlite;
  let facilityId = 0, supplierId = 0, typeId = 0, catId = 0, projectId = 0;
  const f = () => ({ facilityId: null, departmentId: null, deviceTypeId: null, from: "2026-01-01", to: "2026-11-26" });

  beforeAll(async () => {
    client = new PGlite();
    const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
    h.d = d;
    await migrate(d as never, { migrationsFolder: MIGRATIONS });
    const s = schema;
    await d.insert(s.exchangeRates).values([{ currency: "USD", rateToEgp: "30", effectiveDate: "2025-01-01" }, { currency: "USD", rateToEgp: "50", effectiveDate: "2026-01-01" }]);
    [{ id: facilityId }] = await d.insert(s.facilities).values({ code: "TAN", name: "Analytics hospital" }).returning({ id: s.facilities.id });
    const [dep] = await d.insert(s.departments).values({ facilityId, code: "RAD", name: "Radiology" }).returning();
    [{ id: supplierId }] = await d.insert(s.suppliers).values({ name: "Acme Medical" }).returning({ id: s.suppliers.id });
    [{ id: catId }] = await d.insert(s.deviceTypes).values({ code: "T-CAT", level: 1, name: "Monitoring" }).returning({ id: s.deviceTypes.id });
    const [grp] = await d.insert(s.deviceTypes).values({ code: "T-GRP", level: 2, name: "Patient monitors", parentId: catId }).returning();
    [{ id: typeId }] = await d.insert(s.deviceTypes).values({ code: "T-MON", level: 3, name: "Monitor", parentId: grp.id }).returning({ id: s.deviceTypes.id });
    [{ id: projectId }] = await d.insert(s.projects).values({ code: "T-P1", title: "Monitors", facilityId, currency: "USD" }).returning({ id: s.projects.id });

    // Six earlier orders at about 1,000 USD, one each month, and their deliveries (the first one late).
    for (let i = 1; i <= 6; i++) {
      const [po] = await d.insert(s.purchaseOrders).values({ number: `PO-T-${i}`, supplierId, facilityId, status: "DELIVERED", currency: "USD", issueDate: `2026-0${i}-01`, expectedDelivery: `2026-0${i}-20` }).returning();
      const [line] = await d.insert(s.poLines).values({ poId: po.id, deviceTypeId: typeId, description: "Monitor", manufacturer: "Acme", model: "M1", quantity: 2, unitPrice: String(1000 + i * 5), receivedQty: 2, destinationDepartmentId: dep.id }).returning();
      await d.insert(s.deliveries).values({ poId: po.id, reference: `DN-${i}`, deliveryDate: i === 1 ? "2026-01-30" : `2026-0${i}-15` });
      if (i === 1) {
        const [inv] = await d.insert(s.invoices).values({ number: "INV-T-1", supplierInvoiceNo: "S1", poId: po.id, supplierId, invoiceDate: "2026-02-05", currency: "USD", status: "APPROVED", delayPenalty: "20" }).returning();
        await d.insert(s.invoiceLines).values({ invoiceId: inv.id, poLineId: line.id, quantity: 2, unitPrice: "1005" });
        const [a] = await d.insert(s.assets).values({ assetTag: "TAN-MON-1", deviceTypeId: typeId, facilityId, supplierId, poLineId: line.id, status: "IN_SERVICE", installDate: "2026-02-01", purchaseCost: "1005", currency: "USD" }).returning();
        await d.insert(s.workOrders).values({ number: "WO-T-1", assetId: a.id, facilityId, title: "No display", reportedAt: new Date("2026-03-01T08:00:00Z"), startedAt: new Date("2026-03-01T12:00:00Z") });
        const [c] = await d.insert(s.serviceContracts).values({ number: "SC-T-1", facilityId, supplierId, title: "Monitors", startDate: "2026-01-01", endDate: "2026-12-31", uptimePct: 95 }).returning();
        await d.insert(s.serviceContractAssets).values({ contractId: c.id, assetId: a.id });
      }
    }
    // An RFQ with one bid that is far above the earlier prices, and an RFQ with none.
    const [rfq] = await d.insert(s.rfqs).values({ projectId, number: "RFQ-T-1", title: "Monitors", status: "CLOSED", issueDate: "2026-07-01" }).returning();
    await d.insert(s.rfqLines).values({ rfqId: rfq.id, deviceTypeId: typeId, quantity: 2 });
    const [o] = await d.insert(s.offers).values({ projectId, rfqId: rfq.id, supplierId, reference: "Q-1", offerDate: "2026-07-10", currency: "USD", status: "AWARDED", awardApprovedOn: "2026-08-30" }).returning();
    await d.insert(s.offerLines).values({ offerId: o.id, deviceTypeId: typeId, description: "Monitor", manufacturer: "Acme", model: "M1", quantity: 2, unitPrice: "3000" });
    await d.insert(s.rfqs).values({ projectId, number: "RFQ-T-2", title: "Spare", status: "CLOSED", issueDate: "2026-07-02" });
  }, 180_000);
  afterAll(async () => { await client?.close(); });

  it("sums spend in EGP at each order's rate, by top category", async () => {
    const { loadSpend } = await import("./cost-server");
    const { groupSpend } = await import("./spend");
    const s = await loadSpend(f(), [facilityId], "po");
    expect(s.missing).toEqual([]);
    const cat = groupSpend(s.lines, "category");
    expect(cat).toHaveLength(1);
    expect(cat[0]).toMatchObject({ label: "Monitoring", id: catId });
    expect(cat[0].egp).toBe((1005 + 1010 + 1015 + 1020 + 1025 + 1030) * 2 * 50);
    expect((await loadSpend({ ...f(), deviceTypeId: catId }, [facilityId], "po")).lines.length).toBeGreaterThan(0);
    expect((await loadSpend(f(), [], "po")).lines).toEqual([]);
    const inv = await loadSpend(f(), [facilityId], "invoice");
    expect(groupSpend(inv.lines, "supplier")[0].egp).toBe(2010 * 50);
  });

  it("reads COSR from the service cost report", async () => {
    const { cosrByType } = await import("./cost-server");
    const c = await cosrByType(f(), [facilityId], "2026-11-26");
    expect(c.rows[0]).toMatchObject({ type: "Monitor", devices: 1 });
  });

  it("counts bids, no-offer RFQs and decision time", async () => {
    const { loadTenderUnits } = await import("./procurement-server");
    const { competition } = await import("./procurement");
    const units = await loadTenderUnits(f(), [facilityId], "2026-11-26");
    const c = competition(units);
    expect([c.units, c.singleBid, c.noBids]).toEqual([2, 1, 1]);
    expect(c.decisionDays).toEqual([60]);
    expect(units.find((u) => u.bids === 1)?.categories).toEqual(["Monitoring"]);
  });

  it("flags the offer well above earlier prices, also for the comparison", async () => {
    const { loadPrices, offerPriceFlags } = await import("./procurement-server");
    const p = await loadPrices(f(), [facilityId]);
    expect(p.paid).toHaveLength(7); // six orders and the awarded offer with no order yet (never compared with itself)
    expect(p.flags).toHaveLength(1);
    expect(p.flags[0].point.egp).toBe(150_000);
    const byOffer = await offerPriceFlags(projectId, [facilityId], "2026-11-26");
    expect([...byOffer.values()].flat()).toHaveLength(1);
  });

  it("scores the supplier from deliveries, penalties, faults, contracts and response", async () => {
    const { loadSupplierFacts } = await import("./procurement-server");
    const { supplierScores } = await import("./procurement");
    const facts = await loadSupplierFacts(f(), [facilityId], "2026-11-26");
    const [s] = supplierScores(facts);
    expect(s).toMatchObject({ name: "Acme Medical", n: 6, penaltyCount: 1, penaltyEgp: 1000, devicesInstalled: 1, earlyFaultShare: 1, uptimeOf: 1, awards: 1, rank: 1 });
    expect(s.onTimeShare).toBeCloseTo(5 / 6);
    expect(s.medianResponseH).toBeNull(); // the job was not raised under the contract
  });
});
