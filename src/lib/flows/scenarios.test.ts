import { describe, expect, it } from "vitest";
import { buildRuns, cleanScenario, defaultScenario, hoursLabel, whatIfChanges } from "./scenarios";
import type { SimModel } from "./simulate";

const even = Array.from({ length: 24 }, () => 1 / 24);
const model: SimModel = {
  flows: [{ id: 7, name: "Outpatient MRI", kind: "PATIENT", perDay: 30, profile: even,
    steps: [{ key: "s", label: "Arrive", kind: "START", minutes: 0, resource: null, level: 0 }, { key: "mri", label: "MRI scan", kind: "STEP", minutes: 30, resource: "scan:mri", level: -1 }, { key: "e", label: "Leave", kind: "END", minutes: 0, resource: null, level: 0 }],
    links: [{ from: "s", to: "mri", share: 100, transport: "WHEELCHAIR", urgent: false }, { from: "mri", to: "e", share: 100, transport: "FOOT", urgent: false }] }],
  resources: [{ key: "scan:mri", label: "MRI scanners, Radiology", kind: "scanner", capacity: 1 }, { key: "porter", label: "Porters on duty", kind: "porter", capacity: 4 }],
  liftForBeds: null, liftForAll: null, porter: "porter",
};

describe("simulation scenarios (wave 15)", () => {
  it("cleans saved settings, dropping what is out of range", () => {
    const s = cleanScenario({
      days: 7, runs: 33, variability: 0.25, weekend: 500, volume: "120", porters: 6,
      staff: [{ label: " Radiographers ", count: 3.4, uses: ["scan:mri", "bad key!"] }],
      hours: { "scan:mri": { open: 8, close: 20, weekends: false }, broken: { open: 9, close: 9 } },
      books: { 7: { from: 8, to: 16, noShow: 2 }, x: { from: 8, to: 16 } },
      whatIf: { capacity: { "scan:mri": 2 }, volume: "abc", hours: { "scan:mri": { open: 8, close: 22, weekends: false } }, moves: { "7:mri": 0, nope: 1 } },
    }, 4);
    expect(s).toMatchObject({ days: 7, runs: 20, variability: 0.25, weekend: 200, volume: 120, porters: 6 });
    expect(s.staff).toEqual([{ key: "staff:1", label: "Radiographers", count: 3, uses: ["scan:mri"] }]);
    expect(s.hours).toEqual({ "scan:mri": { open: 8, close: 20, weekends: false } });
    expect(s.books).toEqual({ 7: { from: 8, to: 16, noShow: 0.9 } });
    expect(s.whatIf).toEqual({ capacity: { "scan:mri": 2 }, volume: null, hours: { "scan:mri": { open: 8, close: 22, weekends: false } }, moves: { "7:mri": 0 } });
    expect(cleanScenario("rubbish", 4)).toEqual(defaultScenario(4));
  });

  it("has no what-if until something changes", () => {
    const s = defaultScenario(4);
    expect(whatIfChanges(model, s)).toEqual([]);
    expect(buildRuns(model, s).whatIf).toBeNull();
    expect(buildRuns(model, { ...s, whatIf: { ...s.whatIf, capacity: { "scan:mri": 1 } } }).whatIf).toBeNull(); // same as now
  });

  it("builds the baseline and what-if", () => {
    const s = { ...defaultScenario(4), porters: 3,
      staff: [{ key: "", label: "Radiographers", count: 1, uses: ["scan:mri"] }],
      hours: { "scan:mri": { open: 8, close: 20, weekends: false } }, books: { 7: { from: 8, to: 16, noShow: 0.1 } },
      whatIf: { capacity: { "staff:1": 2 }, volume: 150, hours: { "scan:mri": { open: 8, close: 22, weekends: false } }, moves: { "7:mri": 0 } } };
    expect(whatIfChanges(model, s)).toEqual(["Radiographers 2", "150 % patients", "MRI scanners, Radiology open 08:00–22:00, weekdays", "MRI scan (Outpatient MRI) to floor 0"]);
    const r = buildRuns(model, s);
    expect(r.model.resources.map((x) => x.key)).toContain("staff:1");
    expect(r.model.flows[0].steps[1].staff).toBe("staff:1");
    expect(r.base).toMatchObject({ capacity: { porter: 3 }, hours: { "scan:mri": { close: 20 } }, books: { 7: { from: 8 } }, volumeFactor: 1 });
    expect(r.whatIf).toMatchObject({ capacity: { porter: 3, "staff:1": 2 }, hours: { "scan:mri": { close: 22 } }, levels: { "7:mri": 0 }, volumeFactor: 1.5 });
  });

  it("labels opening hours", () => {
    expect(hoursLabel({ open: 7.5, close: 20, weekends: false })).toBe("07:30–20:00, weekdays");
    expect(hoursLabel({ open: 0, close: 24, weekends: true })).toBe("00:00–24:00");
  });
});
