import { describe, expect, it } from "vitest";
import { gs1CheckDigit, gs1ElementString, gs1Text, gtin14, gtinProblem, labelGs1Line, parseGs1, productionText } from "./gs1";

describe("GS1 check digit (wave 41)", () => {
  it("computes the digit GS1 prints", () => {
    expect(gs1CheckDigit("0001234567890")).toBe(5);
    expect(gs1CheckDigit("400638133393")).toBe(1);
    expect(gs1CheckDigit("9638507")).toBe(4); // GTIN-8 96385074
  });
  it("says what is wrong with a GTIN", () => {
    expect(gtinProblem("")).toBeNull();
    expect(gtinProblem("00012345678905")).toBeNull();
    expect(gtinProblem("4006381333931")).toBeNull();
    expect(gtinProblem("96385074")).toBeNull();
    expect(gtinProblem("00012345678906")).toMatch(/should be 5/);
    expect(gtinProblem("12345")).toMatch(/8, 12, 13 or 14/);
    expect(gtinProblem("12AB5678")).toMatch(/digits only/);
  });
  it("pads a valid GTIN to 14 digits", () => {
    expect(gtin14("4006381333931")).toBe("04006381333931");
    expect(gtin14("4006381333932")).toBeNull();
  });
});

describe("parseGs1", () => {
  it("reads a bracketed string", () => {
    expect(parseGs1("(01)00012345678905(11)250115(17)280930(10)A1B2(21)SN123")).toEqual({
      gtin: "00012345678905", made: "2025-01-15", expires: "2028-09-30", lot: "A1B2", serial: "SN123", problems: [] });
  });
  it("reads a scanned DataMatrix string with group separators", () => {
    const r = parseGs1("]d2010001234567890517280900" + "10LOT7\x1d" + "21SER-9");
    expect(r).toMatchObject({ gtin: "00012345678905", expires: "2028-09-30", lot: "LOT7", serial: "SER-9", problems: [] });
  });
  it("treats day 00 as the end of the month for expiry and the start for made", () => {
    expect(parseGs1("(01)00012345678905(17)260200(11)250300")).toMatchObject({ expires: "2026-02-28", made: "2025-03-01" });
  });
  it("reads a GS1 Digital Link address", () => {
    expect(parseGs1("https://id.gs1.org/01/00012345678905/10/L1/21/S%2F2?17=270101")).toMatchObject({
      gtin: "00012345678905", lot: "L1", serial: "S/2", expires: "2027-01-01", problems: [] });
  });
  it("reports a wrong check digit, bad dates and unknown AIs", () => {
    expect(parseGs1("(01)00012345678906").problems[0]).toMatch(/check digit/);
    expect(parseGs1("(01)00012345678905(17)281399").problems[0]).toMatch(/YYMMDD/);
    expect(parseGs1("(01)00012345678905(240)ABC").problems[0]).toMatch(/240/);
    const scanned = parseGs1("01000123456789059912");
    expect(scanned.gtin).toBe("00012345678905");
    expect(scanned.problems[0]).toMatch(/\(99\)/);
  });
  it("gives nothing for blank input", () => {
    expect(parseGs1("  ")).toEqual({ gtin: null, lot: null, serial: null, expires: null, made: null, problems: [] });
  });
});

describe("GS1 strings for labels", () => {
  const g = { gtin: "4006381333931", made: "2025-01-15", expires: "2028-09-30", lot: "A1", serial: "S9" };
  it("prints the human-readable line in AI order", () => {
    expect(gs1Text(g)).toBe("(01)04006381333931(11)250115(17)280930(10)A1(21)S9");
    expect(productionText({ serial: "S9" })).toBe("(21)S9");
    expect(gs1Text({ gtin: "123" })).toBeNull();
  });
  it("builds the element string with a separator only between variable parts", () => {
    expect(gs1ElementString(g)).toBe("0104006381333931112501151728093010A1\x1d21S9");
    expect(parseGs1(gs1ElementString(g)!)).toMatchObject({ gtin: "04006381333931", lot: "A1", serial: "S9" });
  });
  it("makes the label line from the stored DI and PI", () => {
    expect(labelGs1Line("00012345678905", "(17)280930(21)SN1")).toBe("(01)00012345678905(17)280930(21)SN1");
    expect(labelGs1Line("00012345678905", null)).toBe("(01)00012345678905");
    expect(labelGs1Line(null, "(21)X")).toBeNull();
  });
});

describe("udiFromInput", () => {
  it("stores the DI and a bracketed PI", async () => {
    const { udiFromInput } = await import("./gs1");
    expect(udiFromInput("]d201000123456789051728093010L1\x1d21S1")).toEqual({ di: "00012345678905", pi: "(17)280930(10)L1(21)S1", problem: null });
    expect(udiFromInput("4006381333931")).toEqual({ di: "04006381333931", pi: null, problem: null });
    expect(udiFromInput("0100012345678905172809301012")).toMatchObject({ di: "00012345678905", pi: "(17)280930(10)12" });
    expect(udiFromInput("4006381333932").problem).toMatch(/check digit/);
    expect(udiFromInput("")).toEqual({ di: null, pi: null, problem: null });
  });
});
