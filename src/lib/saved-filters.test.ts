import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "./auth/permissions";
import { cleanName, cleanQuery, isSavedFilterKey, MAX_QUERY, pathAllowed, SAVED_FILTER_PAGES, savedFilterHref } from "./saved-filters";

describe("saved filters (wave 41)", () => {
  it("cleans the query: no paging, no empty values, sorted, too long refused", () => {
    expect(cleanQuery("?status=OPEN&page=3&q=&dept=4")).toBe("dept=4&status=OPEN");
    expect(cleanQuery("")).toBe("");
    expect(cleanQuery(`q=${"x".repeat(MAX_QUERY)}`)).toBeNull();
    expect(cleanQuery("b=2&a=1")).toBe(cleanQuery("a=1&b=2"));
  });

  it("cleans names", () => {
    expect(cleanName("  Urgent   in ICU ")).toBe("Urgent in ICU");
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("x".repeat(41))).toBeNull();
  });

  it("knows its pages and their paths", () => {
    expect(isSavedFilterKey("assets")).toBe(true);
    expect(isSavedFilterKey("toString")).toBe(false);
    expect(isSavedFilterKey(3)).toBe(false);
    expect(pathAllowed("analytics", "/analytics/cost")).toBe(true);
    expect(pathAllowed("assets", "/admin/users")).toBe(false);
    for (const p of Object.values(SAVED_FILTER_PAGES)) expect(PERMISSIONS).toContain(p.need);
    expect(savedFilterHref("/assets", "")).toBe("/assets");
    expect(savedFilterHref("/assets", "status=IN_SERVICE")).toBe("/assets?status=IN_SERVICE");
  });

  it("is placed on each list page it names", () => {
    const app = path.resolve(__dirname, "..", "app");
    const where: Record<string, string> = {
      assets: "assets/page.tsx", "work-orders": "assets/work-orders/page.tsx", ppm: "assets/maintenance/page.tsx",
      requests: "assets/requests/page.tsx", recalls: "assets/recalls/page.tsx", incidents: "assets/incidents/page.tsx",
      offers: "procurement/offers/page.tsx", rfqs: "procurement/rfqs/page.tsx", "purchase-orders": "procurement/purchase-orders/page.tsx",
      invoices: "procurement/invoices/page.tsx", suppliers: "procurement/suppliers/page.tsx", analytics: "../components/analytics/shell.tsx",
    };
    expect(Object.keys(where).sort()).toEqual(Object.keys(SAVED_FILTER_PAGES).sort());
    for (const [k, f] of Object.entries(where)) expect(readFileSync(path.join(app, f), "utf8")).toContain(`<SavedFilters page="${k}" />`);
  });
});
