import { describe, expect, it } from "vitest";
import { scaleBar } from "./hud-map";

describe("scale bar (wave 22b)", () => {
  it("picks a round length close to 90 px", () => {
    expect(scaleBar(0.1)).toEqual({ metres: 10, px: 100 });
    expect(scaleBar(0.02).metres).toBe(2);
    expect(scaleBar(1).metres).toBe(100);
    const far = scaleBar(4); expect(far.metres).toBe(500); expect(far.px).toBe(125);
  });
});
