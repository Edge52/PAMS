import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { permissionsOf, PERMISSIONS } from "./auth/permissions";
import { guidesFor, HELP_GUIDES, helpLinks, searchGuides } from "./help";

const appDir = path.resolve(__dirname, "..", "app");

/** Every page route in src/app as a pattern: route groups dropped, [param] matches one segment. */
function routes(dir: string, prefix = ""): RegExp[] {
  const out: RegExp[] = [];
  for (const n of readdirSync(dir)) {
    const f = path.join(dir, n);
    if (statSync(f).isDirectory()) {
      if (n === "api" || n.startsWith("_")) continue;
      const seg = /^\(.*\)$/.test(n) ? "" : n.startsWith("[") ? "/[^/]+" : `/${n.replace(/[.*+?^${}()|\\]/g, "\\$&")}`;
      out.push(...routes(f, prefix + seg));
    } else if (n === "page.tsx") out.push(new RegExp(`^${prefix || "/"}$`));
  }
  return out;
}

describe("help guides", () => {
  const pages = routes(appDir);

  it("links only to pages that exist", () => {
    const bad = helpLinks().filter((href) => !pages.some((r) => r.test(href.split(/[?#]/)[0])));
    expect(bad).toEqual([]);
  });

  it("has unique ids, steps and real permissions", () => {
    expect(new Set(HELP_GUIDES.map((g) => g.id)).size).toBe(HELP_GUIDES.length);
    for (const g of HELP_GUIDES) {
      expect(g.steps.length).toBeGreaterThan(1);
      for (const p of g.need) expect(PERMISSIONS).toContain(p);
    }
  });

  it("shows each role only the guides it can follow", () => {
    expect(guidesFor(permissionsOf("ADMIN")).length).toBe(HELP_GUIDES.length);
    const viewer = guidesFor(permissionsOf("VIEWER")).map((g) => g.id);
    expect(viewer).toContain("report-fault");
    expect(viewer).not.toContain("backup");
    expect(viewer).not.toContain("award-po");
    expect(guidesFor(permissionsOf("TECHNICIAN")).map((g) => g.id)).toContain("close-job-phone");
  });

  it("searches titles, keywords and steps", () => {
    expect(searchGuides(HELP_GUIDES, "").length).toBe(HELP_GUIDES.length);
    expect(searchGuides(HELP_GUIDES, "ENRRA").map((g) => g.id)).toEqual(["radiation"]);
    expect(searchGuides(HELP_GUIDES, "purchase order award").map((g) => g.id)).toContain("award-po");
    expect(searchGuides(HELP_GUIDES, "zzzz")).toEqual([]);
  });
});
