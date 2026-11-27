import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { activeHref, allPagesFor, HOME, hubById, hubPages, hubSectionsFor, moduleOf, modulesFor, MODULES, orderModules, OVERVIEW, pathOf } from "./modules";
import { permissionsOf, PERMISSIONS } from "./auth/permissions";

describe("modules (wave 21, hubs since wave 42)", () => {
  it("has the wave 42 hubs", () => {
    expect(MODULES.map((m) => m.name)).toEqual(["Plan", "Buy", "Pay", "Equipment", "Maintain", "Safety & compliance", "Buildings & 3D", "Reports", "Setup"]);
    expect(HOME.name).toBe("Home");
  });
  it("keeps each hub's menu short", () => {
    for (const m of MODULES) {
      expect(m.links.length, m.id).toBeGreaterThanOrEqual(4);
      expect(m.links.length, m.id).toBeLessThanOrEqual(9);
    }
    expect(OVERVIEW.map((l) => l.href)).toEqual(["/", "/modules", "/approvals", "/assistant"]);
  });
  it("puts every page in one hub, by its most specific entry", () => {
    expect(moduleOf("/assets/work-orders/12")?.id).toBe("maintain");
    expect(moduleOf("/assets/work-orders/on-call")?.id).toBe("maintain");
    expect(moduleOf("/assets/12")?.id).toBe("equipment");
    expect(moduleOf("/assets/3d")?.id).toBe("buildings");
    expect(moduleOf("/assets/incidents/contacts")?.id).toBe("safety");
    expect(moduleOf("/assets/competency")?.id).toBe("safety");
    expect(moduleOf("/assets/maintenance/budget")?.id).toBe("pay");
    expect(moduleOf("/procurement/invoices/new")?.id).toBe("pay");
    expect(moduleOf("/procurement/7")?.id).toBe("buy");
    expect(moduleOf("/boq/standards/1")?.id).toBe("plan");
    expect(moduleOf("/flows/simulate")?.id).toBe("buildings");
    expect(moduleOf("/analytics/cost")?.id).toBe("reports");
    expect(moduleOf("/modules/maintain")?.id).toBe("maintain");
    expect(moduleOf("/")).toBeNull();
    expect(moduleOf("/modules")).toBeNull();
    expect(moduleOf("/account")).toBeNull();
    expect(activeHref("/boq/standards/1")).toBe("/boq/standards");
    expect(activeHref("/assets/work-orders/on-call")).toBe("/assets/work-orders");
    expect(activeHref("/modules/safety")).toBe("/modules/safety");
  });
  it("lists no page twice, in the menu or on hub pages", () => {
    const hrefs = [HOME, ...MODULES].flatMap((m) => hubPages(m).map((p) => p.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of [HOME, ...MODULES]) for (const p of hubPages(h)) expect(p.about.length, p.href).toBeGreaterThan(5);
  });
  it("hides hubs and pages a role can't open", () => {
    expect(modulesFor(["assets.view"]).map((m) => m.id)).toEqual(["plan", "pay", "equipment", "maintain", "safety", "buildings"]);
    expect(modulesFor([])).toEqual([]);
    const maintain = hubById("maintain")!;
    const pages = (perms: Parameters<typeof hubSectionsFor>[1]) => hubSectionsFor(maintain, perms).flatMap((s) => s.pages.map((p) => p.href));
    expect(pages(permissionsOf("VIEWER"))).not.toContain("/assets/work-orders/on-call");
    expect(pages(permissionsOf("BIOMEDICAL"))).toContain("/assets/work-orders/on-call");
    expect(allPagesFor(permissionsOf("TECHNICIAN")).some((p) => p.href.startsWith("/admin"))).toBe(false);
    expect(allPagesFor(permissionsOf("ADMIN"), false).some((p) => p.href === "/assistant")).toBe(false);
  });
  it("puts each role's own hubs first", () => {
    expect(orderModules(MODULES, "TECHNICIAN").map((m) => m.id).slice(0, 3)).toEqual(["maintain", "safety", "equipment"]);
    expect(orderModules(MODULES, null).map((m) => m.id)).toEqual(MODULES.map((m) => m.id));
  });
  it("builds the path above a page", () => {
    expect(pathOf("/assets/work-orders/12").map((p) => p.label)).toEqual(["Modules", "Maintain", "Work orders"]);
    expect(pathOf("/assets/work-orders/12")[1].href).toBe("/modules/maintain");
    expect(pathOf("/assets/work-orders").at(-1)?.href).toBeUndefined();
    expect(pathOf("/assets/critical-backup").map((p) => p.label)).toEqual(["Modules", "Maintain", "Critical backups"]);
    expect(pathOf("/modules/setup")).toEqual([{ label: "Modules", href: "/modules" }, { label: "Setup" }]);
    expect(pathOf("/")).toEqual([]);
  });
});

/* ── Every page can be reached (wave 42) ── */

const appDir = path.resolve(__dirname, "..", "app");
/** Pages reached without the menu: signing in, first-run setup, the not-allowed page. */
const OPEN = new Set(["/login", "/login/code", "/login/two-step", "/setup", "/forbidden"]);
/** Forms opened from one record (an asset, a work order, a purchase order), with the file that links to them. */
const FROM_RECORD: Record<string, string> = {
  "/assets/calibration/new": "components/assets/calibration-panel.tsx",
  "/assets/disposals/new": "app/assets/[id]/page.tsx",
  "/assets/safety-tests/new": "components/assets/safety-panel.tsx",
  "/procurement/invoices/new": "components/procurement/po-money.tsx",
};

/** Every page route under src/app without a [param], route groups dropped, with its folder. */
function staticPages(dir: string, prefix = ""): { route: string; dir: string }[] {
  const out: { route: string; dir: string }[] = [];
  for (const n of readdirSync(dir)) {
    const f = path.join(dir, n);
    if (!statSync(f).isDirectory()) continue;
    if ((n === "api" && !prefix) || n.startsWith("_") || n.startsWith("[")) continue;
    out.push(...staticPages(f, prefix + (/^\(.*\)$/.test(n) ? "" : `/${n}`)));
  }
  if (existsSync(path.join(dir, "page.tsx"))) out.push({ route: prefix || "/", dir });
  return out;
}

/** The code in a folder (not its sub-folders), where a page's own links live. */
const folderCode = (dir: string) => readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && statSync(path.join(dir, n)).isFile()).map((n) => readFileSync(path.join(dir, n), "utf8")).join("\n");

describe("page reachability (wave 42)", () => {
  const entries = new Set([HOME, ...MODULES].flatMap((h) => hubPages(h).map((p) => p.href)));
  const pages = staticPages(appDir);

  it("finds the pages", () => expect(pages.length).toBeGreaterThan(100));

  it("reaches every page from the menu, a hub page, or a link on its parent page", () => {
    const lost = pages.filter(({ route }) => {
      if (OPEN.has(route) || entries.has(route)) return false;
      if (FROM_RECORD[route]) return !readFileSync(path.resolve(appDir, "..", FROM_RECORD[route]), "utf8").includes(route);
      // A form like /assets/new: its parent is listed and links to it.
      const parent = route.slice(0, route.lastIndexOf("/")) || "/";
      const parentDir = path.join(appDir, parent);
      return !(entries.has(parent) && existsSync(parentDir) && ["\"", "`", "'"].some((q) => folderCode(parentDir).includes(q + route)));
    }).map((p) => p.route);
    expect(lost).toEqual([]);
  });

  it("lists only pages that exist", () => {
    const routes = new Set(pages.map((p) => p.route));
    const dynamicOk = (href: string) => /^\/reports\/[a-z-]+$/.test(href); // report pages are /reports/[slug]
    expect([...entries].filter((h) => !routes.has(h) && !dynamicOk(h))).toEqual([]);
  });

  it("gives every hub page entry a real permission", () => {
    const all = new Set<string>(PERMISSIONS);
    for (const h of [HOME, ...MODULES]) for (const p of hubPages(h)) if (p.need) expect(all.has(p.need), p.href).toBe(true);
  });
});

describe("start page (wave 26)", () => {
  it("sends each role to its usual page", async () => {
    const { landingPage } = await import("./modules");
    expect(landingPage("/", null, "TECHNICIAN", permissionsOf("TECHNICIAN"))).toBe("/assets/my-jobs");
    expect(landingPage(null, null, "FINANCE", permissionsOf("FINANCE"))).toBe("/procurement/invoices");
    expect(landingPage(null, null, "DIRECTOR", permissionsOf("DIRECTOR"))).toBe("/reports/executive");
    expect(landingPage(null, null, "ADMIN", permissionsOf("ADMIN"))).toBe("/");
    expect(landingPage(null, null, "VIEWER", permissionsOf("VIEWER"))).toBe("/");
  });
  it("keeps the page the person asked for, then their own choice", async () => {
    const { landingPage } = await import("./modules");
    expect(landingPage("/assets/42", "/boq", "PLANNER", permissionsOf("PLANNER"))).toBe("/assets/42");
    expect(landingPage("/", "/flows", "PLANNER", permissionsOf("PLANNER"))).toBe("/flows");
    expect(landingPage("//evil.example", null, "ADMIN", permissionsOf("ADMIN"))).toBe("/");
  });
  it("keeps a start page chosen before it left the menu", async () => {
    const { landingPage } = await import("./modules");
    expect(landingPage(null, "/assets/critical-backup", "BIOMEDICAL", permissionsOf("BIOMEDICAL"))).toBe("/assets/critical-backup");
  });
  it("ignores a chosen page the person can no longer open", async () => {
    const { landingPage, startPageOptions } = await import("./modules");
    expect(landingPage(null, "/admin/users", "TECHNICIAN", permissionsOf("TECHNICIAN"))).toBe("/assets/my-jobs");
    expect(startPageOptions(permissionsOf("TECHNICIAN")).some((o) => o.href === "/admin/users")).toBe(false);
    expect(startPageOptions(permissionsOf("ADMIN"))[0]).toEqual({ href: "/", label: "Dashboard", group: "Overview" });
  });
  it("every role home is a page that role can open", async () => {
    const { ROLE_HOME, startPageOptions } = await import("./modules");
    for (const [role, href] of Object.entries(ROLE_HOME)) expect(startPageOptions(permissionsOf(role)).map((o) => o.href), role).toContain(href);
  });
});
