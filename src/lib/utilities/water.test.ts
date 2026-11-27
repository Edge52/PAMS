import { describe, expect, it } from "vitest";
import { defaultLimits, judgeSample, resampleBy, sampleDue, trendLines, trendOf } from "./water";

describe("water quality (wave 41, EFS.12)", () => {
  const dia = defaultLimits("DIALYSIS_RO");
  it("uses the ISO 23500 dialysis levels", () => {
    expect(dia).toMatchObject({ tvcAction: 50, tvcLimit: 100, endotoxinAction: 0.125, endotoxinLimit: 0.25 });
  });
  it("judges dialysis water: OK, action level, over the limit", () => {
    expect(judgeSample(dia, { tvc: 10, endotoxin: 0.05 }).level).toBe("OK");
    expect(judgeSample(dia, { tvc: 50, endotoxin: 0.05 }).level).toBe("ACTION");
    expect(judgeSample(dia, { tvc: 20, endotoxin: 0.125 }).level).toBe("ACTION");
    const f = judgeSample(dia, { tvc: 100, endotoxin: 0.3 });
    expect(f.level).toBe("FAIL");
    expect(f.problems).toHaveLength(2);
    expect(judgeSample(dia, { tvc: 120, endotoxin: 0.13 }).problems).toEqual(["Total viable count 120 CFU/mL: limit 100.", "Endotoxin 0.13 EU/mL: action level 0.125."]);
  });
  it("checks chemistry and drinking water", () => {
    expect(judgeSample(dia, { chlorine: 0.2 }).level).toBe("FAIL");
    expect(judgeSample(dia, { chemistryOk: false }).level).toBe("FAIL");
    const dw = defaultLimits("DRINKING_TANK");
    expect(judgeSample(dw, { coliforms: 0, freeChlorine: 0.3 }).level).toBe("OK");
    expect(judgeSample(dw, { coliforms: 2 }).level).toBe("FAIL");
    expect(judgeSample(dw, { freeChlorine: 0.1 }).level).toBe("FAIL");
  });
  it("has no default for sterilizer feed water, and flags an empty result", () => {
    expect(judgeSample(defaultLimits("CSSD_FEED"), { conductivity: 40 }).level).toBe("OK");
    expect(judgeSample(dia, {}).empty).toBe(true);
    expect(judgeSample({ ...defaultLimits("CSSD_FEED"), conductivityMax: 15 }, { conductivity: 40 }).level).toBe("FAIL");
  });
  it("says when the next sample is due and when to repeat", () => {
    expect(sampleDue("2026-10-01", 30, "2026-11-27").state).toBe("overdue");
    expect(resampleBy("2026-11-01", "FAIL")).toBe("2026-11-08");
    expect(resampleBy("2026-11-01", "OK")).toBeNull();
  });
  it("builds the trend oldest first, red at the action level", () => {
    const t = trendOf([{ sampledOn: "2026-11-01", tvc: 60, endotoxin: null }, { sampledOn: "2026-10-01", tvc: 10, endotoxin: 0.01 }], "tvc", dia);
    expect(t).toEqual([{ on: "2026-10-01", value: 10, ok: true }, { on: "2026-11-01", value: 60, ok: false }]);
    expect(trendOf([{ sampledOn: "2026-11-01", tvc: 60, endotoxin: null }], "endotoxin", dia)).toEqual([]);
    expect(trendOf([{ sampledOn: "2026-11-01", freeChlorine: 0.1 }], "freeChlorine", defaultLimits("DRINKING_TANK"))[0].ok).toBe(false);
    expect(trendLines("tvc", dia)).toEqual({ min: 50, max: 100 });
    expect(trendLines("freeChlorine", defaultLimits("DRINKING_TANK"))).toEqual({ min: 0.2, max: null });
  });
});
