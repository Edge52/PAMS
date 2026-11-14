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
