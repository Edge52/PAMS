import { describe, expect, it } from "vitest";
import type { CheckRow } from "@/lib/assets/room-standards";
import { standardsTotals, summariseStandards, type StdRoom } from "./room-standards-check";

const row = (label: string, state: CheckRow["state"]): CheckRow => ({ label, need: "", have: "", state });
const room = (id: number, dept: number, rows: CheckRow[], standard: string | null = "ICU bed space"): StdRoom =>
  ({ id, code: `R${id}`, name: `Room ${id}`, floor: "Level 1", facilityId: 1, boqDepartmentId: dept, standard, rows });

describe("room standards in BOQ checks", () => {
  const rooms = [
    room(1, 10, [row("Area", "ok"), row("Oxygen outlets", "ok")]),
    room(2, 10, [row("Area", "short"), row("Oxygen outlets", "short"), row("Clear ceiling", "unknown")]),
    room(3, 10, [row("Area", "short"), row("Clear ceiling", "ok")]),
    room(4, 10, [row("Area", "ok"), row("Clear ceiling", "unknown")]),
    room(5, 10, [], null),
    room(6, 20, [row("Area", "ok")]),
    room(7, 20, [row("Area per bed space (2 beds)", "short")]), room(8, 20, [row("Area per bed space (4 beds)", "short")]),
  ];
  const [icu, ward, empty] = summariseStandards([{ id: 10, label: "ICU" }, { id: 20, label: "Ward" }, { id: 30, label: "Day case" }], rooms);
  it("counts rooms per department", () => {
    expect(icu).toMatchObject({ rooms: 5, withStandard: 4, ok: 1, short: 2, unknown: 1 });
    expect(ward).toMatchObject({ rooms: 3, ok: 1, short: 2 });
    expect(ward.shortItems).toEqual([{ label: "Area per bed space", rooms: 2 }]);
    expect(empty).toMatchObject({ rooms: 0, withStandard: 0 });
  });
  it("lists the worst rooms first and what is most often short", () => {
    expect(icu.shortRooms.map((r) => r.code)).toEqual(["R2", "R3"]);
    expect(icu.shortRooms[0]).toMatchObject({ short: ["Area", "Oxygen outlets"], unknown: ["Clear ceiling"] });
    expect(icu.shortItems).toEqual([{ label: "Area", rooms: 2 }, { label: "Oxygen outlets", rooms: 1 }]);
    expect(icu.toSurvey.map((r) => r.code)).toEqual(["R4"]);
    expect(icu.unsurveyed).toEqual([{ label: "Clear ceiling", rooms: 2 }]);
  });
  it("adds up the totals", () => {
    expect(standardsTotals([icu, ward, empty])).toEqual({ rooms: 8, withStandard: 7, ok: 2, short: 4, unknown: 1 });
  });
});

describe("room templates against a BOQ (wave 16, phase 4)", () => {
  it("counts BOQ lines under each template code", async () => {
    const { compareTemplateEquipment } = await import("./room-standards-check");
    const needs = new Map([["MON-PAT", { label: "Patient monitor", need: 10, rooms: 2 }], ["IMG-CT", { label: "CT scanner", need: 1, rooms: 1 }]]);
    const out = compareTemplateEquipment(needs, [{ deviceCode: "MON-PAT-HIGH", quantity: 6 }, { deviceCode: "MON-PAT-MID", quantity: 2 }, { deviceCode: "IMG-CT-128", quantity: 1 }, { deviceCode: "MON-PATX", quantity: 9 }]);
    expect(out[0]).toMatchObject({ code: "MON-PAT", planned: 8, gap: 2 });
    expect(out[1]).toMatchObject({ code: "IMG-CT", planned: 1, gap: 0 });
  });
});
