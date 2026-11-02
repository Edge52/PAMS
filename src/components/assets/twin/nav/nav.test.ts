import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Pt } from "../geometry";
import { buildNetwork, coverage, type NavRoom } from "./network";
import { floorRoute, route, stairsFrom, type LiftLink } from "./route";

// Two rooms either side of a corridor, 0.2 m walls (both faces drawn), door gaps 1 m wide.
const sq = (x0: number, z0: number, x1: number, z1: number): Pt[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const wall = (ax: number, az: number, bx: number, bz: number) => [ax, az, bx, bz];
const floorSegs = (doorB = true) => [
  ...wall(0, 0, 20, 0), ...wall(0, 10, 20, 10), ...wall(0, 0, 0, 10), ...wall(20, 0, 20, 10), // outline
  // corridor z 4..6; room A above (z 0..4), room B below (z 6..10)
  ...wall(0, 4, 9, 4), ...wall(10, 4, 20, 4),            // A's wall with a door at x 9..10
  ...(doorB ? [...wall(0, 6, 14, 6), ...wall(15, 6, 20, 6)] : wall(0, 6, 20, 6)), // B's door at x 14..15 (or none)
  // a sterile room C at x 16..20, z 0..4 is reached through A only if allowed: here it has its own door at x 17..18
];
const rooms: NavRoom[] = [
  { id: 1, name: "Room A", poly: sq(0, 0, 20, 4) },
  { id: 2, name: "CORRIDOR", poly: sq(0, 4, 20, 6) },
  { id: 3, name: "Room B", poly: sq(0, 6, 20, 10) },
];

describe("walking network", () => {
  it("puts rooms with doors on the network and finds a route through the doors", () => {
    const n = buildNetwork(1, floorSegs(), rooms);
    expect(coverage(n, rooms).share).toBe(1);
    const leg = floorRoute(n, { floorId: 1, x: 2, z: 2 }, { floorId: 1, x: 18, z: 8 }, "foot");
    expect(leg.estimated).toBeFalsy();
    // Through A's door (x≈9.5, z 4) and B's door (x≈14.5, z 6): longer than the straight line.
    expect(leg.metres).toBeGreaterThan(Math.hypot(16, 6) + 0.5);
    expect(leg.points.some(([x, z]) => Math.abs(z - 5) < 1.2 && x > 8 && x < 16)).toBe(true);
  });
  it("gives a room the walls cut off an assumed door, and reports it", () => {
    const n = buildNetwork(1, floorSegs(false), rooms);
    expect(n.assumed.map((a) => a.roomId)).toEqual([3]);
    expect(n.rooms.get(3)?.reached).toBe(true);
  });
  it("keeps routes out of sterile rooms unless they start or end there", () => {
    const segs = [...wall(0, 0, 30, 0), ...wall(0, 10, 30, 10), ...wall(0, 0, 0, 10), ...wall(30, 0, 30, 10), ...wall(10, 0, 10, 4), ...wall(10, 6, 10, 10), ...wall(20, 0, 20, 4), ...wall(20, 6, 20, 10)];
    const rs: NavRoom[] = [
      { id: 1, name: "West corridor", poly: sq(0, 0, 10, 10) },
      { id: 2, name: "OPERATING ROOM", poly: sq(10, 0, 20, 10) },
      { id: 3, name: "East corridor", poly: sq(20, 0, 30, 10) },
    ];
    const n = buildNetwork(1, segs, rs);
    expect(floorRoute(n, { floorId: 1, x: 2, z: 5 }, { floorId: 1, x: 28, z: 5 }, "foot").estimated).toBe(true); // can't pass through
    expect(floorRoute(n, { floorId: 1, x: 2, z: 5, roomId: 1 }, { floorId: 1, x: 15, z: 5, roomId: 2 }, "foot").estimated).toBeFalsy();
  });
  it("changes floors only by lifts the journey may use, and counts the time", () => {
    const n1 = buildNetwork(1, floorSegs(), rooms), n2 = buildNetwork(2, floorSegs(), rooms);
    const lift = (id: number, kind: LiftLink["kind"]): LiftLink => ({ id, name: `${kind} lift`, kind, waitSeconds: 40, stops: new Map([[1, [5, 5] as Pt], [2, [5, 5] as Pt]]) });
    const world = { network: (f: number) => (f === 1 ? n1 : f === 2 ? n2 : null), level: (f: number) => f, lifts: [lift(1, "PUBLIC"), lift(2, "AGV")], stairs: [] };
    const a = { floorId: 1, x: 2, z: 2 }, b = { floorId: 2, x: 18, z: 8 };
    const foot = route(world, a, b, "foot")!;
    expect(foot.liftTrips).toBe(1);
    expect(foot.legs[1].via).toBe("PUBLIC lift");
    expect(route(world, a, b, "bed")).toBeNull(); // no bed lift here, and AGV lifts never carry people
  });
  it("links stairs across floors by name and position", () => {
    const s = stairsFrom([{ floorId: 1, name: "Stair 2", at: [10, 10] }, { floorId: 2, name: "Stair 2", at: [11, 10] }, { floorId: 2, name: "Stair 3", at: [50, 10] }]);
    expect(s).toHaveLength(1);
    expect([...s[0].stops.keys()]).toEqual([1, 2]);
  });
});

describe("La Plaza", () => {
  type CadFloor = { code: string; level: number; walls: number[]; glass: number[]; columns: number[]; rooms: { code: string; name: string; poly: Pt[] }[] };
  const cad = JSON.parse(readFileSync(path.join(__dirname, "../../../../../seed-data/cad/la-plaza.json"), "utf8")) as { unitsPerMetre: number; floors: CadFloor[] };
  const s = 1 / cad.unitsPerMetre;
  let id = 0;
  const nets = cad.floors.map((f, i) => {
    const rs: NavRoom[] = f.rooms.map((r) => ({ id: ++id, name: r.name, poly: r.poly.map(([x, y]) => [x * s, y * s] as Pt) }));
    const net = buildNetwork(i + 1, [...f.walls, ...f.glass, ...f.columns].map((v) => v * s), rs);
    return { f, rs, net, cov: coverage(net, rs) };
  });
  it("puts most rooms on each clinical floor on the walking network", () => {
    const total = nets.reduce((a, x) => a + x.cov.counted, 0), reached = nets.reduce((a, x) => a + x.cov.reached, 0);
    // Measured with assumed doors; the plan's 98 % target needs the manual fixes of the next step.
    expect(reached / total).toBeGreaterThan(0.9);
    for (const x of nets.filter((n) => n.f.level >= 0)) expect(x.cov.share).toBeGreaterThan(0.85);
  }, 60_000);
  it("routes from the ambulance entrance to Resus on the garden floor", () => {
    const gf = nets.find((x) => x.f.code === "GF")!;
    const amb = gf.rs.find((r) => /AMBULANCE/i.test(r.name))!, resus = gf.rs.find((r) => /RESUS/i.test(r.name))!;
    const pa = gf.net.rooms.get(amb.id)!, pb = gf.net.rooms.get(resus.id)!;
    const leg = floorRoute(gf.net, { floorId: gf.net.floorId, x: pa.x, z: pa.z, roomId: amb.id }, { floorId: gf.net.floorId, x: pb.x, z: pb.z, roomId: resus.id }, "bed");
    expect(leg.estimated).toBeFalsy();
    expect(leg.metres).toBeGreaterThan(Math.hypot(pa.x - pb.x, pa.z - pb.z) * 0.99);
    expect(leg.metres).toBeLessThan(150);
  }, 60_000);
});
