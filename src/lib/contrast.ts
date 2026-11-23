/** WCAG 2.x colour contrast (wave 38): relative luminance and contrast ratio of two #rrggbb colours. Pure. */

/** [r, g, b] in 0–255 from "#rgb" or "#rrggbb"; null when it isn't a hex colour. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Relative luminance (0 black … 1 white), WCAG 2.2 definition. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`Not a hex colour: ${hex}`);
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio, 1 … 21, the same whichever colour is given first. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** WCAG level for normal-size text: AAA ≥ 7, AA ≥ 4.5, "AA large" ≥ 3 (large text and graphics), else fail. */
export function wcagLevel(ratio: number): "AAA" | "AA" | "AA large" | "fail" {
  return ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA large" : "fail";
}

/** `--color-name: #hex;` declarations inside a CSS block body. */
export function colorTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,6})\b/gi)) out[m[1]] = m[2].toLowerCase();
  return out;
}

/**
 * Text and graphics pairs that must contrast, as [foreground token, background token, minimum]. Text needs 4.5:1;
 * focus rings and chart marks need 3:1 against the ground they sit on (WCAG 1.4.11).
 */
export const CONTRAST_PAIRS: [string, string, number][] = [
  ...["canvas", "surface", "sunken"].flatMap((bg) => ["ink", "muted", "faint", "primary"].map((fg) => [fg, bg, 4.5] as [string, string, number])),
  ["primary-strong", "primary-soft", 4.5], ["primary", "primary-soft", 4.5], ["primary-strong", "surface", 4.5],
  ["on-primary", "primary", 4.5], ["on-primary", "primary-strong", 4.5], ["on-primary", "danger", 4.5], ["on-primary", "ok", 4.5], ["on-primary", "info", 4.5],
  ...(["ok", "warn", "danger", "info"] as const).flatMap((t) => [[t, `${t}-soft`, 4.5], [t, "surface", 4.5]] as [string, string, number][]),
  ["gold-ink", "gold-soft", 4.5], ["gold-ink", "surface", 4.5], ["ink", "tag-soft", 4.5], ["ink", "gold-soft", 4.5],
  ["nav-ink", "nav", 4.5], ["nav-muted", "nav", 4.5], ["nav-gold", "nav", 4.5], ["nav-ink", "nav-raised", 4.5], ["nav-gold", "nav-raised", 4.5],
  ["primary", "canvas", 3], ["primary", "surface", 3], ["gold", "surface", 3], ["faint", "sunken", 3],
];
