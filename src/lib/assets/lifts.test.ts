import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { liftAllowed, liveStops, suggestLifts, type LiftFloor, type LiftRoom } from "./lifts";
import type { Pt } from "../../components/assets/twin/geometry";

const sq = (x: number, y: number, s = 40): Pt[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const floors: LiftFloor[] = [-1, 0, 1, 2, 3].map((level) => ({ id: 10 + level, level, unitsPerMetre: 10, name: `F${level}` }));

describe("suggestLifts", () => {
  it("joins lift lobbies stacked on several floors into one core and fills a floor with no lobby", () => {
    const rooms: LiftRoom[] = [
      { floorId: 10, name: "ELEVATOR LOBBY", poly: sq(100, 100) },
      { floorId: 12, name: "Public lobby", poly: sq(130, 100) }, // 3 m away: same core
      { floorId: 13, name: "PUBLIC LOBBY", poly: sq(100, 110) },
    ];
    const [s] = suggestLifts(floors, rooms);
    expect(s.kind).toBe("PUBLIC");
    expect(s.stops.map((x) => x.floorId)).toEqual([10, 11, 12, 13]); // floor 11 filled between
    expect(s.note).toMatch(/assumed on F1/);
    expect(s.inferred).toBe(true);
  });

  it("extends to plain lobbies above and below, and stops at the first floor without one", () => {
    const rooms: LiftRoom[] = [
      { floorId: 10, name: "Lift lobby", poly: sq(500, 500) },
      { floorId: 11, name: "Lift lobby", poly: sq(500, 500) },
      { floorId: 9, name: "LOBBY", poly: sq(510, 505) },   // below: joins
      { floorId: 12, name: "Office", poly: sq(500, 500) }, // not a lobby: stops here
      { floorId: 13, name: "LOBBY", poly: sq(500, 500) },  // beyond the gap: not reached
    ];
    const [s] = suggestLifts(floors, rooms);
    expect(s.stops.map((x) => x.floorId)).toEqual([9, 10, 11]);
  });

  it("keeps lobbies far apart as separate cores and ignores a lobby on one floor only", () => {
    const rooms: LiftRoom[] = [
      { floorId: 10, name: "Lift lobby", poly: sq(0, 0) }, { floorId: 11, name: "Lift lobby", poly: sq(0, 0) },
      { floorId: 10, name: "Lift lobby", poly: sq(900, 0) }, { floorId: 11, name: "Lift lobby", poly: sq(900, 0) },
      { floorId: 12, name: "Lift lobby", poly: sq(400, 700) },
    ];
    expect(suggestLifts(floors, rooms)).toHaveLength(2);
  });

  it("reads AGV lobbies as AGV lifts plus an assumed bed lift, parking as public, emergency as bed", () => {
    const rooms: LiftRoom[] = [
      { floorId: 10, name: "AGV Lobby", poly: sq(0, 0) }, { floorId: 11, name: "AGV Lobby", poly: sq(0, 0) },
      { floorId: 10, name: "Parking Elevator Lobby", poly: sq(500, 0) }, { floorId: 9, name: "Lobby", poly: sq(500, 0) },
      { floorId: 11, name: "ELEVATOR LOBBY", code: "GF-ER-05", poly: sq(0, 600) }, { floorId: 10, name: "LOBBY", poly: sq(0, 600) },
    ];
    const kinds = suggestLifts(floors, rooms).map((s) => `${s.kind}:${s.name.split(" (")[0]}`).sort();
    expect(kinds).toEqual(["AGV:AGV lifts", "BED:Back-of-house bed lift", "BED:Emergency bed lift", "PUBLIC:Parking lifts"]);
  });

  it("finds bed, public, parking and emergency lifts in the La Plaza drawings", () => {
    type CadFloor = { code: string; name: string; level: number; rooms: { code: string; name: string; dept: string | null; poly: Pt[] }[] };
    const cad = JSON.parse(readFileSync(path.join(__dirname, "../../../seed-data/cad/la-plaza.json"), "utf8")) as { unitsPerMetre: number; floors: CadFloor[] };
    const fl: LiftFloor[] = cad.floors.map((f, i) => ({ id: i + 1, level: f.level, unitsPerMetre: cad.unitsPerMetre, name: f.name }));
    const rooms: LiftRoom[] = cad.floors.flatMap((f, i) => f.rooms.map((r) => ({ floorId: i + 1, name: r.name, code: r.code, dept: r.dept, poly: r.poly })));
    const out = suggestLifts(fl, rooms);
    const span = (kind: string, name: RegExp) => {
      const s = out.find((x) => x.kind === kind && name.test(x.name));
      return s ? s.stops.map((x) => cad.floors[x.floorId - 1].code) : null;
    };
    const all = cad.floors.map((f) => f.code);
    // Back-of-house lifts at the AGV lobby serve every floor: the only bed route to the ICU floors.
    expect(span("AGV", /AGV/)).toEqual(all);
    expect(span("BED", /Back-of-house/)).toEqual(all);
    expect(span("PUBLIC", /Public/)).toEqual(["GF", "GR", "F1", "F2", "F3", "F4", "F5"]);
    expect(span("PUBLIC", /Parking/)).toEqual(["B2", "B1", "GF", "GR"]);
    expect(span("BED", /Emergency/)).toEqual(["B2", "B1", "GF"]);
  });
});

describe("liftAllowed", () => {
  it("lets beds use bed lifts only and never sends people through AGV lifts", () => {
    expect(liftAllowed("BED", "bed")).toBe(true);
    expect(liftAllowed("PUBLIC", "bed")).toBe(false);
    expect(liftAllowed("PUBLIC", "wheelchair")).toBe(true);
    expect(liftAllowed("AGV", "foot")).toBe(false);
    expect(liftAllowed("SERVICE", "supplies")).toBe(true);
  });
});

describe("liveStops", () => {
  it("drops stops on deleted floors and orders the rest by level", () => {
    expect(liveStops([{ floorId: 13, x: 0, y: 0 }, { floorId: 99, x: 0, y: 0 }, { floorId: 10, x: 1, y: 1 }], floors).map((s) => s.floorId)).toEqual([10, 13]);
  });
});
