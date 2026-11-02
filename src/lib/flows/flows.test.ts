import { describe, expect, it } from "vitest";
import { checkFlow, layoutFlow, nextKey, stepVolumes, type Link, type Step } from "./model";
import { resolveStarter, STARTERS } from "./starters";

const step = (key: string, kind: Step["kind"] = "STEP", place = true): Step => ({ key, label: key.toUpperCase(), kind, departmentId: place ? 1 : null, roomId: null, minutes: 10, accompanying: null, equipment: [], notes: null });
const link = (fromKey: string, toKey: string, share = 100): Link => ({ fromKey, toKey, share, transport: "FOOT", urgency: "ROUTINE", condition: null });

describe("checkFlow", () => {
  it("passes a simple pathway", () => {
    expect(checkFlow([step("a", "START"), step("b"), step("c", "END")], [link("a", "b"), link("b", "c")]).filter((i) => i.level === "error")).toEqual([]);
  });
  it("catches branches not adding up, unreachable steps, dead ends and loops without exit", () => {
    const issues = checkFlow(
      [step("a", "START"), step("b"), step("c"), step("d"), step("e"), step("z", "END"), step("lost")],
      [link("a", "b", 60), link("a", "c", 30), link("b", "z"), link("c", "d"), link("d", "c")],
    ).map((i) => i.message);
    expect(issues.some((m) => /A add up to 90 %/.test(m))).toBe(true);
    expect(issues.some((m) => /LOST can't be reached/.test(m))).toBe(true);
    expect(issues.some((m) => /E can't be reached/.test(m))).toBe(true);
    expect(issues.some((m) => /C patients go round in a loop/.test(m))).toBe(true);
    expect(issues.some((m) => /LOST goes nowhere/.test(m))).toBe(true);
  });
  it("needs a start and an end, and warns about steps with no place", () => {
    const issues = checkFlow([step("a"), step("b", "STEP", false)], [link("a", "b")]);
    expect(issues.filter((i) => i.level === "error").map((i) => i.message).join(" ")).toMatch(/No start step.*No end step/);
    expect(issues.some((i) => i.level === "warning" && /B has no place/.test(i.message))).toBe(true);
  });
});

describe("stepVolumes", () => {
  it("splits patients by the shares, and follows a loop until it settles", () => {
    const v = stepVolumes([step("a", "START"), step("b"), step("c"), step("z", "END")], [link("a", "b", 70), link("a", "c", 30), link("b", "z"), link("c", "z")], 100);
    expect(v.get("b")).toBeCloseTo(70); expect(v.get("c")).toBeCloseTo(30); expect(v.get("z")).toBeCloseTo(100);
    // 20 % come back from b to a: a sees 100 / (1 − 0.2) = 125 a day.
    const loop = stepVolumes([step("a", "START"), step("b"), step("z", "END")], [link("a", "b"), link("b", "a", 20), link("b", "z", 80)], 100);
    expect(loop.get("a")).toBeCloseTo(125);
    expect(loop.get("z")).toBeCloseTo(100);
  });
});

describe("layoutFlow and nextKey", () => {
  it("lays steps out left to right by the arrows, ends last, ignoring arrows back", () => {
    const l = layoutFlow([step("a", "START"), step("b"), step("c"), step("z", "END")], [link("a", "b"), link("b", "c"), link("c", "b"), link("a", "z", 0), link("c", "z")]);
    expect([l.get("a")!.col, l.get("b")!.col, l.get("c")!.col, l.get("z")!.col]).toEqual([0, 1, 2, 3]);
  });
  it("finds a free key", () => { expect(nextKey(["s1", "s2", "s4"])).toBe("s3"); });
});

describe("starters", () => {
  it("are all valid pathways", () => {
    for (const st of STARTERS) {
      const r = resolveStarter(st, [], []);
      const errors = checkFlow(r.steps, r.links).filter((i) => i.level === "error");
      expect(errors, st.id).toEqual([]);
      expect(st.arrival.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
    }
  });
  it("resolve departments by type and rooms by name, preferring the department's own rooms", () => {
    const depts = [{ id: 1, typeCode: "ER", name: "Emergency" }, { id: 2, typeCode: "RAD", name: "Imaging" }, { id: 3, typeCode: "ICU", name: "ICU" }];
    const rooms = [
      { id: 10, name: "Ambulance vestibule", departmentId: 1, level: 0 }, { id: 11, name: "Resus/Trauma 1", departmentId: 1, level: 0 },
      { id: 12, name: "CT", departmentId: 2, level: 0 }, { id: 13, name: "ICU (1)", departmentId: 3, level: 5 },
    ];
    const r = resolveStarter(STARTERS.find((s) => s.id === "trauma")!, depts, rooms);
    expect(r.steps.find((s) => s.key === "s2")).toMatchObject({ departmentId: 1, roomId: 11 });
    expect(r.steps.find((s) => s.key === "s3")).toMatchObject({ departmentId: 2, roomId: 12 });
    expect(r.unresolved).toEqual(["Emergency surgery", "Surgical ward"]);
  });
});
