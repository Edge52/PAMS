import { describe, expect, it } from "vitest";
import { downtimeMs, downtimeMsByDevice, mergeIntervals } from "./downtime";

const t = (s: string) => new Date(s);
const H = 3_600_000;

describe("downtime periods (wave 35)", () => {
  it("merges overlapping and touching intervals", () => {
    expect(mergeIntervals([[5, 8], [1, 3], [2, 4], [4, 5], [10, 12], [11, 11]])).toEqual([[1, 8], [10, 12]]);
    expect(mergeIntervals([])).toEqual([]);
  });
  it("clips to the window, runs open periods to its end and counts overlaps once", () => {
    const from = t("2026-10-01T00:00:00Z"), to = t("2026-10-05T00:00:00Z");
    expect(downtimeMs([
      { start: t("2026-09-30T00:00:00Z"), end: t("2026-10-02T00:00:00Z") }, // 24 h inside
      { start: t("2026-10-01T12:00:00Z"), end: t("2026-10-01T18:00:00Z") }, // inside the first
      { start: t("2026-10-04T00:00:00Z"), end: null },                       // 24 h, still down
    ], from, to) / H).toBe(48);
  });
  it("merges per device only", () => {
    const p = { start: t("2026-10-01T00:00:00Z"), end: t("2026-10-02T00:00:00Z") };
    const m = downtimeMsByDevice([{ ...p, device: "A" }, { ...p, device: "A" }, { ...p, device: "B" }], t("2026-10-01T00:00:00Z"), t("2026-11-01T00:00:00Z"));
    expect([...m].map(([k, ms]) => [k, ms / H])).toEqual([["A", 24], ["B", 24]]);
  });
});
