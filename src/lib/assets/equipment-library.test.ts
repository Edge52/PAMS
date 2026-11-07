import { describe, expect, it } from "vitest";
import { connectionsText, connPoint, FIRST_SET, fringePoly, GENERIC, genericFor, libraryEntry, parseConnections, parseZones, zoneRect, zonesText } from "./equipment-library";
import { TYPICAL } from "./site-fit";

describe("equipment library (wave 17, phase 5)", () => {
  it("picks the most specific generic entry", () => {
    expect(genericFor("IMG-MRI-OPEN")?.label).toBe("Open MRI scanner");
    expect(genericFor("IMG-MRI-15T")?.label).toBe("MRI scanner");
    expect(genericFor("IMG-XR-CARM")?.label).toBe("Mobile C-arm");
    expect(genericFor("IMG-XR-DRC")?.label).toBe("X-ray system");
    expect(genericFor("OPH-XYZ")).toBeNull();
  });
  it("every built-in entry parses back from its own text", () => {
    for (const g of GENERIC) {
      expect(parseZones(zonesText(g.zones))).toEqual({ zones: g.zones, errors: [] });
      expect(parseConnections(connectionsText(g.connections))).toEqual({ connections: g.connections, errors: [] });
    }
    for (const m of FIRST_SET) expect(TYPICAL[m.site], m.model).toBeTruthy();
  });
  it("uses the model's own zones first and adds the fringe field from site data", () => {
    const own = { zones: [{ name: "Trolley", kind: "patient" as const, side: "foot" as const, depth: 2 }] };
    const e = libraryEntry("IMG-MRI-15T", own, { fringeAlongM: 4, fringeAcrossM: 2.5 })!;
    expect(e.zones).toEqual(own.zones); expect(e.custom).toBe(true);
    expect(e.connections.some((c) => c.kind === "quench")).toBe(true);
    expect(e.fringe).toEqual({ along: 4, across: 2.5 });
    expect(libraryEntry("OPH-XYZ", null, null)).toBeNull();
  });
  it("lays zones and connections around the footprint", () => {
    expect(zoneRect({ name: "", kind: "patient", side: "foot", depth: 1.5 }, 4, 2)).toEqual({ u0: 2, u1: 3.5, v0: -1, v1: 1 });
    expect(zoneRect({ name: "", kind: "staff", side: "all", depth: 0.5 }, 2, 1)).toEqual({ u0: -1.5, u1: 1.5, v0: -1, v1: 1 });
    expect(connPoint({ kind: "power", label: "", along: -1, across: 0.5, height: 0 }, 4, 2)).toEqual([-2, 0.5]);
    expect(fringePoly({ along: 4, across: 2 }, 4)[1][1]).toBeCloseTo(2);
  });
  it("explains bad lines", () => {
    expect(parseZones("A, patient, top, 1").errors[0]).toMatch(/side/);
    expect(parseConnections("gas, Oxygen, label, 2, 0, 1").errors[0]).toMatch(/along/);
    expect(parseConnections("gas, Oxygen, outlet A, -1, 0, 1.4").connections[0].label).toBe("Oxygen, outlet A");
  });
});
