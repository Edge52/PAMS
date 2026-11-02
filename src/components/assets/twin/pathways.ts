/**
 * Patient pathways in the 3D view (wave 7, step 7c): which room stands for each step, how each arrow travels, the
 * pathway card's figures, and the tracks the animated patients follow. Pure (metres, seconds).
 */
import { polygonArea, type Pt } from "./geometry";
import type { TwinRoom } from "./types";
import type { Journey } from "../../../lib/assets/lifts";
import { stepVolumes, type Link, type Step, type Transport } from "../../../lib/flows/model";
import type { Route } from "./nav/route";

export type TwinFlow = { id: number; name: string; version: number; dailyVolume: number | null; steps: Step[]; links: Link[]; names?: Record<string, string> };

/** Pathway colours: bright on the dark look, dark enough on the light one; never the status red or green. */
export const FLOW_COLORS = ["#ffd166", "#5ee6ff", "#ff7ab6", "#b49bff", "#ff9f43", "#7cf0c6"];

export const journeyOf = (t: Transport): Journey => (t === "BED" || t === "TROLLEY" ? "bed" : t === "WHEELCHAIR" ? "wheelchair" : "foot");

/** The room a step is drawn at: its room, else its department's largest room (not a corridor). */
export function stepRoom(step: Step, rooms: TwinRoom[]): TwinRoom | null {
  if (step.roomId != null) return rooms.find((r) => r.id === step.roomId) ?? null;
  if (step.departmentId == null) return null;
  const own = rooms.filter((r) => r.departmentId === step.departmentId && r.type !== "CORRIDOR" && r.poly.length >= 3);
  return own.sort((a, b) => Math.abs(polygonArea(b.poly as Pt[])) - Math.abs(polygonArea(a.poly as Pt[])))[0] ?? null;
}

/** Expected visits per patient entering the pathway: at each step, and along each arrow (by index). */
export function visits(steps: Step[], links: Link[]) {
  const v = stepVolumes(steps, links, 1);
  return { steps: v, links: links.map((l) => ((v.get(l.fromKey) ?? 0) * l.share) / 100) };
}

export type LegFigure = { index: number; from: string; to: string; route: Route | null; share: number; transport: Transport };
export type Card = {
  /** Per patient on average (branches weighted by their shares). */
  metres: number; moveSeconds: number; careMinutes: number; floorChanges: number; liftTrips: number;
  legs: LegFigure[]; longest: LegFigure | null; estimated: number; unrouted: number;
};

export function pathwayCard(flow: TwinFlow, routes: (Route | null)[]): Card {
  const vis = visits(flow.steps, flow.links);
  const label = (k: string) => flow.steps.find((s) => s.key === k)?.label ?? k;
  let metres = 0, moveSeconds = 0, floorChanges = 0, liftTrips = 0, estimated = 0, unrouted = 0;
  const legs: LegFigure[] = flow.links.map((l, i) => {
    const r = routes[i] ?? null, p = vis.links[i] ?? 0;
    if (r) { metres += p * r.metres; moveSeconds += p * r.seconds; floorChanges += p * r.floorChanges; liftTrips += p * r.liftTrips; if (r.estimated) estimated++; }
    else unrouted++;
    return { index: i, from: label(l.fromKey), to: label(l.toKey), route: r, share: l.share, transport: l.transport };
  });
  const careMinutes = flow.steps.reduce((t, s) => t + (vis.steps.get(s.key) ?? 0) * (s.minutes ?? 0), 0);
  const longest = legs.filter((l) => l.route).sort((a, b) => b.route!.metres - a.route!.metres)[0] ?? null;
  return { metres, moveSeconds, careMinutes, floorChanges, liftTrips, legs, longest, estimated, unrouted };
}

/** Line width for an arrow by the share of patients taking it (metres of tube radius). */
export const tubeRadius = (perPatient: number) => 0.12 + 0.34 * Math.sqrt(Math.min(1, Math.max(0, perPatient)));

/* ── Play: one sampled patient's journey ── */

/** A patient's path: arrows chosen by their shares from a start until an end (or 40 moves, for safety). */
export function samplePath(steps: Step[], links: Link[], rnd: () => number = Math.random): number[] {
  const starts = steps.filter((s) => s.kind === "START");
  if (!starts.length) return [];
  let at = starts[Math.floor(rnd() * starts.length)].key;
  const out: number[] = [];
  for (let hop = 0; hop < 40; hop++) {
    const outs = links.map((l, i) => ({ l, i })).filter(({ l }) => l.fromKey === at && l.toKey !== at && l.share > 0);
    if (!outs.length) break;
    const total = outs.reduce((t, o) => t + o.l.share, 0);
    let pick = rnd() * total, chosen = outs[outs.length - 1];
    for (const o of outs) { pick -= o.l.share; if (pick <= 0) { chosen = o; break; } }
    out.push(chosen.i);
    at = chosen.l.toKey;
    if (steps.find((s) => s.key === at)?.kind === "END") break;
  }
  return out;
}

export type Key = { floorId: number; x: number; z: number; t: number; pause?: boolean };

/**
 * Keyframes along a sampled path: moving at each leg's own pace (lift waits included), then pausing at the step for
 * its minutes. Arrows with no route are skipped. Times in simulated seconds from 0.
 */
export function trackOf(path: number[], links: Link[], steps: Step[], routes: (Route | null)[]): Key[] {
  const keys: Key[] = [];
  let t = 0;
  const push = (floorId: number, x: number, z: number, pause?: boolean) => {
    const last = keys[keys.length - 1];
    if (last && !pause && last.floorId === floorId && Math.hypot(last.x - x, last.z - z) < 1e-6 && last.t === t) return;
    keys.push({ floorId, x, z, t, pause });
  };
  for (const i of path) {
    const r = routes[i]; if (!r) continue;
    for (const leg of r.legs) {
      if (leg.kind === "walk") {
        const d = leg.points.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - leg.points[k][0], p[1] - leg.points[k][1]), 0) || 1;
        push(leg.floorId, leg.points[0][0], leg.points[0][1]);
        for (let k = 1; k < leg.points.length; k++) {
          t += (leg.seconds * Math.hypot(leg.points[k][0] - leg.points[k - 1][0], leg.points[k][1] - leg.points[k - 1][1])) / d;
          push(leg.floorId, leg.points[k][0], leg.points[k][1]);
        }
      } else {
        push(leg.floorId, leg.points[0][0], leg.points[0][1]);
        t += leg.seconds;
        push(leg.toFloorId ?? leg.floorId, leg.points[1][0], leg.points[1][1]);
      }
    }
    const step = steps.find((s) => s.key === links[i].toKey);
    const last = keys[keys.length - 1];
    if (step?.minutes && last) { t += step.minutes * 60; keys.push({ ...last, t, pause: true }); }
  }
  return keys;
}

/** Where a track is at time t (null after its end). */
export function positionAt(keys: Key[], t: number): { floorId: number; x: number; z: number; f: number; toFloorId: number } | null {
  if (!keys.length || t > keys[keys.length - 1].t) return null;
  let i = 1;
  while (i < keys.length && keys[i].t < t) i++;
  const a = keys[Math.max(0, i - 1)], b = keys[Math.min(i, keys.length - 1)];
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  return { floorId: a.floorId, toFloorId: b.floorId, x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, f };
}

/**
 * Squeeze long stays so the animation stays watchable: a pause lasts at most `maxSim` simulated seconds (the card
 * still uses the real minutes).
 */
export function capPauses(keys: Key[], maxSim: number): Key[] {
  let shift = 0;
  return keys.map((k, i) => {
    if (k.pause && i > 0) { const dur = k.t - keys[i - 1].t; if (dur > maxSim) shift += dur - maxSim; }
    return { ...k, t: k.t - shift };
  });
}
