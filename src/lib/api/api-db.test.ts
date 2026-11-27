/**
 * Wave 41 (agent N): the read-only API against in-memory PGlite with the real migrations: token, scope, hospitals,
 * prices, rate limit and the call log. Skipped until the migration with api_tokens exists in drizzle/ (the lead
 * generates it at merge time).
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";

const h = vi.hoisted(() => ({ d: null as unknown as DB }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/client-address", () => import("../client-address"));
vi.mock("@/lib/assets/filters", () => import("../assets/filters"));
vi.mock("@/lib/format", () => import("../format"));

const client = new PGlite();
const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
h.d = d;
await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
const ready = (await client.query<{ t: string | null }>("select to_regclass('public.api_tokens')::text as t")).rows[0]?.t != null;
afterAll(async () => { await client.close(); });

describe.skipIf(!ready)("read-only API (wave 41)", async () => {
  const { apiGet } = await import("./api-server");
  const { apiAssets } = await import("./data-server");
  const { newToken } = await import("./tokens");
  const { apiTokens, apiCalls, facilities, deviceTypes, assets } = schema;
  const [f1] = await d.insert(facilities).values({ code: "AAA", name: "A", type: "GENERAL_HOSPITAL" } as never).returning();
  const [f2] = await d.insert(facilities).values({ code: "BBB", name: "B", type: "GENERAL_HOSPITAL" } as never).returning();
  const [dt] = await d.insert(deviceTypes).values({ code: "T-1", name: "Type", level: 3 } as never).returning();
  await d.insert(assets).values([
    { assetTag: "AAA-T-1", facilityId: f1.id, deviceTypeId: dt.id, purchaseCost: "100", currency: "USD" },
    { assetTag: "BBB-T-1", facilityId: f2.id, deviceTypeId: dt.id, purchaseCost: "200", currency: "USD" },
  ] as never);
  const make = async (o: Partial<typeof apiTokens.$inferInsert>) => {
    const t = newToken();
    const [row] = await d.insert(apiTokens).values({ name: "t", prefix: t.prefix, tokenHash: t.hash, scopes: ["assets:read"], expiresAt: new Date(Date.now() + 86_400_000), ...o }).returning();
    return { token: t.token, id: row.id };
  };
  const call = (token: string | null, q = "") => apiGet(new Request(`http://x/api/v1/assets${q}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), "assets:read", apiAssets);

  it("refuses calls without a valid token, and logs them", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call("hpk_nope")).status).toBe(401);
    const old = await make({ expiresAt: new Date(Date.now() - 1000) });
    expect((await call(old.token)).status).toBe(401);
    const revoked = await make({ revokedAt: new Date() });
    expect((await call(revoked.token)).status).toBe(401);
    expect((await d.select().from(apiCalls)).length).toBe(4);
  });
  it("needs the scope", async () => {
    const t = await make({ scopes: ["workorders:read"] });
    expect((await call(t.token)).status).toBe(403);
  });
  it("keeps to the token's hospitals and hides prices without prices:read", async () => {
    const t = await make({ facilityIds: [f1.id] });
    const r = await (await call(t.token)).json();
    expect(r.data.map((a: { tag: string }) => a.tag)).toEqual(["AAA-T-1"]);
    expect(r.data[0].purchaseCost).toBeUndefined();
    expect((await (await call(t.token, "?facility=BBB")).json()).data).toEqual([]);
    const p = await make({ scopes: ["assets:read", "prices:read"] });
    const all = await (await call(p.token, "?perPage=1")).json();
    expect(all).toMatchObject({ total: 2, perPage: 1, next: 2 });
    expect(all.data[0].purchaseCost).toBe("100.00");
  });
  it("rate-limits a token", async () => {
    const t = await make({});
    await d.insert(apiCalls).values(Array.from({ length: 60 }, () => ({ tokenId: t.id, path: "/api/v1/assets", status: 200 })));
    expect((await call(t.token)).status).toBe(429);
  });
});
