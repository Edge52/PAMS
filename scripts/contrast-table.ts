/**
 * Prints every design token's light and dark value and the contrast of the text pairs (wave 38):
 *   npx tsx scripts/contrast-table.ts
 * The same pairs are enforced by src/lib/contrast.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { colorTokens, contrast, CONTRAST_PAIRS, wcagLevel } from "../src/lib/contrast";

const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");
const block = (re: RegExp) => { const m = re.exec(css); return m ? css.slice(m.index, css.indexOf("}", m.index)) : ""; };
const light = colorTokens(block(/@theme\s*\{/));
const dark = colorTokens(block(/:root\[data-theme="dark"\]\s*\{/));

console.log("| Token | Light | Dark |\n| --- | --- | --- |");
for (const k of Object.keys(light)) console.log(`| ${k} | ${light[k]} | ${dark[k] ?? "(missing)"} |`);
console.log("\n| Foreground on background | Needs | Light | Dark |\n| --- | --- | --- | --- |");
for (const [fg, bg, min] of CONTRAST_PAIRS) {
  const cell = (t: Record<string, string>) => { const r = contrast(t[fg], t[bg]); return `${r.toFixed(2)} ${r >= min ? wcagLevel(r) : "FAIL"}`; };
  console.log(`| ${fg} on ${bg} | ${min} | ${cell(light)} | ${cell(dark)} |`);
}
for (const [fg, bg] of [["tag", "surface"], ["tag", "canvas"], ["line", "surface"]]) {
  console.log(`| ${fg} on ${bg} (not enforced) | – | ${contrast(light[fg], light[bg]).toFixed(2)} | ${contrast(dark[fg], dark[bg]).toFixed(2)} |`);
}
