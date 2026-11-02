import { describe, expect, it } from "vitest";
import { capPauses, pathwayCard, positionAt, samplePath, stepRoom, trackOf, type TwinFlow } from "./pathways";
import { readiness, readinessLine } from "../../../lib/flows/readiness";
import type { Link, Step } from "../../../lib/flows/model";
import type { Route } from "./nav/route";

const step = (key: string, kind: Step["kind"] = "STEP", extra: Partial<Step> = {}): Step => ({ key, label: key.toUpperCase(), kind, departmentId: null, roomId: null, minutes: null, accompanying: null, equipment: [], notes: null, ...extra });
const link = (fromKey: string, toKey: string, share = 100): Link => ({ fromKey, toKey, share, transport: "BED", urgency: "ROUTINE", condition: null });
const walk = (m: number, s: number, floorId = 1, floorChanges = 0): Route => ({
  legs: [{ floorId, kind: "walk", points: [[0, 0], [m, 0]], metres: m, seconds: s }], metres: m, seconds: s, floorChanges, liftTrips: floorChanges, estimated: false,
});

// a → b → (60 % c, 40 % z), c → z
const flow: TwinFlow = {
  id: 1, name: "T", version: 1, dailyVolume: 10,
  steps: [step("a", "START"), step("b", "STEP", { minutes: 30 }), step("c", "STEP", { minutes: 60 }), step("z", "END")],
  links: [link("a", "b"), link("b", "c", 60), link("b", "z", 40), link("c", "z")],
};

describe("pathway card", () => {
  it("weights each arrow by the share of patients taking it (hand calculation)", () => {
    const card = pathwayCard(flow, [walk(100, 160), walk(50, 80, 1, 2), walk(20, 30), null]);
    // 100 + 0.6 × 50 + 0.4 × 20 = 138 m; 160 + 0.6 × 80 + 0.4 × 30 = 220 s; care 30 + 0.6 × 60 = 66 min
    expect(card.metres).toBeCloseTo(138);
    expect(card.moveSeconds).toBeCloseTo(220);
    expect(card.careMinutes).toBeCloseTo(66);
    expect(card.floorChanges).toBeCloseTo(1.2);
    expect(card.longest?.from).toBe("A");
    expect(card.unrouted).toBe(1);
  });
});

describe("step room", () => {
  it("uses the room, else the department's largest room that isn't a corridor", () => {
    const rooms = [
      { id: 1, floorId: 1, code: "a", name: "Small", type: "CLINICAL", departmentId: 5, poly: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][] },
      { id: 2, floorId: 1, code: "b", name: "Big", type: "CLINICAL", departmentId: 5, poly: [[0, 0], [4, 0], [4, 4], [0, 4]] as [number, number][] },
      { id: 3, floorId: 1, code: "c", name: "Corridor", type: "CORRIDOR", departmentId: 5, poly: [[0, 0], [9, 0], [9, 9], [0, 9]] as [number, number][] },
    ];
    expect(stepRoom(step("x", "STEP", { roomId: 1, departmentId: 5 }), rooms)?.name).toBe("Small");
    expect(stepRoom(step("x", "STEP", { departmentId: 5 }), rooms)?.name).toBe("Big");
    expect(stepRoom(step("x"), rooms)).toBeNull();
  });
});

describe("play", () => {
  it("samples paths by the shares and ends at an end step", () => {
    let n = 0; const seq = [0, 0, 0.9]; const rnd = () => seq[n++ % seq.length]; // start, a → b, then 0.9 × 100 > 60 → z
    expect(samplePath(flow.steps, flow.links, rnd)).toEqual([0, 2]);
    expect(samplePath(flow.steps, flow.links, () => 0.1)).toEqual([0, 1, 3]);
  });
  it("moves along the route, pauses at steps, and squeezes long stays", () => {
    const routes = [walk(10, 10), walk(10, 20), walk(5, 5), walk(5, 5)];
    const keys = trackOf([0, 1, 3], flow.links, flow.steps, routes);
    expect(keys[keys.length - 1].t).toBe(10 + 30 * 60 + 20 + 60 * 60 + 5);
    expect(positionAt(keys, 5)?.x).toBeCloseTo(5);
    expect(positionAt(keys, 1e9)).toBeNull();
    const short = capPauses(keys, 60);
    expect(short[short.length - 1].t).toBe(10 + 60 + 20 + 60 + 5);
  });
});

describe("equipment readiness", () => {
  const rooms = [{ id: 10, departmentId: 1 }, { id: 11, departmentId: 1 }, { id: 20, departmentId: 2 }];
  const assets = [
    { id: 1, typeCode: "IMG-CT-128", typeName: "CT scanner", roomId: 10, status: "IN_SERVICE" },
    { id: 2, typeCode: "LIF-VEN-TRN", typeName: "Transport ventilator", roomId: 11, status: "OUT_OF_SERVICE" },
  ];
  const steps = [
    step("ct", "STEP", { roomId: 10, equipment: ["IMG-CT-128"] }),
    step("resus", "STEP", { departmentId: 1, equipment: ["LIF-VEN", "MON-PAT-HIGH"] }),
    step("loose", "STEP", { equipment: ["X"] }),
  ];
  it("finds devices in the room, else the department, by type or group code", () => {
    const r = readiness(steps, rooms, assets);
    expect(r.rows.map((x) => x.state)).toEqual(["ok", "down", "missing"]);
    expect(r.rows[1].scope).toBe("department");
    expect(r.noPlace).toEqual(["LOOSE"]);
    expect(r.blocked).toBe(true);
    expect(readinessLine(r.rows[1])).toMatch(/Transport ventilator in the department is out of action/);
  });
  it("flips with the live status", () => {
    const r = readiness(steps, rooms, assets, (a) => (a.id === 1 ? "UNDER_MAINTENANCE" : a.status));
    expect(r.rows[0].state).toBe("down");
  });
});
