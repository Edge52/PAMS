import { describe, expect, it } from "vitest";
import { activeHref, moduleOf, modulesFor, MODULES, orderModules, pathOf } from "./modules";

describe("modules (wave 21)", () => {
  it("puts every page in one module, by its most specific menu link", () => {
    expect(moduleOf("/assets/work-orders/12")?.id).toBe("maintenance");
    expect(moduleOf("/assets/12")?.id).toBe("assets");
    expect(moduleOf("/assets/3d")?.id).toBe("buildings");
    expect(moduleOf("/procurement/invoices/new")?.id).toBe("finance");
    expect(moduleOf("/procurement/7")?.id).toBe("procurement");
    expect(moduleOf("/boq/standards/1")?.id).toBe("planning");
    expect(moduleOf("/")).toBeNull();
    expect(moduleOf("/modules")).toBeNull();
    expect(activeHref("/boq/standards/1")).toBe("/boq/standards");
  });
  it("lists no link twice", () => {
    const hrefs = MODULES.flatMap((m) => m.links.map((l) => l.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
  it("hides modules a role can't open", () => {
    expect(modulesFor(["assets.view"]).map((m) => m.id)).toEqual(["planning", "assets", "maintenance", "buildings", "pathways"]);
    expect(modulesFor([])).toEqual([]);
  });
  it("puts each role's own modules first", () => {
    expect(orderModules(MODULES, "TECHNICIAN").map((m) => m.id).slice(0, 3)).toEqual(["maintenance", "assets", "buildings"]);
    expect(orderModules(MODULES, null).map((m) => m.id)).toEqual(MODULES.map((m) => m.id));
  });
  it("builds the path above a page", () => {
    expect(pathOf("/assets/work-orders/12").map((p) => p.label)).toEqual(["Modules", "Maintenance", "Work orders"]);
    expect(pathOf("/assets/work-orders").at(-1)?.href).toBeUndefined();
    expect(pathOf("/")).toEqual([]);
  });
});

describe("start page (wave 26)", () => {
  it("sends each role to its usual page", async () => {
    const { landingPage } = await import("./modules");
    const { permissionsOf } = await import("./auth/permissions");
    expect(landingPage("/", null, "TECHNICIAN", permissionsOf("TECHNICIAN"))).toBe("/assets/my-jobs");
    expect(landingPage(null, null, "FINANCE", permissionsOf("FINANCE"))).toBe("/procurement/invoices");
    expect(landingPage(null, null, "DIRECTOR", permissionsOf("DIRECTOR"))).toBe("/reports/executive");
    expect(landingPage(null, null, "ADMIN", permissionsOf("ADMIN"))).toBe("/");
    expect(landingPage(null, null, "VIEWER", permissionsOf("VIEWER"))).toBe("/");
  });
  it("keeps the page the person asked for, then their own choice", async () => {
    const { landingPage } = await import("./modules");
    const { permissionsOf } = await import("./auth/permissions");
    expect(landingPage("/assets/42", "/boq", "PLANNER", permissionsOf("PLANNER"))).toBe("/assets/42");
    expect(landingPage("/", "/flows", "PLANNER", permissionsOf("PLANNER"))).toBe("/flows");
    expect(landingPage("//evil.example", null, "ADMIN", permissionsOf("ADMIN"))).toBe("/");
  });
  it("ignores a chosen page the person can no longer open", async () => {
    const { landingPage, startPageOptions } = await import("./modules");
    const { permissionsOf } = await import("./auth/permissions");
    expect(landingPage(null, "/admin/users", "TECHNICIAN", permissionsOf("TECHNICIAN"))).toBe("/assets/my-jobs");
    expect(startPageOptions(permissionsOf("TECHNICIAN")).some((o) => o.href === "/admin/users")).toBe(false);
    expect(startPageOptions(permissionsOf("ADMIN"))[0]).toEqual({ href: "/", label: "Dashboard", group: "Overview" });
  });
  it("every role home is a page that role can open", async () => {
    const { ROLE_HOME, startPageOptions } = await import("./modules");
    const { permissionsOf } = await import("./auth/permissions");
    for (const [role, href] of Object.entries(ROLE_HOME)) expect(startPageOptions(permissionsOf(role)).map((o) => o.href), role).toContain(href);
  });
});
