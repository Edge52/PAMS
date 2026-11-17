import { describe, expect, it } from "vitest";
import { pageOf, PLAN_TABS, ROOMS_PER_PAGE } from "./commissioning-view";

describe("commissioning plan page parts (wave 27)", () => {
  it("pages rooms and keeps the page in range", () => {
    expect(pageOf(0, 1)).toEqual({ page: 1, pages: 1, from: 0, to: 0 });
    expect(pageOf(130, 1)).toEqual({ page: 1, pages: 6, from: 0, to: 25 });
    expect(pageOf(130, 6)).toEqual({ page: 6, pages: 6, from: 125, to: 130 });
    expect(pageOf(130, 99).page).toBe(6);
    expect(pageOf(130, -3).page).toBe(1);
    expect(pageOf(130, NaN).page).toBe(1);
  });
  it("keeps the table small and the edit-only tabs marked", () => {
    expect(ROOMS_PER_PAGE * 5).toBeLessThanOrEqual(150); // five fields per room
    expect(PLAN_TABS.filter((t) => t.edit).map((t) => t.key)).toEqual(["dates", "settings"]);
  });
});
