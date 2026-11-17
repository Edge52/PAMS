"use client";
/** Mini-map and scale bar for the 3D view (wave 22b). The map shows the floor in plan with the point looked at; a click moves there.
 *  Wave 28: a north arrow when the building's north is set. */
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { TwinFloor, TwinRoom } from "./types";
import { MapNorth } from "./hud-compass";

type ViewState = { metresPerPixel: number; target: { x: number; z: number }; camera: { x: number; z: number }; floorId: number | null };
type SceneLike = { viewState(): ViewState; lookAt(x: number, z: number): void };

const STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
/** The round length (metres) whose bar is closest to 90 px wide at this zoom, and that width. Pure. */
export function scaleBar(metresPerPixel: number): { metres: number; px: number } {
  const want = 90 * metresPerPixel;
  const metres = STEPS.reduce((best, s) => (Math.abs(s - want) < Math.abs(best - want) ? s : best), STEPS[0]);
  return { metres, px: metres / metresPerPixel };
}

const W = 168, H = 112, PAD = 6;

export function HudMap({ scene, ready, floors, rooms, light }: { scene: RefObject<SceneLike | null>; ready: boolean; floors: TwinFloor[]; rooms: TwinRoom[]; light: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<ViewState | null>(null);
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => { if (document.visibilityState === "visible" && scene.current) setView(scene.current.viewState()); }, 250);
    return () => clearInterval(t);
  }, [ready, scene]);
  // The floor shown on its own, else the one nearest the ground.
  const floor = useMemo(() => floors.find((f) => f.id === view?.floorId) ?? [...floors].sort((a, b) => Math.abs(a.elevation) - Math.abs(b.elevation))[0] ?? null, [floors, view?.floorId]);
  const plan = useMemo(() => {
    if (!floor) return null;
    const k = 1 / (floor.unitsPerMetre || 10);
    const polys = rooms.filter((r) => r.floorId === floor.id && r.poly.length >= 3).map((r) => ({ corridor: r.type === "CORRIDOR", pts: r.poly.map(([x, y]) => [x * k, y * k] as [number, number]) }));
    if (!polys.length) return null;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of polys) for (const [x, z] of p.pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    const s = Math.min((W - 2 * PAD) / Math.max(1, x1 - x0), (H - 2 * PAD) / Math.max(1, z1 - z0));
    const ox = (W - (x1 - x0) * s) / 2 - x0 * s, oz = (H - (z1 - z0) * s) / 2 - z0 * s;
    return { polys, s, ox, oz };
  }, [floor, rooms]);

  useEffect(() => {
    const c = canvas.current, g = c?.getContext("2d");
    if (!c || !g || !plan) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = W * dpr; c.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    for (const p of plan.polys) {
      g.beginPath();
      p.pts.forEach(([x, z], i) => (i ? g.lineTo(x * plan.s + plan.ox, z * plan.s + plan.oz) : g.moveTo(x * plan.s + plan.ox, z * plan.s + plan.oz)));
      g.closePath();
      g.fillStyle = p.corridor ? (light ? "#c9d3da" : "#0e2b40") : light ? "#9fb2c0" : "#1d5a7c";
      g.fill();
    }
    if (view) {
      const tx = view.target.x * plan.s + plan.ox, tz = view.target.z * plan.s + plan.oz;
      const cx = view.camera.x * plan.s + plan.ox, cz = view.camera.z * plan.s + plan.oz;
      const a = Math.atan2(tz - cz, tx - cx);
      // A wedge opening from the camera's side towards the point looked at.
      g.beginPath(); g.moveTo(tx, tz); g.arc(tx, tz, 16, a + Math.PI - 0.55, a + Math.PI + 0.55); g.closePath();
      g.fillStyle = light ? "rgba(20,80,63,0.28)" : "rgba(47,211,255,0.28)"; g.fill();
      g.beginPath(); g.arc(tx, tz, 3.5, 0, Math.PI * 2); g.fillStyle = light ? "#14503f" : "#2fd3ff"; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = "#ffffff"; g.stroke();
    }
  }, [plan, view, light]);

  if (!plan || !floor) return null;
  const bar = view ? scaleBar(view.metresPerPixel) : null;
  const go = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    scene.current?.lookAt((e.clientX - r.left - plan.ox) / plan.s, (e.clientY - r.top - plan.oz) / plan.s);
  };
  return (
    <div className="twin-card pointer-events-auto p-2!" style={{ width: W + 16 }}>
      <div className="relative">
        <canvas ref={canvas} onClick={go} style={{ width: W, height: H, cursor: "crosshair", display: "block" }} role="img"
          aria-label={`Map of ${floor.name}. The dot is the point the 3D view looks at. Click to move there.`} />
        {floor.northDeg != null && <MapNorth northDeg={floor.northDeg} light={light} />}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2 text-[11px] text-[#8fb6cc]">
        <span className="truncate">{floor.name}</span>
        {bar && bar.px > 12 && bar.px < W && (
          <span className="flex shrink-0 flex-col items-end" aria-label={`Scale: this bar is ${bar.metres} metres`}>
            <span>{bar.metres} m</span>
            <span aria-hidden className="block h-1.5 border-x border-b border-[#8fb6cc]" style={{ width: bar.px }} />
          </span>
        )}
      </div>
    </div>
  );
}
