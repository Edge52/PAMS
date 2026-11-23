import { describe, expect, it } from "vitest";
import { cryoReadingProblem, cryoStatus, isMriType, magnetSettings, sinceRefill, type CryoReading } from "./cryogen";

const S = magnetSettings(null, "IMG-MRI-15T");
const r = (readOn: string, heliumPct: number, more: Partial<CryoReading> = {}): CryoReading => ({ readOn, heliumPct, coldHead: "RUNNING", compressor: "RUNNING", ...more });
const kinds = (rs: CryoReading[], today: string, s = S) => cryoStatus(rs, s, today).warnings.map((w) => w.kind);

describe("MRI cryogen log", () => {
  it("uses the defaults and skips permanent magnets", () => {
    expect(S).toEqual({ cryogenic: true, heliumMinPct: 70, maxDropPct: 2, dropWindowDays: 30, maxGapDays: 7 });
    expect(magnetSettings(null, "IMG-MRI-OPEN").cryogenic).toBe(false);
    expect(magnetSettings({ cryogenic: true, heliumMinPct: 65 }, "IMG-MRI-OPEN")).toMatchObject({ cryogenic: true, heliumMinPct: 65 });
    expect(kinds([], "2026-11-20", magnetSettings(null, "IMG-MRI-OPEN"))).toEqual([]);
    expect(isMriType("IMG-MRI-30T")).toBe(true);
    expect(isMriType("IMG-CT-64")).toBe(false);
  });

  it("is quiet for a steady magnet read weekly", () => {
    const rs = [r("2026-10-01", 82), r("2026-10-08", 81.9), r("2026-10-15", 81.8), r("2026-10-22", 81.7), r("2026-10-29", 81.6), r("2026-11-05", 81.5), r("2026-11-12", 81.4), r("2026-11-19", 81.3)];
    const st = cryoStatus(rs, S, "2026-11-20");
    expect(st.warnings).toEqual([]);
    expect(st.drop).toBeCloseTo(0.4, 5);
    expect(st.ratePer30!).toBeCloseTo(0.43, 2);
    expect(st.reachesMinOn).toBe("2029-01-18");
  });

  it("warns below the minimum, on a fast fall, and on a stopped cold head", () => {
    const rs = [r("2026-10-20", 74), r("2026-11-01", 72), r("2026-11-15", 69.5, { coldHead: "STOPPED" })];
    expect(kinds(rs, "2026-11-16")).toEqual(["low", "cold_head", "falling"]);
  });

  it("counts the fall inside the window only, by straight line", () => {
    // 6 points over 90 days is 2 a month: just at the limit, not over it.
    expect(kinds([r("2026-08-17", 80), r("2026-11-15", 74)], "2026-11-16")).toEqual([]);
    // 3 points in 20 days is over it.
    expect(kinds([r("2026-10-26", 80), r("2026-11-15", 77)], "2026-11-16")).toEqual(["falling"]);
  });

  it("starts again after a refill", () => {
    const rs = [r("2026-10-01", 72), r("2026-10-10", 70.5), r("2026-10-12", 92), r("2026-11-10", 91.5)];
    expect(sinceRefill(rs).map((x) => x.heliumPct)).toEqual([92, 91.5]);
    expect(kinds(rs, "2026-11-11")).toEqual([]);
  });

  it("warns when readings are missing", () => {
    expect(kinds([], "2026-11-20")).toEqual(["missing"]);
    expect(kinds([r("2026-11-10", 85)], "2026-11-20")).toEqual(["missing"]);
    expect(kinds([r("2026-11-13", 85)], "2026-11-20")).toEqual([]);
  });

  it("flags a compressor fault", () => {
    expect(kinds([r("2026-11-19", 85, { compressor: "FAULT" })], "2026-11-20")).toEqual(["compressor"]);
  });

  it("checks a reading", () => {
    expect(cryoReadingProblem(r("2026-11-20", 101), "2026-11-20")).toMatch(/between 0 and 100/);
    expect(cryoReadingProblem(r("2026-11-21", 80), "2026-11-20")).toMatch(/future/);
    expect(cryoReadingProblem(r("2026-11-20", 80, { chillerTempC: 90 }), "2026-11-20")).toMatch(/Chiller/);
    expect(cryoReadingProblem(r("2026-11-20", 80, { pressurePsi: 1.2, chillerTempC: 18 }), "2026-11-20")).toBeNull();
  });
});
