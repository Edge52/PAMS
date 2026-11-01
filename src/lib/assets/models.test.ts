import { describe, expect, it } from "vitest";
import { fleetSummary, nameKey, registerCandidates, supportState } from "./models";

describe("brand and model catalogue", () => {
  it("matches names ignoring case and spaces", () => {
    expect(nameKey("  GE   Healthcare ")).toBe("ge healthcare");
  });
  it("works out support status", () => {
    const today = "2026-11-01";
    expect(supportState({ endOfSupport: "2026-10-31" }, today)).toBe("unsupported");
    expect(supportState({ endOfSupport: "2027-06-30" }, today)).toBe("ending");
    expect(supportState({ endOfSupport: "2029-01-01", endOfSale: "2025-01-01" }, today)).toBe("end-of-sale");
    expect(supportState({}, today)).toBe("supported");
  });
  it("builds candidates from the register, most common spelling, skipping known and blank", () => {
    const c = registerCandidates([
      { deviceTypeId: 1, manufacturer: "Philips", model: "IntelliVue MX450", units: 5 },
      { deviceTypeId: 1, manufacturer: "philips", model: "intellivue  mx450", units: 2 },
      { deviceTypeId: 1, manufacturer: "Mindray", model: "", units: 4 },
      { deviceTypeId: 1, manufacturer: "Dräger", model: "Evita V500", units: 3 },
      { deviceTypeId: 2, manufacturer: "Dräger", model: "Evita V500", units: 1 },
    ], [{ deviceTypeId: 1, manufacturer: "DRÄGER", model: "evita v500" }]);
    expect(c).toEqual([{ deviceTypeId: 1, manufacturer: "Philips", model: "IntelliVue MX450", units: 7 }, { deviceTypeId: 2, manufacturer: "Dräger", model: "Evita V500", units: 1 }]);
  });
  it("summarises a fleet: makers, models, preferred share, unsupported units and standardisation", () => {
    const f = fleetSummary([
      { deviceTypeId: 1, manufacturer: "Philips", model: "MX450" }, { deviceTypeId: 1, manufacturer: "Philips", model: "MX450" },
      { deviceTypeId: 1, manufacturer: "philips", model: "mx450" }, { deviceTypeId: 1, manufacturer: "Mindray", model: "ePM 10" },
      { deviceTypeId: 1, manufacturer: null, model: null },
    ], [{ id: 7, deviceTypeId: 1, manufacturer: "Philips", model: "MX450", endOfSale: null, endOfSupport: null },
      { id: 8, deviceTypeId: 1, manufacturer: "Mindray", model: "ePM 10", endOfSale: null, endOfSupport: "2020-01-01" }], new Map([[1, 7]]), "2026-11-01");
    expect(f[0]).toMatchObject({ units: 5, unknown: 1, onPreferred: 3, unsupported: 1, standardisation: 75, preferredId: 7 });
    expect(f[0].makers).toEqual([{ name: "Philips", units: 3 }, { name: "Mindray", units: 1 }]);
    expect(f[0].models[0]).toMatchObject({ model: "MX450", preferred: true, support: "supported" });
  });
});
