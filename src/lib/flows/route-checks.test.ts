import { describe, expect, it } from "vitest";
import { buildingChecks, type CheckRoom } from "./route-checks";
import { RouteService } from "../../components/assets/twin/nav/service";
import type { TwinData } from "../../components/assets/twin/types";
import type { Link, Step } from "./model";

// Two floors (plan units = 10 per metre), each a corridor with two rooms off it; a public lift joins them.
const sq = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const floorRooms = (floorId: number, base: number): CheckRoom[] => [
  { id: base + 1, floorId, name: "CORRIDOR", departmentId: null, type: "CORRIDOR", poly: sq(0, 40, 300, 60) },
  { id: base + 2, floorId, name: "Room A", departmentId: 1, type: "PATIENT_ROOM", poly: sq(0, 0, 100, 40) },
  { id: base + 3, floorId, name: "Staff base", departmentId: null, type: "OFFICE", poly: sq(100, 0, 200, 40), zone: "STAFF" },
  { id: base + 4, floorId, name: "Room B", departmentId: 2, type: "PATIENT_ROOM", poly: sq(200, 0, 300, 40) },
];
const rooms = [...floorRooms(1, 0), ...floorRooms(2, 10)];
const data = (liftKind: "PUBLIC" | "BED"): TwinData => ({
  facility: { id: 1, name: "", code: "" }, can: { report: false, move: false, maintain: false, addAsset: false }, facilities: [],
  floors: [1, 2].map((id) => ({ id, name: `F${id}`, level: id, buildingName: "", elevation: id * 5, planWidth: 300, planHeight: 60, unitsPerMetre: 10, hasCad: false })),
  rooms: rooms.map((r) => ({ ...r, code: `R${r.id}`, zone: r.zone as TwinData["rooms"][number]["zone"] })), departments: [], assets: [], unplaced: [],
  lifts: [{ id: 1, name: "Lift 1", kind: liftKind, inferred: false, cars: 1, stops: [{ floorId: 1, x: 290, y: 50 }, { floorId: 2, x: 290, y: 50 }] }],
});
const step = (key: string, kind: Step["kind"], roomId: number | null, extra: Partial<Step & { roomCode: string; roomLabel: string }> = {}) =>
  ({ key, label: key.toUpperCase(), kind, departmentId: null, roomId, minutes: 10, accompanying: null, equipment: [], notes: null, ...extra });
const link = (fromKey: string, toKey: string, transport: Link["transport"] = "FOOT"): Link => ({ fromKey, toKey, share: 100, transport, urgency: "ROUTINE", condition: null });

describe("pathway building checks", () => {
  it("blocks a bed leg between floors without a bed lift, and allows it with one", async () => {
    const steps = [step("a", "START", 2), step("b", "END", 14)];
    const bad = await buildingChecks(steps, [link("a", "b", "BED")], rooms, new RouteService(data("PUBLIC"), async () => null));
    expect(bad.filter((i) => i.level === "error").map((i) => i.message).join()).toMatch(/no bed lift/);
    const ok = await buildingChecks(steps, [link("a", "b", "BED")], rooms, new RouteService(data("BED"), async () => null));
    expect(ok.filter((i) => i.level === "error")).toEqual([]);
  });
  it("flags a room removed by a drawing update, and unknown equipment codes", async () => {
    const steps = [step("a", "START", 2), step("x", "STEP", null, { roomCode: "ICU-07", roomLabel: "ICU (7)", equipment: ["XXX-NOPE"] }), step("b", "END", 4)];
    const issues = await buildingChecks(steps, [link("a", "x"), link("x", "b")], rooms, new RouteService(data("BED"), async () => null), { catalogue: new Set(["MON-PAT-HIGH"]) });
    expect(issues.some((i) => i.level === "error" && /ICU-07.*no longer in the drawings/.test(i.message))).toBe(true);
    expect(issues.some((i) => /XXX-NOPE isn't in the catalogue/.test(i.message))).toBe(true);
  });
});
