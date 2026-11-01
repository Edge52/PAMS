import { describe, expect, it } from "vitest";
import { comparePlan, planBand, spreadGhosts } from "./plan-installed";

describe("plan vs installed", () => {
  it("counts missing, extra and delivered per department", () => {
    const g = comparePlan(
      [{ departmentId: 1, deviceTypeId: 10, planned: 8 }, { departmentId: 1, deviceTypeId: 11, planned: 2 }, { departmentId: 2, deviceTypeId: 10, planned: 4 }],
      [{ departmentId: 1, deviceTypeId: 10, installed: 5, inStock: 2 }, { departmentId: 1, deviceTypeId: 12, installed: 1, inStock: 0 },
        { departmentId: 2, deviceTypeId: 10, installed: 6, inStock: 0 }, { departmentId: 9, deviceTypeId: 10, installed: 3, inStock: 0 }],
    );
    expect(g.map((d) => d.departmentId)).toEqual([1, 2]); // department 9 isn't in the plan
    const icu = g[0];
    expect(icu).toMatchObject({ planned: 10, installed: 5, inStock: 2, missing: 5, extra: 1, share: 0.5 });
    expect(icu.items[0]).toMatchObject({ deviceTypeId: 10, missing: 3, inStock: 2 });
    expect(g[1]).toMatchObject({ planned: 4, installed: 4, missing: 0, extra: 2, share: 1 });
  });
  it("bands completeness", () => {
    expect([1, 0.8, 0.5, 0.1, 0].map(planBand)).toEqual([0, 1, 2, 3, 3]);
  });
  it("spreads ghosts over a department's rooms, biggest first, within the caps", () => {
    const rooms = new Map([[1, [{ id: 11, area: 10 }, { id: 12, area: 40 }]], [2, [{ id: 21, area: 5 }]]]);
    const s = spreadGhosts([{ departmentId: 1, missing: 3 }, { departmentId: 2, missing: 20 }, { departmentId: 3, missing: 2 }], rooms, { perRoom: 4 });
    expect(Object.fromEntries(s)).toEqual({ 12: 2, 11: 1, 21: 4 });
    expect([...spreadGhosts([{ departmentId: 2, missing: 20 }], rooms, { cap: 3 }).values()]).toEqual([3]);
  });
});
