import { describe, expect, it } from "vitest";
import { creditsLine, floorModelFiles, mergeCredits } from "./credits";
import type { TwinData } from "../types";

const asset = (id: number, roomId: number | null, lib?: string) => ({ id, roomId, lib }) as unknown as TwinData["assets"][number];
const data = {
  rooms: [{ id: 1, floorId: 10 }, { id: 2, floorId: 10 }, { id: 3, floorId: 11 }] as unknown as TwinData["rooms"],
  assets: [asset(1, 1, "m1"), asset(2, 2, "m1"), asset(3, 3, "m2"), asset(4, null, "m2"), asset(5, 1, "t:BED"), asset(6, 2, "m3")],
  library: {
    m1: { glb: "/files/equipment_model/1/a.glb", model: "Maker Bed", credit: { licence: "CC BY 4.0", credit: "Model by Jane", source: "https://example.org/bed" } },
    m2: { glb: "/files/equipment_model/2/b.glb", model: "Maker CT", credit: { licence: "CC0 1.0", credit: "Model by Ali", source: "https://example.org/ct" } },
    m3: { glb: "/files/equipment_model/3/c.glb", model: "Old file", credit: null },
    "t:BED": { glb: null, model: null },
  } as unknown as TwinData["library"],
};

describe("render credits (wave 28)", () => {
  it("lists the model files drawn on a floor, once each", () => {
    const f = floorModelFiles(data, 10);
    expect(f.urls).toEqual(["/files/equipment_model/1/a.glb", "/files/equipment_model/3/c.glb"]);
    expect(f.credits.map((c) => c.line)).toEqual(["Model by Jane (CC BY 4.0)", "Licence and credit not recorded"]);
    expect(floorModelFiles(data, 11).credits).toEqual([{ model: "Maker CT", line: "Model by Ali (CC0 1.0)", source: "https://example.org/ct" }]);
    expect(floorModelFiles({ ...data, library: undefined }, 10)).toEqual({ urls: [], credits: [] });
  });

  it("merges the floors' lists for a floor book", () => {
    const all = mergeCredits([floorModelFiles(data, 10).credits, floorModelFiles(data, 11).credits, floorModelFiles(data, 10).credits]);
    expect(all.map((c) => c.model)).toEqual(["Maker Bed", "Maker CT", "Old file"]);
  });

  it("puts them on one line for the title block", () => {
    expect(creditsLine([])).toBe("");
    expect(creditsLine([{ line: "A" }, { line: "B" }, { line: "A" }])).toBe("3D models: A; B");
    expect(creditsLine([{ line: "A" }, { line: "B" }, { line: "C" }, { line: "D" }], 2)).toBe("3D models: A; B; +2 more (see the list with the render)");
  });
});
