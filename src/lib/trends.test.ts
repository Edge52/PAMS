import { describe, expect, it } from "vitest";
import { direction, monthKeys, monthLabel, onMonths, onTimeShare } from "./trends";

describe("dashboard trends (wave 26)", () => {
  it("lists the last twelve months, oldest first, across a year change", () => {
    const k = monthKeys("2026-11-17");
    expect(k).toHaveLength(12);
    expect(k[0]).toBe("2025-12");
    expect(k[11]).toBe("2026-11");
    expect(monthKeys("2026-02-28", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
  it("labels months, with the year on January", () => {
    expect(monthLabel("2026-11")).toBe("Nov");
    expect(monthLabel("2026-01")).toBe("Jan 26");
  });
  it("fills missing months with zero", () => {
    expect(onMonths(["2026-09", "2026-10", "2026-11"], [{ month: "2026-11-01", n: "4" }, { month: "2026-09", n: 2 }, { month: null, n: 9 }])).toEqual([2, 0, 4]);
  });
  it("works out the share done on time", () => {
    expect(onTimeShare([4, 0, 3], [3, 0, 3])).toEqual([75, null, 100]);
  });
  it("describes the direction in words", () => {
    expect(direction([0, 0, 0, 10, 10, 10, 12, 12, 12])).toEqual({ text: "up 20% on the three months before", dir: "up" });
    expect(direction([10, 10, 10, 8, 8, 8])).toEqual({ text: "down 20% on the three months before", dir: "down" });
    expect(direction([10, 10, 10, 10, 10, 9]).dir).toBe("flat");
    expect(direction([0, 0, 0, 0, 0, 0]).text).toBe("none in six months");
    expect(direction([0, 0, 0, 1, 0, 0]).dir).toBe("up");
    expect(direction([5, 5, 4, 10, 16, 166]).text).toBe("14 times as many as the three months before");
  });
});
