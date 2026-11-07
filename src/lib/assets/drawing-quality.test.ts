import { describe, expect, it } from "vitest";
import { drawingQuality, overlaps, roomConfidence, type Pt, type QFloor } from "./drawing-quality";

const sq = (x: number, y: number, w: number, h = w): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const cad = (over: Partial<NonNullable<QFloor["cad"]>> = {}): NonNullable<QFloor["cad"]> => ({ sourceFile: "F1.dwg", revision: null, importedAt: "2026-11-01T10:00:00Z",
  segments: { walls: 1000, doors: 200, glass: 50, columns: 40 }, alignment: { lifts: 8, residualMm: 20 }, ...over });
const room = (id: number, poly: Pt[], outlineSource: string | null = "walls", verified = false) => ({ id, code: `R${id}`, name: `Room ${id}`, type: "OTHER", poly, outlineSource, verified });

describe("drawing quality (wave 16)", () => {
  it("gives a room its confidence", () => {
    expect(roomConfidence({ outlineSource: "walls", verified: false })).toBe("drawing");
    expect(roomConfidence({ outlineSource: "split", verified: false })).toBe("assumed");
    expect(roomConfidence({ outlineSource: null, verified: false })).toBe("assumed");
    expect(roomConfidence({ outlineSource: "fallback", verified: true })).toBe("verified");
  });
  it("finds overlapping outlines, not neighbours", () => {
    expect(overlaps([{ id: 1, poly: sq(0, 0, 100) }, { id: 2, poly: sq(100, 0, 100) }, { id: 3, poly: sq(10, 10, 50) }])).toEqual([[1, 3]]);
  });
  it("scores a clean floor high and lists what's wrong with a poor one", () => {
    const good: QFloor = { id: 1, name: "First", level: 1, unitsPerMetre: 10, cad: cad(), rooms: [room(1, sq(0, 0, 100)), room(2, sq(100, 0, 100), "walls", true)] };
    const poor: QFloor = { id: 2, name: "Second", level: 2, unitsPerMetre: 1000, unreachable: [5],
      cad: cad({ importedAt: "2026-08-01T10:00:00Z", segments: { walls: 900, doors: 0, glass: 0, columns: 10 }, alignment: { lifts: 1, residualMm: 900 } }),
      rooms: [room(3, sq(0, 0, 100), "fallback"), room(4, sq(0, 0, 90), "split"), room(5, sq(300, 0, 5), null)] };
    const hand: QFloor = { id: 3, name: "Demo", level: 3, unitsPerMetre: null, cad: null, rooms: [room(6, sq(0, 0, 100), "drawn")] };
    const [g, p, h] = drawingQuality([good, poor, hand]);
    expect(g).toMatchObject({ score: 100, grade: "good", byConfidence: { drawing: 1, verified: 1, assumed: 0 } });
    expect(p.grade).toBe("poor");
    expect(p.issues.map((i) => i.key)).toEqual(expect.arrayContaining(["units", "no-doors", "no-glass", "align-few", "outdated", "fallback", "split", "unrecorded", "tiny", "overlap", "unreachable"]));
    expect(p.issues[0].severity).toBe("high");
    expect(p.issues.find((i) => i.key === "fallback")?.roomIds).toEqual([3]);
    expect(h.issues[0]).toMatchObject({ key: "no-drawing", severity: "medium" });
    expect(h.score).toBe(60);
  });
});
