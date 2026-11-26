/**
 * Wave 39: "Start a tender from this BOQ" and plan vs ordered, and the data quality loader, against an in-memory PGlite
 * database with the real migrations. Sign-in and the activity log are stubbed.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";

const h = vi.hoisted(() => ({ d: null as unknown as DB, n: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/server-utils", () => ({ logActivity: async () => {}, nextNumber: async (p: string) => `${p}-2026-${String(++h.n).padStart(4, "0")}` }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: async () => ({ id: 1, name: "Tester", role: "ADMIN" }), requireFacilityAccess: async () => {} }));
vi.mock("@/lib/auth/permissions", () => import("../auth/permissions"));
vi.mock("@/lib/boq/tender-handoff", () => import("./tender-handoff"));
vi.mock("@/lib/boq/tender-server", () => import("./tender-server"));
vi.mock("@/lib/procurement/forms", () => import("../procurement/forms"));
vi.mock("@/lib/procurement/spec-items", () => import("../procurement/spec-items"));
vi.mock("@/lib/data-quality", () => import("../data-quality"));

const { assets, boqLines, boqs, deviceTypes, facilities, offerLines, offers, poLines, projects, purchaseOrders, rfqLines, rfqs, standardSets, suppliers, techSpecs } = schema;
let client: PGlite;
let d: DB;
let facilityId = 0, typeA = 0, typeB = 0, boqId = 0, supplierId = 0;
const lineIds: number[] = [];

const form = (o: Record<string, string | number | (string | number)[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, String(x));
  return f;
};

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
  h.d = d;
  await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
  [{ id: facilityId }] = await d.insert(facilities).values({ code: "TST", name: "Test hospital" }).returning({ id: facilities.id });
  [{ id: supplierId }] = await d.insert(suppliers).values({ name: "Test supplier" }).returning({ id: suppliers.id });
  [{ id: typeA }] = await d.insert(deviceTypes).values({ code: "MON-PAT-HIGH", level: 3, name: "Monitor" }).returning({ id: deviceTypes.id });
  [{ id: typeB }] = await d.insert(deviceTypes).values({ code: "LIF-VEN-ICU", level: 3, name: "Ventilator" }).returning({ id: deviceTypes.id });
  const [set] = await d.insert(standardSets).values({ code: "T", name: "Test set" }).returning();
  [{ id: boqId }] = await d.insert(boqs).values({ name: "Wing B", facilityId, standardSetId: set.id, status: "APPROVED" }).returning({ id: boqs.id });
  const ls = await d.insert(boqLines).values([
    { boqId, deviceTypeId: typeA, quantity: 10 }, { boqId, deviceTypeId: typeA, quantity: 4 }, { boqId, deviceTypeId: typeB, quantity: 3 },
  ]).returning({ id: boqLines.id });
  lineIds.push(...ls.map((l) => l.id));
}, 180_000);

afterAll(async () => { await client?.close(); });

describe("start a tender from a BOQ", () => {
  it("creates the project, links the BOQ, makes a draft RFQ with grouped items and draft specs", async () => {
    const { startTenderFromBoq } = await import("../../app/boq/tender-actions");
    await expect(startTenderFromBoq(null, form({ boqId, projectMode: "new", code: "T-2026-01", title: "Wing B", rfqTitle: "RFQ Wing B", group: typeA, line: lineIds[2], makeSpecs: "on" })))
      .rejects.toThrow(/redirect:\/procurement\/rfqs\/\d+/);
    const [p] = await d.select().from(projects).where(eq(projects.code, "T-2026-01"));
    expect(p.facilityId).toBe(facilityId);
    expect((await d.select().from(boqs).where(eq(boqs.id, boqId)))[0].projectId).toBe(p.id);
    const [r] = await d.select().from(rfqs).where(eq(rfqs.projectId, p.id));
    expect(r).toMatchObject({ status: "DRAFT", boqId });
    const items = await d.select().from(rfqLines).where(eq(rfqLines.rfqId, r.id)).orderBy(rfqLines.sortOrder);
    expect(items.map((i) => [i.deviceTypeId, i.quantity, i.boqLineIds])).toEqual([[typeB, 3, [lineIds[2]]], [typeA, 14, [lineIds[0], lineIds[1]]]]);
    expect((await d.select().from(techSpecs).where(eq(techSpecs.projectId, p.id))).length).toBe(2);
  });

  it("refuses an empty pick and a taken code", async () => {
    const { startTenderFromBoq } = await import("../../app/boq/tender-actions");
    expect((await startTenderFromBoq(null, form({ boqId, projectMode: "new", code: "X", title: "X", rfqTitle: "R" })))?.errors?.[0]).toMatch(/Tick at least one/);
    expect((await startTenderFromBoq(null, form({ boqId, projectMode: "new", code: "T-2026-01", title: "X", rfqTitle: "R", line: lineIds[0] })))?.fields?.code).toBeTruthy();
  });

  it("shows plan vs ordered from the RFQ's offers and orders", async () => {
    const { boqPlanVsOrdered } = await import("./tender-server");
    const [r] = await d.select().from(rfqs).where(eq(rfqs.boqId, boqId));
    const [o] = await d.insert(offers).values({ projectId: r.projectId, rfqId: r.id, supplierId, reference: "Q1", offerDate: "2026-11-01" }).returning();
    const [ol] = await d.insert(offerLines).values({ offerId: o.id, boqLineId: lineIds[0], deviceTypeId: typeA, description: "Monitor", quantity: 8, unitPrice: "100.00" }).returning();
    const [po] = await d.insert(purchaseOrders).values({ number: "PO-T-1", supplierId, facilityId, offerId: o.id, status: "ISSUED" }).returning();
    await d.insert(poLines).values({ poId: po.id, offerLineId: ol.id, deviceTypeId: typeA, description: "Monitor", quantity: 8, unitPrice: "100.00", receivedQty: 2 });
    const { rows, rfqs: list } = await boqPlanVsOrdered(boqId);
    expect(list.length).toBe(1);
    expect(rows.find((x) => x.deviceTypeId === typeA)).toMatchObject({ planned: 14, inTender: 14, ordered: 8, received: 2, toOrder: 6 });
    expect(rows.find((x) => x.deviceTypeId === typeB)).toMatchObject({ planned: 3, inTender: 3, ordered: 0, toOrder: 3 });
  });
});

describe("data quality loader", () => {
  it("reads devices and orders and the rules find them", async () => {
    const { loadDqData } = await import("../data-quality-server");
    const { evaluate } = await import("../data-quality");
    await d.insert(assets).values([
      { assetTag: "TST-1", deviceTypeId: typeA, facilityId, status: "OUT_OF_SERVICE", serialNumber: "S1", manufacturer: "Acme" },
      { assetTag: "TST-2", deviceTypeId: typeA, facilityId, status: "IN_SERVICE", serialNumber: "s-1", manufacturer: "acme" },
    ]);
    const { data, cut } = await loadDqData(facilityId, null, "2026-11-26", true);
    expect(cut).toEqual([]);
    const res = new Map(evaluate(data, "2026-11-26").map((r) => [r.rule.id, r.hits.map((x) => x.label)]));
    expect(res.get("duplicate-serial")?.sort()).toEqual(["TST-1", "TST-2"]);
    expect(res.get("down-no-job")).toEqual(["TST-1"]);
    expect(res.get("no-gmdn")?.length).toBe(2);
    expect((await loadDqData(null, [], "2026-11-26", true)).data.assets).toEqual([]);
  });
});
