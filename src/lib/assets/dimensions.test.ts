import { describe, expect, it } from "vitest";
import { formatDims, resolveDims, typicalDims } from "./dimensions";

describe("typicalDims", () => {
  it("reads the group from a device type code", () => {
    expect(typicalDims("IMG-CT-128")).toEqual({ l: 4.8, w: 2.3, h: 2.0 });
    expect(typicalDims("FUR-BED")).toEqual({ l: 2.2, w: 1.0, h: 0.9 });
  });
  it("falls back to a cabinet-sized unit for unknown codes", () => {
    expect(typicalDims("XYZ-ABC-1")).toEqual({ l: 0.6, w: 0.5, h: 1.0 });
    expect(typicalDims(null)).toEqual({ l: 0.6, w: 0.5, h: 1.0 });
  });
});

describe("resolveDims", () => {
  it("prefers the asset, then the model, then the type, then the typical size", () => {
    const model = { l: 2.1, w: 0.95, h: 0.8 };
    expect(resolveDims({ l: 2.0, w: 1.0, h: 0.7 }, model, null, "FUR-BED-ICU").source).toBe("asset");
    expect(resolveDims({ l: 2.0, w: null, h: 0.7 }, model, null, "FUR-BED-ICU")).toEqual({ dims: model, source: "model" });
    expect(resolveDims(null, null, { l: 1, w: 1, h: 1 }, "FUR-BED-ICU").source).toBe("type");
    expect(resolveDims(null, null, null, "FUR-BED-ICU")).toEqual({ dims: { l: 2.2, w: 1.0, h: 0.9 }, source: "typical" });
  });
  it("makes length the long side", () => {
    expect(resolveDims({ l: 0.9, w: 2.1, h: 1 }, null, null, null).dims).toEqual({ l: 2.1, w: 0.9, h: 1 });
  });
});

describe("formatDims", () => {
  it("prints metres to the centimetre", () => {
    expect(formatDims({ l: 2.2, w: 1, h: 0.905 })).toBe("2.2 × 1 × 0.91 m");
  });
});
