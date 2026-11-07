import { describe, expect, it } from "vitest";
import { checkClashes, convexOverlap, footprint, mrSafe, type ClashDevice } from "./clash";

const room = { id: 1, name: "CT", poly: [[0, 0], [8, 0], [8, 6], [0, 6]] as [number, number][], ceilingM: 2.7 };
const dev = (o: Partial<ClashDevice> & { id: number }): ClashDevice => ({ tag: `T${o.id}`, name: "Device", typeCode: "MON-PAT-HIGH", roomId: 1, x: 4, z: 3, angle: 0, l: 1, w: 0.5, h: 1, longX: true, zones: [], fringe: null, placed: true, ...o });

describe("clash and clearance checks (wave 17, phase 7)", () => {
  it("turns footprints with the device", () => {
    const f = footprint(dev({ id: 1, l: 2, w: 1, angle: Math.PI / 2 }));
    const xs = f.map((p) => p[0]), zs = f.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1); expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2);
    expect(convexOverlap([[0, 0], [1, 0], [1, 1], [0, 1]], [[0.9, 0], [2, 0], [2, 1], [0.9, 1]])).toBe(true);
    expect(convexOverlap([[0, 0], [1, 0], [1, 1], [0, 1]], [[1.01, 0], [2, 0], [2, 1], [1.01, 1]])).toBe(false);
  });
  it("finds devices outside their room, on top of each other, and taller than the ceiling", () => {
    const issues = checkClashes([room], [dev({ id: 1, x: 7.9 }), dev({ id: 2, x: 2 }), dev({ id: 3, x: 2.3, h: 3 })]);
    expect(issues.find((i) => i.kind === "outside")?.deviceId).toBe(1);
    expect(issues.find((i) => i.kind === "overlap")).toMatchObject({ deviceId: 2, otherId: 3 });
    expect(issues.find((i) => i.kind === "ceiling")?.deviceId).toBe(3);
  });
  it("checks clear zones against walls and other devices, doors and the MRI fringe field", () => {
    const ct = dev({ id: 10, typeCode: "IMG-CT-128", name: "CT", x: 4, z: 3, l: 4, w: 2, zones: [{ name: "Patient transfer", kind: "patient", side: "foot", depth: 1.5 }, { name: "Service", kind: "service", side: "head", depth: 2 }] });
    // Foot zone x 6..7.5 inside; head zone x 0..2 → 0 to 2 inside (room starts at 0) — move it to make the head zone hit the wall.
    const ctNearWall = { ...ct, x: 3 };
    const trolley = dev({ id: 11, x: 5.7, z: 3 });
    const issues = checkClashes([room], [ctNearWall, trolley], [[0.2, 3]]);
    expect(issues.find((i) => i.kind === "zone-wall")?.text).toMatch(/Service/);
    expect(issues.some((i) => i.kind === "zone-blocked" && i.deviceId === 10 && i.otherId === 11)).toBe(true);
    const mri = dev({ id: 20, typeCode: "IMG-MRI-15T", name: "MRI", l: 2.4, w: 2.1, fringe: { along: 4, across: 2.5 } });
    const pump = dev({ id: 21, typeCode: "INF-PMP-VOL", name: "Pump", x: 6.5, z: 3 }), mrPump = dev({ id: 22, typeCode: "INF-PMP-MRI", name: "MR pump", x: 1.5, z: 3 });
    const f = checkClashes([{ ...room, poly: [[-5, -5], [13, -5], [13, 11], [-5, 11]] }], [mri, pump, mrPump]).filter((i) => i.kind === "fringe");
    expect(f.map((i) => i.deviceId)).toEqual([21]);
    expect(mrSafe({ typeCode: "LIF-VEN-MRI", name: "" })).toBe(true);
    expect(checkClashes([room], [dev({ id: 30, x: 0.6, z: 3 })], [[0.2, 3]]).some((i) => i.kind === "door")).toBe(true);
  });
  it("checks devices only assigned to a room without their positions", () => {
    const small = { ...room, poly: [[0, 0], [3, 0], [3, 3], [0, 3]] as [number, number][], ceilingM: 2.5 };
    const ct = dev({ id: 40, typeCode: "IMG-CT-128", name: "CT", l: 4, w: 2, h: 2, placed: false, zones: [{ name: "Patient transfer", kind: "patient", side: "foot", depth: 1.5 }] });
    const tall = dev({ id: 41, h: 2.8, placed: false });
    const issues = checkClashes([small], [ct, tall]);
    expect(issues.find((i) => i.kind === "crowded")?.deviceId).toBe(40);
    expect(issues.find((i) => i.kind === "ceiling")?.deviceId).toBe(41);
    expect(issues.some((i) => i.kind === "overlap" || i.kind === "outside")).toBe(false);
    const mri = dev({ id: 50, typeCode: "IMG-MRI-15T", name: "MRI", placed: false, fringe: { along: 4, across: 2.5 } });
    expect(checkClashes([room], [mri, dev({ id: 51, placed: false }), dev({ id: 52, typeCode: "MON-PAT-MRI", placed: false })]).filter((i) => i.kind === "fringe").map((i) => i.deviceId)).toEqual([51]);
  });
});

describe("guessed outlines", () => {
  it("skip the area checks", async () => {
    const { checkClashes } = await import("./clash");
    const tiny = { id: 1, name: "P/R", poly: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][], ceilingM: null, guessed: true };
    const d = { id: 1, tag: "T", name: "Chair", typeCode: "FUR-STR", roomId: 1, x: 0.5, z: 0.5, angle: 0, l: 2, w: 1, h: 1, longX: true, placed: false, fringe: null,
      zones: [{ name: "Access", kind: "staff" as const, side: "all" as const, depth: 1 }] };
    expect(checkClashes([tiny], [d])).toEqual([]);
  });
});
