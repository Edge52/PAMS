import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";
import { activeFilterCount, filterToQuery, parseAssetFilter, parseIds } from "./filters";
import { imageSize, planSizeFor } from "./image-size";
import { mapHeaders, normaliseCell, parseDateCell, validateRows, type Lookups } from "./import";
import { buildTree, filterTree } from "./taxonomy";
import { pinStyle, shapePath, statusRing } from "./visuals";

describe("filters", () => {
  it("parses the cross-module URL contract and ignores junk", () => {
    const f = parseAssetFilter({ poId: "4", departmentId: "x", roomId: "12", deviceType: "mon-pat-high", status: "IN_SERVICE", warranty: "soon", page: "1" });
    expect(f).toMatchObject({ poId: 4, roomId: 12, deviceType: "MON-PAT-HIGH", status: "IN_SERVICE" });
    expect(f.departmentId).toBeUndefined();
    expect(f.warranty).toBeUndefined();
    expect(f.page).toBeUndefined();
    expect(parseAssetFilter(new URLSearchParams("status=BROKEN&criticality=HIGH")).status).toBeUndefined();
  });
  it("round-trips to a query string with overrides", () => {
    const f = parseAssetFilter({ q: "philips", status: "IN_SERVICE", page: "3" });
    expect(filterToQuery(f, { page: undefined })).toBe("q=philips&status=IN_SERVICE");
    expect(filterToQuery(f, { status: null, page: 2 })).toBe("q=philips&page=2");
    expect(activeFilterCount(f)).toBe(2);
  });
  it("parses id lists", () => {
    expect(parseIds(["1,2", "2", "x", "-3", "4"])).toEqual([1, 2, 4]);
    expect(parseIds(undefined)).toEqual([]);
  });
});

describe("csv", () => {
  it("quotes and neutralises formulas", () => {
    expect(toCsv(["a", "b"], [["x,y", '"q"'], ["=SUM(A1)", -12.5], [null, "line\nbreak"]]))
      .toBe('a,b\r\n"x,y","""q"""\r\n\'=SUM(A1),-12.5\r\n,"line\nbreak"\r\n');
  });
});

describe("taxonomy tree", () => {
  const rows = [
    { id: 1, code: "MON", parentId: null, level: 1, name: "Patient monitoring", nameAr: "المراقبة" },
    { id: 2, code: "MON-PAT", parentId: 1, level: 2, name: "Patient monitors", nameAr: null },
    { id: 3, code: "MON-PAT-HIGH", parentId: 2, level: 3, name: "Patient monitor, high acuity", nameAr: "جهاز مراقبة المريض" },
    { id: 4, code: "MON-PAT-MID", parentId: 2, level: 3, name: "Patient monitor, mid acuity", nameAr: null },
    { id: 5, code: "IMG", parentId: null, level: 1, name: "Imaging", nameAr: null },
  ];
  it("rolls up counts", () => {
    const t = buildTree(rows, new Map([[3, 12], [4, 5]]));
    expect(t.map((n) => n.code)).toEqual(["IMG", "MON"]);
    expect(t[1].assetCount).toBe(17);
    expect(t[1].typeCount).toBe(2);
  });
  it("searches name, code and Arabic, keeping ancestors", () => {
    const t = buildTree(rows);
    const r = filterTree(t, "high acuity");
    expect(r.matchCount).toBe(1);
    expect(r.tree[0].children[0].children.map((c) => c.code)).toEqual(["MON-PAT-HIGH"]);
    expect(filterTree(t, "مراقبة").matchCount).toBeGreaterThan(0);
    expect(filterTree(t, "mon-pat").tree[0].children[0].children).toHaveLength(2);
    expect(filterTree(t, "zzz").tree).toEqual([]);
  });
});

describe("import validation", () => {
  const lk: Lookups = {
    deviceTypes: new Map([["MON-PAT-HIGH", { id: 3, level: 3, name: "Monitor" }], ["MON", { id: 1, level: 1, name: "Monitoring" }]]),
    rooms: new Map([["3-ICU-BED01", [{ id: 10, departmentId: 5, name: "ICU bed 1" }]], ["DUP", [{ id: 1, departmentId: null, name: "a" }, { id: 2, departmentId: null, name: "b" }]]]),
    departments: new Map([["ICU", { id: 5, name: "ICU" }], ["MED", { id: 6, name: "Medical" }]]),
    existingSerials: new Map([["OLD-1", "DGH-MON-000001"]]),
  };
  it("maps headers loosely and reports missing required columns", () => {
    const h = mapHeaders(["Device type code *", "room code", "Serial", "Colour"]);
    expect([...h.map.values()]).toEqual(["deviceTypeCode", "roomCode", "serialNumber"]);
    expect(h.unknown).toEqual(["Colour"]);
    expect(mapHeaders(["Model"]).missing).toEqual(["Device type code"]);
  });
  it("normalises exceljs cell shapes and dates", () => {
    expect(normaliseCell({ richText: [{ text: "Phil" }, { text: "ips" }] })).toBe("Philips");
    expect(normaliseCell({ formula: "A1", result: 5 })).toBe(5);
    expect(parseDateCell(new Date(Date.UTC(2026, 2, 1)))).toBe("2026-03-01");
    expect(parseDateCell(46082)).toBe("2026-03-01");
    expect(parseDateCell("01/03/2026")).toBe("2026-03-01");
    expect(parseDateCell("31/02/2026")).toBe("invalid");
    expect(parseDateCell("")).toBeNull();
  });
  it("validates rows against lookups", () => {
    const { rows, valid } = validateRows([
      { rowNumber: 2, cells: { deviceTypeCode: "mon-pat-high", roomCode: "3-icu-bed01", serialNumber: "S1", status: "In service", warrantyMonths: 24, installDate: "2026-04-01" } },
      { rowNumber: 3, cells: { deviceTypeCode: "MON", roomCode: "NOPE", serialNumber: "OLD-1", status: "Broken" } },
      { rowNumber: 4, cells: { deviceTypeCode: "MON-PAT-HIGH", roomCode: "3-ICU-BED01", departmentCode: "MED", serialNumber: "s1" } },
      { rowNumber: 5, cells: {} },
      { rowNumber: 6, cells: { deviceTypeCode: "MON-PAT-HIGH", roomCode: "DUP", purchaseDate: "2026-05-01", installDate: "2026-04-01", purchaseCost: "1,200", currency: "eu" } },
    ], lk);
    expect(rows).toHaveLength(4);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({ deviceTypeId: 3, roomId: 10, departmentId: 5, status: "IN_SERVICE", warrantyMonths: 24 });
    expect(rows[1].errors.join(" ")).toMatch(/category.*does not exist.*already registered.*Status "Broken"/);
    expect(rows[2].errors.join(" ")).toMatch(/another department.*also appears on row 2/);
    expect(rows[3].errors.join(" ")).toMatch(/more than one floor.*before the purchase date.*3-letter/);
  });
});

describe("image size", () => {
  it("reads PNG and SVG dimensions", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0, 0, 0x07, 0xd0], 16);
    png.set([0, 0, 0x04, 0xb0], 20);
    expect(imageSize(png)).toEqual({ type: "png", width: 2000, height: 1200 });
    expect(imageSize(new TextEncoder().encode('<svg xmlns="x" viewBox="0 0 800 400">'))).toEqual({ type: "svg", width: 800, height: 400 });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(planSizeFor({ width: 2000, height: 1200 })).toEqual({ w: 1600, h: 960 });
  });
});

describe("pin visuals", () => {
  it("gives every category a shape and status a ring", () => {
    expect(pinStyle("MON").glyph).toBe("M");
    expect(pinStyle("ZZZ-NEW").glyph).toBe("Zz");
    expect(shapePath("diamond", 5)).toMatch(/^M0,-5.6/);
    expect(statusRing("OUT_OF_SERVICE")).toBe("danger");
    expect(statusRing("IN_STOCK")).toBe("neutral");
  });
});
