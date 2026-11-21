/**
 * Audit wave 30, S1: a two-envelope tender's offer values and financial scores stay sealed on every list until the
 * financial envelopes are opened. Runs offerTotals / offerListRows against PGlite with the real migrations.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";
import { pricesSealed, sealOfferRows } from "./sealed";

const h = vi.hoisted(() => ({ d: null as unknown as DB }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/server-utils", () => ({ logActivity: async () => {}, convert: async (n: number) => n }));

const { deviceTypes, offerLines, offers, projects, suppliers } = schema;
let client: PGlite;
let d: DB;
let sealedOffer = 0, openOffer = 0, singleOffer = 0, sealedProject = 0;

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
  h.d = d;
  await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
  const [{ id: supplierId }] = await d.insert(suppliers).values({ name: "Test supplier" }).returning({ id: suppliers.id });
  const [{ id: typeId }] = await d.insert(deviceTypes).values({ code: "PMP-TEST-S", level: 3, name: "Test pump" }).returning({ id: deviceTypes.id });
  const project = async (code: string, twoEnvelope: boolean, financialOpenedAt: Date | null) =>
    (await d.insert(projects).values({ code, title: code, twoEnvelope, financialOpenedAt }).returning({ id: projects.id }))[0].id;
  const offer = async (projectId: number, ref: string) => {
    const [o] = await d.insert(offers).values({ projectId, supplierId, reference: ref, offerDate: "2026-01-01", financialScore: 88 }).returning({ id: offers.id });
    await d.insert(offerLines).values({ offerId: o.id, deviceTypeId: typeId, description: "Pump", quantity: 2, unitPrice: "1000.00" });
    return o.id;
  };
  sealedProject = await project("T-SEALED", true, null);
  sealedOffer = await offer(sealedProject, "S-1");
  openOffer = await offer(await project("T-OPEN", true, new Date()), "O-1");
  singleOffer = await offer(await project("T-SINGLE", false, null), "N-1");
}, 180_000);

afterAll(async () => { await client?.close(); });

describe("sealed financial envelopes (S1)", () => {
  it("pricesSealed: only a two-envelope tender with the financial envelopes not opened", () => {
    expect(pricesSealed({ twoEnvelope: true, financialOpenedAt: null })).toBe(true);
    expect(pricesSealed({ twoEnvelope: true, financialOpenedAt: new Date() })).toBe(false);
    expect(pricesSealed({ twoEnvelope: false, financialOpenedAt: null })).toBe(false);
    expect(pricesSealed(null)).toBe(false);
  });

  it("offerTotals leaves sealed offers out", async () => {
    const { offerTotals } = await import("./server");
    const t = await offerTotals([sealedOffer, openOffer, singleOffer]);
    expect(t.has(sealedOffer)).toBe(false);
    expect(t.get(openOffer)).toBe(2000);
    expect(t.get(singleOffer)).toBe(2000);
  });

  it("offerListRows hides the value and the financial score of sealed offers only", async () => {
    const { offerListRows } = await import("./server");
    const rows = await offerListRows([sealedOffer, openOffer, singleOffer].map((id) => ({ id, financialScore: 88 as number | null })));
    expect(rows.find((r) => r.id === sealedOffer)).toMatchObject({ sealed: true, total: null, financialScore: null });
    expect(rows.find((r) => r.id === openOffer)).toMatchObject({ sealed: false, total: 2000, financialScore: 88 });
    expect(rows.find((r) => r.id === singleOffer)).toMatchObject({ sealed: false, total: 2000, financialScore: 88 });
  });

  it("opening the financial envelopes shows the value", async () => {
    const { offerListRows } = await import("./server");
    await d.update(projects).set({ financialOpenedAt: new Date() }).where(eq(projects.id, sealedProject));
    const [r] = await offerListRows([{ id: sealedOffer, financialScore: 88 }]);
    expect(r).toMatchObject({ sealed: false, total: 2000, financialScore: 88 });
    await d.update(projects).set({ financialOpenedAt: null }).where(eq(projects.id, sealedProject));
  });

  it("sealOfferRows: no sealed list → values as before", () => {
    expect(sealOfferRows([{ id: 1, financialScore: 5 }], new Map([[1, 10]]), new Set())).toEqual([{ id: 1, financialScore: 5, total: 10, sealed: false }]);
    expect(sealOfferRows([{ id: 1, financialScore: 5 }], new Map(), new Set([1]))).toEqual([{ id: 1, financialScore: null, total: null, sealed: true }]);
  });
});
