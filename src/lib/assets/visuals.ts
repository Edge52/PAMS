/**
 * Visual vocabulary of the floor map: pin shapes/glyphs per device category, status ring tones,
 * and department tints. Colours are CSS custom properties from the design tokens (no raw hex).
 */

export type PinShape = "circle" | "square" | "diamond" | "triangle" | "hexagon";
export type PinStyle = { shape: PinShape; glyph: string; label: string };

/** Known level-1 categories. Anything new from the taxonomy falls back to a deterministic shape + first letter. */
const KNOWN: Record<string, PinStyle> = {
  MON: { shape: "circle", glyph: "M", label: "Monitoring" },
  LIF: { shape: "diamond", glyph: "L", label: "Life support" },
  INF: { shape: "circle", glyph: "P", label: "Infusion" },
  IMG: { shape: "square", glyph: "I", label: "Imaging" },
  SUR: { shape: "triangle", glyph: "S", label: "Surgical" },
  END: { shape: "hexagon", glyph: "E", label: "Endoscopy" },
  FUR: { shape: "square", glyph: "F", label: "Furniture" },
  STR: { shape: "hexagon", glyph: "St", label: "Sterilization" },
  LAB: { shape: "hexagon", glyph: "La", label: "Laboratory" },
  THR: { shape: "diamond", glyph: "T", label: "Therapy" },
  RTH: { shape: "square", glyph: "Rt", label: "Radiotherapy" },
  CAR: { shape: "circle", glyph: "C", label: "Cardiology" },
  GAS: { shape: "triangle", glyph: "G", label: "Medical gases" },
  OBG: { shape: "circle", glyph: "O", label: "Obstetrics" },
  BBK: { shape: "hexagon", glyph: "B", label: "Blood bank" },
  REH: { shape: "triangle", glyph: "R", label: "Rehabilitation" },
  DEN: { shape: "square", glyph: "D", label: "Dental" },
  OPH: { shape: "circle", glyph: "Op", label: "Ophthalmology" },
  ENT: { shape: "diamond", glyph: "En", label: "ENT" },
  DRM: { shape: "triangle", glyph: "Dm", label: "Dermatology" },
  PHA: { shape: "hexagon", glyph: "Ph", label: "Pharmacy" },
  BME: { shape: "square", glyph: "Bm", label: "Test equipment" },
};
const SHAPES: PinShape[] = ["circle", "square", "diamond", "triangle", "hexagon"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function pinStyle(categoryCode: string | null | undefined, categoryName?: string | null): PinStyle {
  const code = (categoryCode ?? "").split("-")[0].toUpperCase();
  if (KNOWN[code]) return { ...KNOWN[code], label: categoryName ?? KNOWN[code].label };
  return { shape: SHAPES[hash(code) % SHAPES.length], glyph: (code[0] ?? "?") + (code[1]?.toLowerCase() ?? ""), label: categoryName ?? code };
}

/** SVG path for a pin shape centred on (0,0) with radius r. Circle is drawn as <circle> by callers but a path is given too. */
export function shapePath(shape: PinShape, r: number): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  switch (shape) {
    case "square": { const s = r * 0.78; return `M${f(-s)},${f(-s)}H${f(s)}V${f(s)}H${f(-s)}Z`; }
    case "diamond": { const s = r * 1.12; return `M0,${f(-s)}L${f(s)},0L0,${f(s)}L${f(-s)},0Z`; }
    case "triangle": { const s = r * 1.12; return `M0,${f(-s)}L${f(s * 0.95)},${f(s * 0.7)}L${f(-s * 0.95)},${f(s * 0.7)}Z`; }
    case "hexagon": {
      const s = r * 1.02;
      const pts = Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i; return `${f(Math.cos(a) * s)},${f(Math.sin(a) * s)}`; });
      return `M${pts.join("L")}Z`;
    }
    default: return `M${f(-r)},0A${f(r)},${f(r)} 0 1,0 ${f(r)},0A${f(r)},${f(r)} 0 1,0 ${f(-r)},0Z`;
  }
}

export type RingTone = "ok" | "warn" | "danger" | "neutral";

export function statusRing(status: string | null | undefined): RingTone {
  switch (status) {
    case "IN_SERVICE": case "INSTALLED": return "ok";
    case "UNDER_MAINTENANCE": return "warn";
    case "OUT_OF_SERVICE": case "DISPOSED": return "danger";
    default: return "neutral";
  }
}

export const RING_COLOR: Record<RingTone, string> = {
  ok: "var(--color-ok)", warn: "var(--color-warn)", danger: "var(--color-danger)", neutral: "var(--color-faint)",
};

/**
 * Department tints, derived from tokens. Amber (tag) and plain warn are deliberately excluded so pins stay
 * the only amber thing on the plan.
 */
export const DEPT_TINTS = [
  "var(--color-primary)",
  "var(--color-info)",
  "color-mix(in oklab, var(--color-info) 55%, var(--color-danger))",
  "var(--color-ok)",
  "color-mix(in oklab, var(--color-primary) 45%, var(--color-info))",
  "color-mix(in oklab, var(--color-danger) 70%, var(--color-muted))",
  "color-mix(in oklab, var(--color-ok) 55%, var(--color-warn))",
  "var(--color-muted)",
  "color-mix(in oklab, var(--color-info) 60%, var(--color-ink))",
] as const;

/** Stable tint per department within a floor: departments sorted by id get consecutive colours. */
export function deptTintMap(departmentIds: (number | null | undefined)[]): Map<number, string> {
  const ids = [...new Set(departmentIds.filter((x): x is number => typeof x === "number"))].sort((a, b) => a - b);
  return new Map(ids.map((id, i) => [id, DEPT_TINTS[i % DEPT_TINTS.length]]));
}

/** Truncate a label to fit roughly `width` plan units at a given font size. */
export function fitLabel(text: string, width: number, fontSize: number): string {
  const max = Math.max(1, Math.floor((width - 6) / (fontSize * 0.56)));
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}
