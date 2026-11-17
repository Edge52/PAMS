/**
 * North on the plans (wave 28). A building stores where north is as an angle in degrees, clockwise from the top of its
 * plans (0 = north is up the drawing, 90 = to the right). Plan x runs right and plan y down, as in the 3D view, where
 * plan y is the scene's z. Pure, so the arrow maths is tested.
 */

/** Any angle into 0 ≤ a < 360. */
export const normDeg = (a: number) => ((a % 360) + 360) % 360;

/** A north angle typed into a form: blank = not known (null); otherwise a number, kept to 0.1° in 0 ≤ a < 360. */
export function cleanNorth(v: unknown): number | null | "invalid" {
  const t = String(v ?? "").trim().replace(/°$/, "").trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n) || Math.abs(n) > 3600) return "invalid";
  const r = Math.round(normDeg(n) * 10) / 10;
  return r >= 360 ? 0 : r;
}

/** Unit vector pointing north on the plan (x right, y down). */
export function northOnPlan(northDeg: number): [number, number] {
  const a = (normDeg(northDeg) * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a)];
}

/**
 * Which way the camera looks, as a bearing on the plan: degrees clockwise from the top of the plan, from the camera's
 * spot to the point it looks at (plan metres). Null when the camera is straight above that point.
 */
export function viewBearing(camera: { x: number; z: number }, target: { x: number; z: number }): number | null {
  const dx = target.x - camera.x, dz = target.z - camera.z;
  if (Math.hypot(dx, dz) < 1e-6) return null;
  return normDeg((Math.atan2(dx, -dz) * 180) / Math.PI);
}

/** How far to turn a compass needle on screen (degrees clockwise from straight up) so it points north. */
export function compassTurn(northDeg: number, bearing: number): number {
  return normDeg(northDeg - bearing);
}

/** The angle equal to `next` (mod 360) nearest `prev`, so a needle eased between them turns the short way round. */
export function nearestTurn(prev: number, next: number): number {
  return prev + ((((next - prev) % 360) + 540) % 360) - 180;
}

const WORDS = ["straight ahead", "ahead and to the right", "to the right", "behind and to the right", "behind", "behind and to the left", "to the left", "ahead and to the left"];
/** "North is to the right" for a needle turned this much (screen up = ahead). */
export function compassWords(turn: number): string {
  return `North is ${WORDS[Math.round(normDeg(turn) / 45) % 8]}`;
}

/** "North is 30° clockwise from the top of the plan." */
export function northLabel(northDeg: number): string {
  const a = Math.round(normDeg(northDeg) * 10) / 10;
  if (a === 0) return "North is at the top of the plan.";
  return a <= 180 ? `North is ${a}° clockwise from the top of the plan.` : `North is ${Math.round((360 - a) * 10) / 10}° anticlockwise from the top of the plan.`;
}

/**
 * The north angle for what the 3D view shows: the floor shown on its own uses its building's; the whole hospital uses
 * the buildings' angle when every building that has one agrees, else none (the arrow would mislead).
 */
export function northFor(floors: { id: number; northDeg?: number | null }[], floorId: number | null): number | null {
  if (floorId != null) return floors.find((f) => f.id === floorId)?.northDeg ?? null;
  const set = [...new Set(floors.map((f) => f.northDeg).filter((n): n is number => n != null))];
  return set.length === 1 ? set[0] : null;
}
