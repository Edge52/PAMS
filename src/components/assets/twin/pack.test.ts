import { describe, expect, it } from "vitest";
import { packTwin, unpackTwin } from "./pack";
import type { TwinAsset, TwinData, TwinRoom } from "./types";

const site0 = { ceilingM: null, doorWidthM: null, doorHeightM: null, floorLoadKgM2: null, services: null };
const room = (id: number, extra: Partial<TwinRoom> = {}): TwinRoom => ({
  id, floorId: 1, code: `R${id}`, name: "Room", type: "CLINICAL", departmentId: 3, zone: null, workshop: false, site: site0,
  poly: [[0, 0], [10, 0], [10, 10]], outlineSource: null, verified: false, ...extra,
});
const asset = (id: number, extra: Partial<TwinAsset> = {}): TwinAsset => ({
  id, tag: `LPH-MON-${id}`, deviceType: "Patient monitor", typeCode: "MON-PAT-HIGH", category: "Monitoring", categoryCode: "MON", groupCode: "MON-PAT",
  status: "IN_SERVICE", criticality: null, roomId: 5, posX: null, posY: null, manufacturer: null, model: null, serial: null, dims: { l: 0.6, w: 0.5, h: 1 }, rot: null, ...extra,
});
const data = (): TwinData => ({
  facility: { id: 1, name: "H", code: "H" }, can: { report: true, move: true, maintain: true, addAsset: true }, facilities: [], floors: [], departments: [], lifts: [],
  rooms: [room(1), room(2, { zone: "STAFF", workshop: true, verified: true, outlineSource: "walls", site: { ...site0, ceilingM: 3 } })],
  assets: Array.from({ length: 50 }, (_, i) => asset(i + 1, i % 2 ? { posX: 1.5, posY: 2, rot: 90, manufacturer: "GE", model: "B40", serial: "S1", lib: "t:MON", criticality: "HIGH" } : {})),
  unplaced: [asset(99, { roomId: null, deviceType: "Infusion pump", typeCode: "INF-PUMP", category: "Infusion", categoryCode: "INF", groupCode: null })],
});

describe("3D page data on the wire (R6)", () => {
  it("unpacks to exactly what the server built", () => {
    const d = data();
    expect(unpackTwin(JSON.parse(JSON.stringify(packTwin(d))))).toEqual(d);
  });
  it("is much smaller than the plain data", () => {
    const d = data();
    expect(JSON.stringify(packTwin(d)).length).toBeLessThan(JSON.stringify(d).length * 0.55);
    expect(packTwin(d).packed.types.length).toBe(2);
  });
});
