/**
 * Presentation renders: room labels drawn by the app on top of the image, spelled exactly as in the register. Pure.
 *
 * Bigger rooms go first; a label that would overlap one already placed, or run off the image, is left out rather
 * than shrunk to unreadable. Long names wrap onto two lines.
 */

export type LabelIn = { id: number; text: string; x: number; y: number; /** px² of the room on screen, for priority */ area: number; /** px, the room's narrower side on screen */ room: number };
export type LabelOut = { id: number; lines: string[]; x: number; y: number; size: number; w: number; h: number };

/** Width of a line of text in px; the renderer passes the canvas's measureText, tests a rough estimate. */
export type Measure = (text: string, size: number) => number;
export const roughMeasure: Measure = (t, size) => t.length * size * 0.58;

/** Split a name over at most two lines, breaking at the space nearest the middle. */
export function wrapName(text: string, maxChars = 16): string[] {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= maxChars || !t.includes(" ")) return [t];
  let best = -1;
  for (let i = 0; i < t.length; i++) if (t[i] === " " && (best < 0 || Math.abs(i - t.length / 2) < Math.abs(best - t.length / 2))) best = i;
  return [t.slice(0, best), t.slice(best + 1)];
}

export function layoutLabels(items: LabelIn[], width: number, height: number, measure: Measure = roughMeasure,
  opts: { min?: number; max?: number; pad?: number } = {}): LabelOut[] {
  const min = opts.min ?? 10, max = opts.max ?? 22, pad = opts.pad ?? 3;
  const out: LabelOut[] = [];
  for (const it of [...items].sort((a, b) => b.area - a.area)) {
    const size = Math.round(Math.max(min, Math.min(max, it.room / 7)));
    const lines = wrapName(it.text.toUpperCase());
    const w = Math.max(...lines.map((l) => measure(l, size))) + pad * 2;
    const h = lines.length * size * 1.15 + pad * 2;
    // Too wide for its room by far: a label spilling across walls reads as belonging to the neighbour.
    if (w > Math.max(it.room * 1.6, size * 5)) continue;
    const box = { x: it.x - w / 2, y: it.y - h / 2, w, h };
    if (box.x < 2 || box.y < 2 || box.x + w > width - 2 || box.y + h > height - 2) continue;
    if (out.some((o) => box.x < o.x + o.w / 2 && box.x + w > o.x - o.w / 2 && box.y < o.y + o.h / 2 && box.y + h > o.y - o.h / 2)) continue;
    out.push({ id: it.id, lines, x: it.x, y: it.y, size, w, h });
  }
  return out;
}
