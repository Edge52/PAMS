import { describe, expect, it } from "vitest";
import { dateCell, enumCell, mapColumns, numberCell, parseCsv, textCell, yesNoCell } from "./table";

describe("import table helpers (wave 41)", () => {
  it("reads CSV with quotes, line breaks, BOM and semicolons", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"two\nlines",3\n\n')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["two\nlines", "3"]]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("matches headers by name, key or alias and reports what is missing", () => {
    const cols = [{ key: "name", header: "Supplier name", required: true, hint: "", example: "" }, { key: "email", header: "Email", hint: "", example: "", aliases: ["e-mail"] }];
    const r = mapColumns(["SUPPLIER NAME *", "E-mail", "Colour"], cols);
    expect([...r.map]).toEqual([[0, "name"], [1, "email"]]);
    expect(r.unknown).toEqual(["Colour"]);
    expect(mapColumns(["Email"], cols).missing).toEqual(["Supplier name"]);
  });
  it("checks cells", () => {
    const e: string[] = [];
    expect(textCell("  A  ", "Name", e)).toBe("A");
    expect(textCell("", "Name", e, 10, true)).toBeNull();
    expect(numberCell("1,250", "Cost", e, { min: 0 })).toBe(1250);
    expect(numberCell("2.5", "Qty", e, { int: true })).toBeNull();
    expect(dateCell("31/12/2026", "End", e)).toBe("2026-12-31");
    expect(dateCell("soon", "End", e)).toBeNull();
    expect(yesNoCell("Y", "Parts", e)).toBe(true);
    expect(enumCell("Full service", "Type", ["FULL_SERVICE", "PPM_ONLY"] as const, e)).toBe("FULL_SERVICE");
    expect(enumCell("Gold", "Type", ["FULL_SERVICE"] as const, e)).toBeNull();
    expect(e).toEqual(["Name is required.", "Qty must be a whole number.", "End must be a date (YYYY-MM-DD).", "Type must be one of: FULL_SERVICE."]);
  });
});
