import { describe, expect, it } from "vitest";
import { extraFlags, personChecks, personKey, pregnancyCheck, seesPregnancy } from "./dosimetry";

const r = (name: string, end: string, dose: number, extra: { eye?: number; ext?: number } = {}) =>
  ({ personName: name, periodStart: `${end.slice(0, 7)}-01`, periodEnd: end, doseMsv: dose, eyeLensMsv: extra.eye ?? null, extremityMsv: extra.ext ?? null });

describe("dosimetry checks (wave 40)", () => {
  it("keys a person by the name as written", () => {
    expect(personKey("  Mona   Adel ")).toBe("mona adel");
  });
  it("sums the rolling five years and checks each year", () => {
    const today = "2026-11-26";
    const rows = [r("Mona Adel", "2022-06-30", 25), r("mona adel", "2023-06-30", 25), r("Mona Adel", "2024-06-30", 25), r("Mona Adel", "2025-06-30", 20), r("Mona Adel", "2026-06-30", 10), r("Mona Adel", "2021-06-30", 40)];
    const [p] = personChecks(rows, today);
    expect(p.fiveYear).toBe(105); // 2021 is outside the 5 years
    expect(p.problems[0]).toContain("over 100 mSv");
    expect(p.currentYear).toBe(10);
    const single = personChecks([r("Ali", "2026-03-31", 30), r("Ali", "2026-06-30", 25)], today)[0];
    expect(single.problems).toEqual(["55 mSv in 2026: over 50 mSv in one year."]);
    const over20 = personChecks([r("Ali", "2026-03-31", 21)], today)[0];
    expect(over20.problems[0]).toContain("over 20 mSv a year");
    expect(personChecks([r("Ali", "2026-03-31", 2)], today)[0].problems).toEqual([]);
  });
  it("checks eye lens and extremity sums", () => {
    const p = personChecks([r("Ali", "2026-03-31", 1, { eye: 12, ext: 300 }), r("Ali", "2026-06-30", 1, { eye: 9, ext: 250 })], "2026-11-26")[0];
    expect(p.problems).toEqual(["Eye lens 21 mSv in 2026: over 20 mSv.", "Extremities 550 mSv in 2026: over 500 mSv."]);
    expect(extraFlags({ eyeLensMsv: 2, extremityMsv: 10, periodStart: "2026-01-01", periodEnd: "2026-01-31" }, (a) => a / 12)).toEqual(["Eye lens 2 mSv over the period's share of 20 mSv a year."]);
  });
  it("checks the dose since a declared pregnancy, and who sees it", () => {
    expect(pregnancyCheck(null, [])).toBeNull();
    expect(pregnancyCheck("2026-06-01", [{ periodEnd: "2026-05-31", doseMsv: 3 }, { periodEnd: "2026-06-30", doseMsv: 0.6 }, { periodEnd: "2026-07-31", doseMsv: 0.4 }])).toEqual({ since: 1, over: true });
    expect(seesPregnancy({ id: 4, role: "BIOMEDICAL" }, 4)).toBe(true);
    expect(seesPregnancy({ id: 5, role: "BIOMEDICAL" }, 4)).toBe(false);
    expect(seesPregnancy({ id: 5, role: "ADMIN" }, null)).toBe(true);
  });
});
