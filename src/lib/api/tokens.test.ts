import { describe, expect, it } from "vitest";
import { bearer, hashToken, hasScope, newToken, pageOf, paging, sinceParam, tokenFormProblems, tokenProblem, tokenScope, withoutPrices } from "./tokens";

const now = new Date("2026-11-27T10:00:00Z");
const row = { scopes: ["assets:read"], expiresAt: new Date("2027-01-01T00:00:00Z"), revokedAt: null, facilityIds: null };

describe("API tokens (wave 41)", () => {
  it("makes random tokens and stores only their hash", () => {
    const a = newToken(), b = newToken();
    expect(a.token).toMatch(/^hpk_[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.token.slice(4, 20));
    expect(a.prefix).toBe(a.token.slice(0, 10));
  });
  it("reads the bearer header", () => {
    expect(bearer("Bearer hpk_abc")).toBe("hpk_abc");
    expect(bearer("bearer   hpk_abc ")).toBe("hpk_abc");
    expect(bearer("Bearer other_abc")).toBeNull();
    expect(bearer("Basic hpk_abc")).toBeNull();
    expect(bearer(null)).toBeNull();
    expect(bearer(`Bearer hpk_${"x".repeat(200)}`)).toBeNull();
  });
  it("refuses unknown, revoked and expired tokens", () => {
    expect(tokenProblem(null, now)).toMatch(/Unknown/);
    expect(tokenProblem(row, now)).toBeNull();
    expect(tokenProblem({ ...row, revokedAt: new Date("2026-11-01") }, now)).toMatch(/revoked/);
    expect(tokenProblem({ ...row, expiresAt: now }, now)).toMatch(/expired/);
  });
  it("checks scopes", () => {
    expect(hasScope(row, "assets:read")).toBe(true);
    expect(hasScope(row, "workorders:read")).toBe(false);
    expect(hasScope(row, "prices:read")).toBe(false);
  });
  it("keeps a token to its hospitals", () => {
    expect(tokenScope(null, null)).toBeNull();
    expect(tokenScope([1, 2], null)).toEqual([1, 2]);
    expect(tokenScope([1, 2], [2, 3])).toEqual([2]);
    expect(tokenScope(null, [3])).toEqual([3]);
    expect(tokenScope([1], [3])).toEqual([]);
  });
  it("pages", () => {
    expect(paging(new URLSearchParams(""))).toEqual({ page: 1, perPage: 50, offset: 0 });
    expect(paging(new URLSearchParams("page=3&perPage=500"))).toEqual({ page: 3, perPage: 200, offset: 400 });
    expect(paging(new URLSearchParams("page=-1&perPage=abc"))).toEqual({ page: 1, perPage: 50, offset: 0 });
    expect(pageOf([1, 2], 5, { page: 2, perPage: 2 })).toEqual({ data: [1, 2], page: 2, perPage: 2, total: 5, next: 3 });
    expect(pageOf([5], 5, { page: 3, perPage: 2 }).next).toBeNull();
  });
  it("drops money without prices:read", () => {
    const rows = [{ tag: "A", purchaseCost: "100", currency: "USD" }];
    expect(withoutPrices(rows, ["purchaseCost", "currency"], false)).toEqual([{ tag: "A" }]);
    expect(withoutPrices(rows, ["purchaseCost"], true)).toBe(rows);
  });
  it("checks the admin form", () => {
    expect(tokenFormProblems({ name: "BI", scopes: ["assets:read"], days: 90 })).toEqual({});
    expect(tokenFormProblems({ name: " ", scopes: ["prices:read"], days: 0 })).toEqual({ name: expect.any(String), scopes: expect.stringMatching(/at least one/), days: expect.any(String) });
    expect(tokenFormProblems({ name: "x", scopes: ["admin:write"], days: 30 }).scopes).toMatch(/Unknown/);
  });
  it("reads a since date", () => {
    expect(sinceParam("2026-11-01")?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(sinceParam("2026-11-01T08:00:00Z")?.toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(sinceParam("yesterday")).toBeNull();
  });
});
