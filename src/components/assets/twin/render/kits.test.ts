import { describe, expect, it } from "vitest";
import { MODEL_SIZE, obbOverlap, placeKit, roomLook } from "./kits";
import { pointInPolygon, type Pt } from "../geometry";

const rect = (w: number, d: number): Pt[] => [[0, 0], [w, 0], [w, d], [0, d]];

describe("roomLook", () => {
  it("reads La Plaza's room names into finishes and kits", () => {
    expect(roomLook("ICU (3)").items[0].model).toBe("bed");
    expect(roomLook("OPERATING ROOM").finish).toBe("theatre");
    expect(roomLook("C-SECTION").items.map((i) => i.model)).toContain("or-table");
    expect(roomLook("Patient TLT").finish).toBe("wet");
    expect(roomLook("PUB. TLT (M)").items[0].model).toBe("wc");
    expect(roomLook("MED/SURG DOUBLE (4)").items[0].model).toBe("bed");
    expect(roomLook("SCN 3").items[0].model).toBe("incubator");
    expect(roomLook("CORRIDOR").items).toEqual([]);
    expect(roomLook("HEAD OF DEPT.").finish).toBe("wood");
    expect(roomLook("Stair 2").finish).toBe("concrete");
    expect(roomLook("CT").items[0].model).toBe("ct");
  });
  it("falls back to the room type, then to a plain finish", () => {
    expect(roomLook("Room 12", "OFFICE").finish).toBe("wood");
    expect(roomLook("Room 12").items).toEqual([]);
  });
});

describe("obbOverlap", () => {
  it("detects overlap of rotated rectangles and passes ones apart", () => {
    expect(obbOverlap({ x: 0, z: 0, hw: 1, hd: 1, rot: 0 }, { x: 1.5, z: 0, hw: 1, hd: 1, rot: Math.PI / 4 })).toBe(true);
    expect(obbOverlap({ x: 0, z: 0, hw: 1, hd: 1, rot: 0 }, { x: 3, z: 0, hw: 1, hd: 1, rot: 0 })).toBe(false);
  });
});

describe("placeKit", () => {
  it("puts beds against the walls inside the room, facing in, without overlaps", () => {
    const poly = rect(6, 5);
    const out = placeKit(poly, roomLook("ICU (2)"));
    const beds = out.filter((p) => p.model === "bed");
    expect(beds.length).toBeGreaterThanOrEqual(2);
    expect(out.some((p) => p.model === "monitor")).toBe(true);
    for (const p of out) expect(pointInPolygon([p.x, p.z], poly)).toBe(true);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      const box = (p: typeof a) => ({ x: p.x, z: p.z, hw: MODEL_SIZE[p.model].w / 2, hd: MODEL_SIZE[p.model].d / 2, rot: p.rot });
      expect(obbOverlap(box(a), box(b), 0)).toBe(false);
    }
    // A bed's front faces into the room: its centre is further from its wall than its back.
    const b = beds[0];
    const front = [b.x + Math.sin(b.rot), b.z + Math.cos(b.rot)] as Pt;
    expect(pointInPolygon(front, poly)).toBe(true);
  });
  it("keeps clear of doors", () => {
    const poly = rect(4, 3);
    const free = placeKit(poly, roomLook("OFFICE"));
    const blocked = placeKit(poly, roomLook("OFFICE"), [[2, 0], [2, 3], [0, 1.5], [4, 1.5]], [], 1.6);
    expect(free.length).toBeGreaterThan(0);
    expect(blocked.length).toBeLessThan(free.length);
  });
  it("puts the theatre table in the middle with lights over it", () => {
    const out = placeKit(rect(7, 7), roomLook("OPERATING ROOM"));
    const table = out.find((p) => p.model === "or-table")!;
    expect(Math.hypot(table.x - 3.5, table.z - 3.5)).toBeLessThan(0.6);
    expect(out.filter((p) => p.model === "or-light").length).toBe(2);
  });
  it("leaves a room too small for its kit empty instead of overlapping", () => {
    expect(placeKit(rect(1, 1), roomLook("ICU (1)"))).toEqual([]);
  });
});
