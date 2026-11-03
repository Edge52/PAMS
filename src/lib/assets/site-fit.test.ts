import { describe, expect, it } from "vitest";
import { autoPlacement, checkFit, roomSize, TYPICAL, type SiteRoom } from "./site-fit";

const sq = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const ct = TYPICAL.ct.req, mri = TYPICAL.mri.req;

describe("will it fit", () => {
  it("measures a room and turns the equipment along it", () => {
    const r = roomSize(sq(0, 0, 4.8, 7));
    expect(r.length).toBeCloseTo(7); expect(r.width).toBeCloseTo(4.8);
    const p = autoPlacement(ct, { id: 1, name: "CT", poly: sq(0, 0, 4.8, 7) });
    expect(Math.abs(Math.cos(p.rot))).toBeLessThan(0.01); // along z, the long side
  });
  it("passes a big enough surveyed room and fails a small one", () => {
    const room: SiteRoom = { id: 1, name: "CT 1", poly: sq(0, 0, 7, 5), ceilingM: 2.8, doorWidthM: 1.3, doorHeightM: 2.2, floorLoadKgM2: 500, services: { leadLined: true, powerKva: 150 } };
    const ok = checkFit(ct, room);
    expect(ok.fits).toBe(true);
    expect(ok.checks.find((c) => c.key === "load")?.detail).toMatch(/247 kg\/m²/); // 2500 / (4.6 × 2.2)
    const small = checkFit(ct, { ...room, poly: sq(0, 0, 5, 3.5) });
    expect(small.fits).toBe(false);
    expect(small.checks.find((c) => c.key === "footprint")?.status).toBe("fail");
  });
  it("marks what hasn't been surveyed as unknown, not as a failure", () => {
    const r = checkFit(ct, { id: 1, name: "CT", poly: sq(0, 0, 7, 5) });
    expect(r.fits).toBe(true);
    expect(r.checks.filter((c) => c.status === "unknown").map((c) => c.key)).toEqual(expect.arrayContaining(["ceiling", "doorW", "load", "leadLined"]));
  });
  it("draws the MRI 5 gauss line and lists the rooms it reaches", () => {
    const magnet: SiteRoom = { id: 1, name: "MRI", poly: sq(0, 0, 7.5, 5) };
    const next: SiteRoom = { id: 2, name: "Waiting", poly: sq(7.5, 0, 12, 5) };
    const far: SiteRoom = { id: 3, name: "Office", poly: sq(20, 0, 24, 5) };
    const r = checkFit(mri, magnet, [magnet, next, far], { x: 4.5, z: 2.5, rot: 0 });
    expect(r.fringeRooms.map((x) => x.name)).toEqual(["Waiting"]);
    expect(r.checks.find((c) => c.key === "fringe")?.status).toBe("fail");
    const centred = checkFit(mri, { ...magnet, poly: sq(-2, -1, 10, 6) }, [next], { x: 4, z: 2.5, rot: 0 });
    expect(centred.checks.find((c) => c.key === "fringe")?.status).toBe("ok");
  });
});

describe("best spot", () => {
  it("finds room in an L-shaped room whose middle is in the wrong place", () => {
    // L: a 9 × 3 m bar and a 7 × 6 m wing; the area centroid sits near the corner.
    const L: [number, number][] = [[0, 0], [9, 0], [9, 3], [7, 3], [7, 9], [0, 9]];
    const r = checkFit(TYPICAL.ct.req, { id: 1, name: "L", poly: L });
    expect(r.checks.find((c) => c.key === "footprint")?.status).toBe("ok");
  });
});
