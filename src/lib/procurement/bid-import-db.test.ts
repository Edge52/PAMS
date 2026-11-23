/**
 * Wave 38: saving a checked Excel bid (new offer, then a re-import replacing its lines and answers, and the lock once
 * the offer is shortlisted), and the Arabic legal names. Real code against in-memory PGlite with the real migrations.
 *
 * The legal-name part needs the migration that creates `supplier_legal_names`: skipped until drizzle/ has one (the
 * lead generates it on merge). The bid part uses existing tables only and always runs.
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";
import { validateBid, type RawBid, type TemplateLine } from "./bid-import";

const folder = path.resolve(__dirname, "..", "..", "..", "drizzle");
const namesReady = fs.readdirSync(folder).some((f) => f.endsWith(".sql") && fs.readFileSync(path.join(folder, f), "utf8").includes("\"supplier_legal_names\""));

const h = vi.hoisted(() => ({ d: null as unknown as DB, log: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/server-utils", () => ({ logActivity: async (_t: string, _id: number, action: string, summary: string) => { h.log.push(`${action}: ${summary}`); } }));
vi.mock("./server", () => ({ advanceProject: async () => {}, recomputeOfferScores: async () => {}, evaluationLock: async () => null, projectSpecs: async () => new Map(), rfqLines: async () => [] }));

const { deviceTypes, offerCompliance, offerLines, offers, projects, rfqs, rfqSuppliers, specItems, suppliers, techSpecs } = schema;
let client: PGlite; let d: DB;
let projectId = 0, rfqId = 0, supplierId = 0, ctId = 0, xrId = 0, slices = 0, power = 0, specCt = 0;
let lines: TemplateLine[] = [];

const raw = (price: number | string, extra: Partial<RawBid> = {}): RawBid => ({
  rfqTag: `rfq:${rfqId}`, supplierTag: `supplier:${supplierId}`,
  header: { reference: "Q-1", offerDate: "2026-11-20", validUntil: "2027-02-20", currency: "USD", incoterm: "CIF", paymentTerms: null },
  lines: [
    { row: 13, code: "T-CT", quantity: null, unitPrice: price, discountPct: 5, make: "GE", model: "Rev", country: "Japan", deliveryWeeks: 16, warrantyMonths: 24, remark: "Installation included" },
    { row: 14, code: "T-XR", quantity: null, unitPrice: 20000, discountPct: null, make: null, model: null, country: null, deliveryWeeks: 8, warrantyMonths: 12, remark: null },
  ],
  compliance: [
    { row: 2, code: "T-CT", specItemId: slices, answer: "Yes", offeredValue: "128", remark: null, pageRef: "4" },
    { row: 3, code: "T-XR", specItemId: power, answer: "Partial", offeredValue: "25 kW", remark: "32 kW option", pageRef: null },
  ],
  problems: [], ...extra,
});

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
  h.d = d;
  await migrate(d as never, { migrationsFolder: folder });
  [{ id: supplierId }] = await d.insert(suppliers).values({ name: "Nile Medical" }).returning({ id: suppliers.id });
  [{ id: projectId }] = await d.insert(projects).values({ code: "T-38", title: "Imaging tender", twoEnvelope: true }).returning({ id: projects.id });
  [{ id: rfqId }] = await d.insert(rfqs).values({ projectId, number: "RFQ-T-38", title: "Imaging", status: "ISSUED" }).returning({ id: rfqs.id });
  await d.insert(rfqSuppliers).values({ rfqId, supplierId });
  [{ id: ctId }] = await d.insert(deviceTypes).values({ code: "T-CT", level: 3, name: "CT scanner" }).returning({ id: deviceTypes.id });
  [{ id: xrId }] = await d.insert(deviceTypes).values({ code: "T-XR", level: 3, name: "Mobile X-ray" }).returning({ id: deviceTypes.id });
  [{ id: specCt }] = await d.insert(techSpecs).values({ projectId, deviceTypeId: ctId, title: "CT" }).returning({ id: techSpecs.id });
  const [{ id: specXr }] = await d.insert(techSpecs).values({ projectId, deviceTypeId: xrId, title: "X-ray" }).returning({ id: techSpecs.id });
  [{ id: slices }] = await d.insert(specItems).values({ specId: specCt, parameter: "Slices", requirement: "≥ 64", mandatory: true }).returning({ id: specItems.id });
  [{ id: power }] = await d.insert(specItems).values({ specId: specXr, parameter: "Power", requirement: "≥ 30 kW", mandatory: true }).returning({ id: specItems.id });
  lines = [
    { deviceTypeId: ctId, code: "T-CT", name: "CT scanner", quantity: 1, departments: [], boqLineIds: [], specItems: [{ id: slices, section: null, parameter: "Slices", requirement: "≥ 64", unit: null, mandatory: true }] },
    { deviceTypeId: xrId, code: "T-XR", name: "Mobile X-ray", quantity: 2, departments: [], boqLineIds: [], specItems: [{ id: power, section: null, parameter: "Power", requirement: "≥ 30 kW", unit: null, mandatory: true }] },
  ];
}, 180_000);
afterAll(async () => { await client?.close(); });

async function ctx() {
  const [rfq] = await d.select().from(rfqs).where(eq(rfqs.id, rfqId));
  const [project] = await d.select().from(projects).where(eq(projects.id, projectId));
  const specs = new Map([[ctId, { id: specCt }], [xrId, { id: specCt + 1 }]]);
  return { rfq, project, lines, specs, invited: [{ id: supplierId, name: "Nile Medical" }] } as never;
}

describe("saving an Excel bid", () => {
  it("creates a received offer with lines and compliance answers, logged without amounts", async () => {
    const { saveImportedBid } = await import("./bid-import-server");
    const check = validateBid(raw(450000), { rfqId, supplierId, lines });
    expect(check.errors).toEqual([]);
    const r = await saveImportedBid(await ctx(), { id: supplierId, name: "Nile Medical" }, check, "bid.xlsx", "Tester");
    expect("offerId" in r && r.created).toBe(true);
    const [o] = await d.select().from(offers).where(eq(offers.rfqId, rfqId));
    expect(o).toMatchObject({ status: "RECEIVED", reference: "Q-1", currency: "USD", incoterm: "CIF", deliveryWeeks: 16, warrantyMonths: 12, validUntil: "2027-02-20" });
    expect(o.notes).toContain("Imported from Excel (bid.xlsx)");
    const ls = await d.select().from(offerLines).where(eq(offerLines.offerId, o.id));
    expect(ls.map((l) => [l.deviceTypeId, l.quantity, l.unitPrice, l.discountPct]).sort()).toEqual([[ctId, 1, "450000.00", 5], [xrId, 2, "20000.00", 0]].sort());
    const cs = await d.select().from(offerCompliance);
    expect(cs.map((c) => c.status).sort()).toEqual(["COMPLIES", "PARTIAL"]);
    const [inv] = await d.select().from(rfqSuppliers).where(eq(rfqSuppliers.rfqId, rfqId));
    expect(inv.responded).toBe(true);
    expect(h.log.join("\n")).not.toMatch(/450|20,000|USD/);
  });

  it("a re-import replaces the lines and answers of the same offer", async () => {
    const { saveImportedBid } = await import("./bid-import-server");
    const one = raw(400000);
    one.lines = one.lines.slice(0, 1); one.compliance = one.compliance.slice(0, 1);
    const check = validateBid(one, { rfqId, supplierId, lines });
    const r = await saveImportedBid(await ctx(), { id: supplierId, name: "Nile Medical" }, check, "bid v2.xlsx", "Tester");
    expect("offerId" in r && r.created).toBe(false);
    const os = await d.select().from(offers).where(eq(offers.rfqId, rfqId));
    expect(os).toHaveLength(1);
    expect(os[0].notes?.match(/Imported from Excel/g)).toHaveLength(1);
    const ls = await d.select().from(offerLines).where(eq(offerLines.offerId, os[0].id));
    expect(ls.map((l) => l.unitPrice)).toEqual(["400000.00"]);
    expect(await d.select().from(offerCompliance)).toHaveLength(1);
  });

  it("won't replace a shortlisted offer", async () => {
    const { saveImportedBid } = await import("./bid-import-server");
    await d.update(offers).set({ status: "SHORTLISTED" }).where(eq(offers.rfqId, rfqId));
    const r = await saveImportedBid(await ctx(), { id: supplierId, name: "Nile Medical" }, validateBid(raw(1), { rfqId, supplierId, lines }), "x.xlsx", "Tester");
    expect("error" in r && r.error).toMatch(/already shortlisted/);
  });
});

describe.skipIf(!namesReady)("Arabic legal names (wave 38)", () => {
  it("sets, reads and removes a supplier's and a member's Arabic name", async () => {
    const m = await import("./legal-names-server");
    await m.setSupplierLegalName(supplierId, "شركة النيل");
    await m.setSupplierLegalName(supplierId, "شركة النيل الطبية");
    expect(await m.supplierLegalName(supplierId)).toBe("شركة النيل الطبية");
    await m.setSupplierLegalName(supplierId, null);
    expect(await m.supplierLegalName(supplierId)).toBeNull();
    const [c] = await d.insert(schema.committees).values({ projectId, kind: "OPENING" }).returning();
    const [mem] = await d.insert(schema.committeeMembers).values({ committeeId: c.id, name: "Omar" }).returning();
    await m.setMemberLegalName(mem.id, "عمر");
    expect((await m.memberLegalNamesFor([mem.id])).get(mem.id)).toBe("عمر");
    await d.delete(schema.committeeMembers).where(eq(schema.committeeMembers.id, mem.id));
    expect((await m.memberLegalNamesFor([mem.id])).size).toBe(0); // cascades with the member
  });
});
