"use client";
/**
 * Pieces of the 3D view that need none of its state (wave 29 split of twin-view.tsx): the remembered look, live-data
 * decoding, legend colours and words, and the walking stick for phones. No behaviour change.
 */
import { useState } from "react";
import type { TwinStyle } from "./scene";
import { type LivePayload, type TwinRoom } from "./types";
import { type LiveMetrics } from "./layers";

export const LIVE_EVERY_MS = 60_000;

/* The chosen look (dark "digital twin" or light "architectural"), kept in localStorage; unreadable storage → dark. */
export const STYLE_KEY = "hpams.twin.style";
export const styleListeners = new Set<() => void>();
export function subscribeStyle(cb: () => void) { styleListeners.add(cb); return () => { styleListeners.delete(cb); }; }
export function readStyle(): TwinStyle { try { return window.localStorage.getItem(STYLE_KEY) === "light" ? "light" : "dark"; } catch { return memoryStyle ?? "dark"; } }
/** True when this viewer has never picked a look in this browser (wave 22: managers then start on the presentation look). */
export function styleUnset(): boolean { try { return window.localStorage.getItem(STYLE_KEY) === null; } catch { return memoryStyle === null; } }
/** Roles that open the 3D view to look, not to work in it. */
export const PRESENTATION_ROLES = ["DIRECTOR", "FINANCE", "VIEWER"];
export function writeStyle(v: TwinStyle) {
  try { window.localStorage.setItem(STYLE_KEY, v); } catch { /* private window: not remembered */ }
  memoryStyle = v;
  styleListeners.forEach((cb) => cb());
}
export let memoryStyle: TwinStyle | null = null;
/** Same colours as the stairs, lifts and shafts in the scene. */
export const CORE_SWATCH = { stair: "#a78bff", lift: "#ff8fd8", shaft: "#5b7f9c" } as const;

export function decodeLive(p: LivePayload): Map<number, LiveMetrics> {
  return new Map(p.rows.map(([id, status, openJobs, ppm, life, downtimeHours, valueEgp, recall]) =>
    [id, { status, openJobs, overduePpm: ppm === 1, beyondLife: life === 1, downtimeHours, valueEgp, recall: recall === 1 }]));
}

/** Room template colours (wave 16, phase 4): below the template, equipment missing, not surveyed, meets it. */
export const TEMPLATE_COLORS = { short: "#ff5a5a", missing: "#ff9f43", unknown: "#e8d36a", ok: "#3ddc97" } as const;
export const TEMPLATE_WORDS = { short: "Short", missing: "Equipment missing", unknown: "To survey", ok: "Meets it" } as const;
export function templateKind(t: NonNullable<TwinRoom["template"]>): keyof typeof TEMPLATE_COLORS {
  return t.short.length ? "short" : t.missing.length ? "missing" : t.state === "unknown" ? "unknown" : "ok";
}

/** Drawing confidence colours (wave 16): from the drawing, assumed (split or drawn), guessed (no outline found), verified. */
export const CONFIDENCE_COLORS = { assumed: "#ffb534", fallback: "#ff4f62", verified: "#3cf5a6" } as const;
export const CONFIDENCE_WORDS = { assumed: "Assumed", fallback: "No outline found", verified: "Verified (the rest: from the drawing)" } as const;

/** On-screen stick for walk mode on tablets: push up to walk, sideways to turn. */
export function WalkStick({ onMove }: { onMove: (forward: number, turn: number) => void }) {
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const R = 36;
  const update = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(x, y); if (d > R) { x = (x / d) * R; y = (y / d) * R; }
    setKnob({ x, y }); onMove(-y / R, x / R);
  };
  const end = () => { setKnob(null); onMove(0, 0); };
  return (
    <div role="group" aria-label="Walk stick: push up to go forward, sideways to turn (keyboard: W A S D)"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); update(e); }} onPointerMove={(e) => { if (knob) update(e); }} onPointerUp={end} onPointerCancel={end}
      className="twin-card relative size-24 touch-none rounded-full! p-0!">
      <span className="absolute left-1/2 top-1/2 size-10 rounded-full bg-[#2fd3ff66] ring-1 ring-[#2fd3ff]" style={{ transform: `translate(calc(-50% + ${knob?.x ?? 0}px), calc(-50% + ${knob?.y ?? 0}px))` }} />
    </div>
  );
}
