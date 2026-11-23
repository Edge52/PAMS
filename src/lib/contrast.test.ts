import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colorTokens, contrast, CONTRAST_PAIRS, luminance, parseHex, wcagLevel } from "./contrast";

const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
const block = (start: RegExp) => { const m = start.exec(css); if (!m) throw new Error(`no block ${start}`); return css.slice(m.index, css.indexOf("}", m.index)); };
const light = colorTokens(block(/@theme\s*\{/));
const dark = colorTokens(block(/:root\[data-theme="dark"\]\s*\{/));
const system = colorTokens(block(/:root\[data-theme="system"\]\s*\{/));

describe("contrast maths (wave 38)", () => {
  it("matches WCAG reference values", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("nope")).toBeNull();
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 6);
    expect(contrast("#000", "#fff")).toBeCloseTo(21, 6);
    expect(contrast("#fff", "#777777")).toBeCloseTo(4.48, 2);
    expect(contrast("#777777", "#fff")).toBe(contrast("#fff", "#777777"));
    expect(wcagLevel(7.1)).toBe("AAA"); expect(wcagLevel(4.5)).toBe("AA"); expect(wcagLevel(3.2)).toBe("AA large"); expect(wcagLevel(2)).toBe("fail");
  });
});

describe("design tokens in globals.css", () => {
  it("defines a dark value for every light token, and the device-choice block matches the dark one", () => {
    expect(Object.keys(light).length).toBeGreaterThan(25);
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    expect(system).toEqual(dark);
  });
  it.each([["light", light], ["dark", dark]] as const)("every text and mark pair contrasts enough in the %s look", (_n, t) => {
    const fails = CONTRAST_PAIRS.filter(([fg, bg, min]) => contrast(t[fg], t[bg]) < min).map(([fg, bg, min]) => `${fg} on ${bg} ${contrast(t[fg], t[bg]).toFixed(2)} < ${min}`);
    expect(fails).toEqual([]);
  });
  it("keeps the dark look off paper: dark values apply on screens only", () => {
    expect(css).toMatch(/@media screen\s*\{\s*:root\[data-theme="dark"\]/);
    expect(css).toMatch(/@media screen and \(prefers-color-scheme: dark\)\s*\{\s*:root\[data-theme="system"\]/);
  });
});
