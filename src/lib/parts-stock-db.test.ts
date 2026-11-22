/**
 * Audit finding (wave 30): spare part stock must never go below zero, even when two issues run at once. applyMovement
 * (lib/assets/parts-server.ts) changes stock with one conditional update (`where stock + delta >= 0`); this keeps it so.
 * In-memory PGlite with the real migrations; notifications stubbed.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema";
import type { DB } from "../db";

const h = vi.hoisted(() => ({ d: null as unknown as DB }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../db/schema"));
vi.mock("@/lib/format", () => import("./format"));
vi.mock("@/lib/notifications", () => ({ notifyRole: async () => {} }));

let client: PGlite;
let partId = 0;

beforeAll(async () => {
  client = new PGlite();
  h.d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
  await migrate(h.d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "drizzle") });
  const [f] = await h.d.insert(schema.facilities).values({ code: "TST", name: "Test hospital" }).returning();
  [{ id: partId }] = await h.d.insert(schema.spareParts).values({ facilityId: f.id, partNumber: "SP-1", name: "SpO2 sensor", stockQty: 3 }).returning({ id: schema.spareParts.id });
}, 180_000);
afterAll(async () => { await client?.close(); });

describe("spare part stock", () => {
  it("two issues at once can't take stock below zero", async () => {
    const { applyMovement } = await import("./assets/parts-server");
    const res = await Promise.all([1, 2].map(() => applyMovement({ partId, kind: "ISSUE", quantity: 2, actor: "Tester" })));
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    const [p] = await h.d.select().from(schema.spareParts).where(eq(schema.spareParts.id, partId));
    expect(p.stockQty).toBe(1);
    expect(await h.d.select().from(schema.partTransactions).where(eq(schema.partTransactions.partId, partId))).toHaveLength(1);
  });
});
