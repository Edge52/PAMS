"use client";
/**
 * North arrows for the 3D view (wave 28), shown only when the building's north is set (Facilities › Buildings › Edit):
 * a fixed arrow for the mini-map (the plan's top is up) and a compass whose needle turns with the camera.
 */
import { useEffect, useState, type RefObject } from "react";
// Relative path: the unit tests load this file and have no "@/" alias.
import { compassTurn, compassWords, nearestTurn, northLabel, viewBearing } from "../../../lib/assets/north";

type ViewLike = { viewState(): { target: { x: number; z: number }; camera: { x: number; z: number }; floorId: number | null } };

/** A needle with an N above its tip, pointing up when not turned (drawn on a 40 × 40 grid, scaled to `size`). */
function Needle({ size, light }: { size: number; light: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <text x={20} y={1.5} fontSize={10} fontWeight={700} textAnchor="middle" dominantBaseline="hanging" fill={light ? "#0b2533" : "#e6f6ff"}>N</text>
      <path d="M 20 12 L 25.5 26 L 20 23 L 14.5 26 Z" fill={light ? "#b4233a" : "#ff6b7d"} />
      <path d="M 20 37 L 24 26 L 20 23 L 16 26 Z" fill={light ? "#7d8c98" : "#5d7f94"} />
    </svg>
  );
}

/** The mini-map's north arrow: the plan's top is up, so it turns by the north angle only. */
export function MapNorth({ northDeg, light }: { northDeg: number; light: boolean }) {
  return (
    <span role="img" aria-label={northLabel(northDeg)} title={northLabel(northDeg)} className={`absolute right-1 top-1 block h-7 w-7 rounded-full ${light ? "bg-white/70" : "bg-[#04121f]/70"}`}>
      <span className="block h-7 w-7" style={{ transform: `rotate(${northDeg}deg)` }}><Needle size={28} light={light} /></span>
    </span>
  );
}

/** A compass for the 3D view: the needle points north whichever way the camera looks. */
export function HudCompass({ scene, ready, northDeg, light }: { scene: RefObject<ViewLike | null>; ready: boolean; northDeg: number | null; light: boolean }) {
  const [turn, setTurn] = useState<number | null>(null);
  useEffect(() => {
    if (!ready || northDeg == null) return;
    let last = "";
    const tick = () => {
      if (document.visibilityState !== "visible" || !scene.current) return;
      const v = scene.current.viewState();
      // Only work out the needle when the camera moved (audit A21); an unchanged turn keeps the same state, so no re-render.
      const key = [v.camera.x, v.camera.z, v.target.x, v.target.z].map((n) => n.toFixed(2)).join();
      if (key === last) return;
      last = key;
      const b = viewBearing(v.camera, v.target);
      if (b == null) return; // straight above: keep the last turn
      const next = compassTurn(northDeg, b);
      setTurn((prev) => (prev == null ? next : Math.abs(nearestTurn(prev, next) - prev) < 0.2 ? prev : nearestTurn(prev, next)));
    };
    tick();
    const t = setInterval(tick, 150);
    return () => clearInterval(t);
  }, [ready, northDeg, scene]);
  if (northDeg == null || turn == null) return null;
  const words = compassWords(turn);
  return (
    <div role="img" aria-label={`Compass. ${words}.`} title={words} className="twin-card pointer-events-none flex h-12 w-12 items-center justify-center rounded-full! p-0!">
      <span className="block h-10 w-10 transition-transform duration-150 ease-linear motion-reduce:transition-none" style={{ transform: `rotate(${turn}deg)` }}><Needle size={40} light={light} /></span>
    </div>
  );
}
