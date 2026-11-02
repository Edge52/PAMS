/**
 * Time slider and keyboard shortcuts for the 3D view (wave 7, step 7f). Pure.
 */
export type TimeEvent = { t: string; kind: "fault" | "repair" | "move" | "install"; assetId: number; roomId: number | null; text: string };

export const EVENT_COLORS: Record<TimeEvent["kind"], string> = { fault: "#ff4f62", repair: "#3cf5a6", move: "#5ee6ff", install: "#b49bff" };
export const EVENT_LABELS: Record<TimeEvent["kind"], string> = { fault: "Faults", repair: "Repairs", move: "Moves", install: "Installations" };

/**
 * Events shown at slider time `at` (ms): those in the trailing window, strength 1 when just happened, fading to 0 at
 * the window's start. Newest first.
 */
export function eventsAt(events: TimeEvent[], at: number, windowMs: number, kinds?: Set<TimeEvent["kind"]>): (TimeEvent & { strength: number })[] {
  const out: (TimeEvent & { strength: number })[] = [];
  for (const e of events) {
    if (kinds && !kinds.has(e.kind)) continue;
    const t = Date.parse(e.t); if (!(t <= at && t > at - windowMs)) continue;
    out.push({ ...e, strength: 1 - (at - t) / windowMs });
  }
  return out.sort((a, b) => b.strength - a.strength);
}

/** Counts per day for the slider's histogram (index 0 = first day). */
export function perDay(events: TimeEvent[], since: number, days: number): number[] {
  const out = Array(days).fill(0) as number[];
  for (const e of events) { const d = Math.floor((Date.parse(e.t) - since) / 86400_000); if (d >= 0 && d < days) out[d]++; }
  return out;
}

/* ── Keyboard shortcuts ── */

export type Shortcut = { kind: "find" } | { kind: "floor"; index: number } | { kind: "building" } | { kind: "look" } | { kind: "reset" } | { kind: "clear" } | { kind: "help" } | { kind: "walk" };
export const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: "F", what: "Find a device or room" },
  { keys: "1 – 9", what: "Show a floor on its own (top floor first, as in the Floors list)" },
  { keys: "0", what: "Whole building" },
  { keys: "L", what: "Switch the look (digital twin / architectural)" },
  { keys: "R", what: "Reset the view" },
  { keys: "W", what: "Walk the floor shown (W A S D or arrows to move, drag to look, Esc to stop)" },
  { keys: "Esc", what: "Clear the selection, route or pathway" },
  { keys: "?", what: "Show these shortcuts" },
];

/** What a key press means, or null (ignored while typing in a field, with modifier keys, or when busy dropping). */
export function shortcutFor(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: EventTarget | null }, busy = false): Shortcut | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const el = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return null;
  if (e.key === "Escape") return busy ? null : { kind: "clear" };
  if (busy) return null;
  if (e.key === "?") return { kind: "help" };
  const k = e.key.toLowerCase();
  if (k === "f") return { kind: "find" };
  if (k === "l") return { kind: "look" };
  if (k === "r") return { kind: "reset" };
  if (k === "w") return { kind: "walk" };
  if (k === "0") return { kind: "building" };
  if (/^[1-9]$/.test(k)) return { kind: "floor", index: Number(k) - 1 };
  return null;
}
