/** Where each step sits on the pathway diagram and canvas (wave 7): its saved spot, or the automatic layout. Pixels. */
import { layoutFlow, type Link, type Step } from "../../lib/flows/model";

export const BOX_W = 176, BOX_H = 64, GAP_X = 64, GAP_Y = 26, PAD = 16, GRID = 20;

export function autoSpot(col: number, row: number) { return { x: PAD + col * (BOX_W + GAP_X), y: PAD + row * (BOX_H + GAP_Y) }; }

/** A step's saved spot, or its place in the automatic layout (a step added later lands there until moved). */
export function stepPositions(steps: (Step & { x?: number | null; y?: number | null })[], links: Link[]): Map<string, { x: number; y: number }> {
  const auto = layoutFlow(steps, links);
  const out = new Map<string, { x: number; y: number }>();
  for (const s of steps) {
    const a = auto.get(s.key)!;
    out.set(s.key, s.x != null && s.y != null ? { x: s.x, y: s.y } : autoSpot(a.col, a.row));
  }
  return out;
}

export const snap = (v: number) => Math.round(v / GRID) * GRID;
