import { describe, expect, it } from "vitest";
import { gtinValid, parseUdi, udiDiProblem } from "./udi";

describe("UDI (wave 24)", () => {
  it("checks the GTIN check digit", () => {
    expect(gtinValid("00012345678905")).toBe(true);   // UPC 012345678905 padded to 14
    expect(gtinValid("00012345678906")).toBe(false);
    expect(gtinValid("4006381333931")).toBe(true);    // EAN-13
    expect(gtinValid("12AB")).toBe(false);
  });
  it("reads a printed UDI", () => {
    expect(parseUdi("(01)00012345678905(17)280930(10)A1B2(21)SN123")).toEqual({ di: "00012345678905", lot: "A1B2", serial: "SN123", expires: "2028-09-30", made: null });
  });
  it("reads a scanned UDI", () => {
    expect(parseUdi("]C1010001234567890511260100172809001021A1B2\x1d21SN9")).toEqual({ di: "00012345678905", lot: "21A1B2", serial: "SN9", expires: "2028-09-01", made: "2026-01-01" });
  });
  it("says what is wrong with a device identifier", () => {
    expect(udiDiProblem("")).toBeNull();
    expect(udiDiProblem("00012345678905")).toBeNull();
    expect(udiDiProblem("(01)00012345678905(10)X")).toBeNull();
    expect(udiDiProblem("00012345678906")).toMatch(/check digit/);
    expect(udiDiProblem("hello")).toMatch(/14 digits/);
  });
});
