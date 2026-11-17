"use client";
/**
 * North arrows for the 3D view (wave 28), shown only when the building's north is set (Facilities › Buildings › Edit):
 * a fixed arrow for the mini-map (the plan's top is up) and a compass whose needle turns with the camera.
 */
import { useEffect, useState, type RefObject } from "react";
import { compassTurn, compassWords, nearestTurn, northLabel, viewBearing } from "@/lib/assets/north";

type ViewLike = { viewState(): { target: { x: number; z: number }; camera: { x: number; z: number }; floorId: number | null } };

/** A needle with an N, pointing up when not turned. */
function Needle({ size, light }: { size: number; light: boolean }) {
  const c = size / 2, r = size / 2 - 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <path d={`M ${c} ${c - r * 0.78} L ${c + r * 0.26} ${c + r * 0.2} L ${c} ${c + r * 0.05} L ${c - r * 0.26} ${c + r * 0.2} Z`} fill={light ? "#b4233a" : "#ff6b7d"} />
      <path d={`M ${c} ${c + r * 0.62} L ${c + r * 0.2} ${c + r * 0.2} L ${c} ${c + r * 0.05} L ${c - r * 0.2} ${c + r * 0.2} Z`} fill={light ? "#7d8c98" : "#5d7f94"} />
      <text x={c} y={c - r * 0.82 + 1} fontSize={size * 0.24} fontWeight={700} textAnchor="middle" dominantBaseline="hanging" fill={light ? "#0b2533" : "#e6f6ff"} transform={`translate(0 ${-size * 0.27})`}>N</text>
    </svg>
  );
}

/** The mini-map's north arrow: the plan's top is up, so it turns by the north angle only. */
export function MapNorth({ northDeg, light }: { northDeg: number; light: boolean }) {
  return (
    <span role="img" aria-label={northLabel(northDeg)} title={northLabel(northDeg)} className="absolute right-1 top-1 block h-7 w-7">
      <span className="block h-7 w-7" style={{ transform: `rotate(${northDeg}deg)` }}><Needle size={28} light={light} /></span>
    </span>
  );
}

/** A compass for the 3D view: the needle points north whichever way the camera looks. */
export function HudCompass({ scene, ready, northDeg, light }: { scene: RefObject<ViewLike | null>; ready: boolean; northDeg: number | null; light: boolean }) {
  const [turn, setTurn] = useState<number | null>(null);
  useEffect(() => {
    if (!ready || northDeg == null) return;
    const tick = () => {
      if (document.visibilityState !== "visible" || !scene.current) return;
      const v = scene.current.viewState(), b = viewBearing(v.camera, v.target);
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
    <div role="img" aria-label={`Compass. ${words}.`} title={words} className="twin-card pointer-events-none flex h-12 w-12 items-center justify-center rounded-full p-0!">
      <span className="block h-10 w-10 transition-transform duration-150 ease-linear motion-reduce:transition-none" style={{ transform: `rotate(${turn}deg)` }}><Needle size={40} light={light} /></span>
    </div>
  );
}
