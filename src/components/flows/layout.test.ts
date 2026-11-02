import { describe, expect, it } from "vitest";
import { autoSpot, snap, stepPositions } from "./layout";
import type { Link, Step } from "../../lib/flows/model";

const step = (key: string, kind: Step["kind"], xy?: [number, number]) => ({ key, label: key, kind, departmentId: null, roomId: null, minutes: null, accompanying: null, equipment: [], notes: null, x: xy?.[0] ?? null, y: xy?.[1] ?? null });
const link = (fromKey: string, toKey: string): Link => ({ fromKey, toKey, share: 100, transport: "FOOT", urgency: "ROUTINE", condition: null });

describe("canvas positions", () => {
  it("uses saved spots, else the automatic layout", () => {
    const p = stepPositions([step("a", "START", [100, 40]), step("b", "END")], [link("a", "b")]);
    expect(p.get("a")).toEqual({ x: 100, y: 40 });
    expect(p.get("b")).toEqual(autoSpot(1, 0));
  });
  it("snaps to the 20 px grid", () => { expect(snap(31)).toBe(40); expect(snap(29)).toBe(20); });
});
