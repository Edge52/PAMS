"use client";
/**
 * Pathway canvas (wave 7, step 7e): drag steps (snapped to a 20 px grid), draw an arrow by dragging from a step's
 * handle onto another step, pan by dragging the background, zoom with the buttons or Ctrl + wheel. Click a step or
 * arrow to see it beside the canvas and open its form. Keyboard: Tab to a step, arrow keys move it, Enter selects it.
 * Positions are saved for every step together when one moves; "Tidy up" goes back to the automatic layout.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { quickLinkAction, saveLayoutAction, setFlowModeAction } from "@/app/flows/actions";
import { BOX_H as H, BOX_W as W, GAP_X as GX, snap } from "./layout";

export type CanvasStep = { key: string; label: string; kind: "START" | "STEP" | "END"; x: number; y: number; place: string | null; minutes: string | null; perDay: string | null; problem: boolean };
export type CanvasLink = { id: number; fromKey: string; toKey: string; share: number; urgent: boolean; transport: string; condition: string | null };

export function FlowCanvas({ flowId, steps, links, editable, selected }: {
  flowId: number; steps: CanvasStep[]; links: CanvasLink[]; editable: boolean; selected: { step?: string; link?: number };
}) {
  const router = useRouter();
  const svg = useRef<SVGSVGElement>(null);
  const [pos, setPos] = useState(() => new Map(steps.map((s) => [s.key, { x: s.x, y: s.y }])));
  const [view, setView] = useState({ tx: 0, ty: 0, k: 1 });
  const [sel, setSel] = useState<{ step?: string; link?: number }>(selected);
  const [wire, setWire] = useState<{ from: string; x: number; y: number } | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const act = useRef<{ kind: "step"; key: string; dx: number; dy: number; moved: boolean; x: number; y: number } | { kind: "pan"; x: number; y: number; tx: number; ty: number } | { kind: "wire"; from: string } | null>(null);

  // The server's positions win after a save or a change elsewhere.
  const sig = steps.map((s) => `${s.key}:${s.x}:${s.y}`).join("|");
  const [lastSig, setLastSig] = useState(sig);
  if (sig !== lastSig) { setLastSig(sig); setPos(new Map(steps.map((s) => [s.key, { x: s.x, y: s.y }]))); }

  const size = useMemo(() => {
    const ps = [...pos.values()];
    return { w: Math.max(640, ...ps.map((p) => p.x + W + 80)), h: Math.max(360, ...ps.map((p) => p.y + H + 80)) };
  }, [pos]);
  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.tx) / view.k, y: (e.clientY - r.top - view.ty) / view.k };
  };
  const stepAt = (x: number, y: number) => steps.find((s) => { const p = pos.get(s.key)!; return x >= p.x && x <= p.x + W && y >= p.y && y <= p.y + H; });

  async function saveAll(next: Map<string, { x: number; y: number }>) {
    setBusy(true);
    const res = await saveLayoutAction(flowId, [...next].map(([key, p]) => ({ key, x: p.x, y: p.y })));
    setBusy(false);
    if (res?.error) setMsg({ error: res.error });
    router.refresh();
  }
  async function tidy() {
    setBusy(true);
    const res = await saveLayoutAction(flowId, steps.map((s) => ({ key: s.key, x: null, y: null })));
    setBusy(false); setMsg(res); router.refresh();
  }
  async function connect(from: string, to: string) {
    setBusy(true);
    const res = await quickLinkAction(flowId, from, to);
    setBusy(false); setMsg(res); router.refresh();
  }
  function pick(next: { step?: string; link?: number }) {
    setSel(next);
    const q = next.step ? `?edit=${next.step}` : next.link ? `?link=${next.link}` : "?";
    router.replace(q, { scroll: false });
  }

  function onDown(e: React.PointerEvent) {
    const p = toCanvas(e);
    const t = (e.target as Element).closest("[data-handle],[data-step]");
    if (editable && t?.getAttribute("data-handle")) {
      act.current = { kind: "wire", from: t.getAttribute("data-handle")! };
      setWire({ from: t.getAttribute("data-handle")!, x: p.x, y: p.y });
    } else if (t?.getAttribute("data-step")) {
      const key = t.getAttribute("data-step")!; const sp = pos.get(key)!;
      act.current = { kind: "step", key, dx: p.x - sp.x, dy: p.y - sp.y, moved: false, x: sp.x, y: sp.y };
    } else {
      act.current = { kind: "pan", x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    const a = act.current; if (!a) return;
    if (a.kind === "pan") { setView((v) => ({ ...v, tx: a.tx + e.clientX - a.x, ty: a.ty + e.clientY - a.y })); return; }
    const p = toCanvas(e);
    if (a.kind === "wire") { setWire((w) => (w ? { ...w, x: p.x, y: p.y } : w)); return; }
    if (!editable) return;
    const nx = Math.max(0, snap(p.x - a.dx)), ny = Math.max(0, snap(p.y - a.dy));
    const cur = pos.get(a.key)!;
    if (nx !== cur.x || ny !== cur.y) { a.moved = true; a.x = nx; a.y = ny; setPos((m) => new Map(m).set(a.key, { x: nx, y: ny })); }
  }
  function onUp(e: React.PointerEvent) {
    const a = act.current; act.current = null;
    if (!a) return;
    if (a.kind === "wire") {
      setWire(null);
      const p = toCanvas(e); const target = stepAt(p.x, p.y);
      if (target && target.key !== a.from) void connect(a.from, target.key);
      return;
    }
    if (a.kind === "step") {
      if (a.moved) void saveAll(new Map(pos).set(a.key, { x: a.x, y: a.y }));
      else pick({ step: a.key });
      return;
    }
    if (a.kind === "pan" && Math.hypot(e.clientX - a.x, e.clientY - a.y) < 4) {
      const t = (e.target as Element).closest("[data-link]");
      if (t) pick({ link: Number(t.getAttribute("data-link")) }); else pick({});
    }
  }
  const zoom = (f: number) => setView((v) => ({ ...v, k: Math.min(2.5, Math.max(0.3, v.k * f)) }));
  useEffect(() => {
    const el = svg.current; if (!el) return;
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  function onKey(e: React.KeyboardEvent, key: string) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick({ step: key }); return; }
    const d = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[e.key];
    if (!d || !editable) return;
    e.preventDefault();
    const p = pos.get(key)!; const next = new Map(pos).set(key, { x: Math.max(0, p.x + d[0]), y: Math.max(0, p.y + d[1]) });
    setPos(next); void saveAll(next);
  }

  const selStep = steps.find((s) => s.key === sel.step);
  const selLink = links.find((l) => l.id === sel.link);
  const label = (k: string) => steps.find((s) => s.key === k)?.label ?? k;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <button type="button" onClick={() => zoom(1.2)} className="rounded border border-line px-2 py-0.5 hover:bg-canvas" aria-label="Zoom in">+</button>
          <button type="button" onClick={() => zoom(1 / 1.2)} className="rounded border border-line px-2 py-0.5 hover:bg-canvas" aria-label="Zoom out">−</button>
          <button type="button" onClick={() => setView({ tx: 0, ty: 0, k: 1 })} className="rounded border border-line px-2 py-0.5 hover:bg-canvas">Reset view</button>
          {editable && <button type="button" onClick={tidy} disabled={busy} className="rounded border border-line px-2 py-0.5 hover:bg-canvas">Tidy up</button>}
          <span className="text-xs text-muted">{editable ? "Drag steps to arrange them; drag from a step's ● onto another step to draw an arrow. Drag the background to pan; Ctrl + wheel zooms." : "Drag the background to pan; Ctrl + wheel zooms."}{busy ? " Saving…" : ""}</span>
        </div>
        {msg?.error && <p role="alert" className="mb-2 text-sm text-danger">{msg.error}</p>}
        {msg?.ok && !msg.error && <p className="mb-2 text-sm text-ok" aria-live="polite">{msg.ok}</p>}
        <div className="h-[28rem] overflow-hidden rounded border border-line bg-canvas">
          <svg ref={svg} width="100%" height="100%" className="touch-none select-none text-ink" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
            role="application" aria-label="Pathway canvas">
            <defs>
              <pattern id="grid" width={20} height={20} patternUnits="userSpaceOnUse"><circle cx={1} cy={1} r={0.8} fill="var(--color-line)" /></pattern>
              <marker id="carr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor" /></marker>
            </defs>
            <g transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
              <rect width={size.w} height={size.h} fill="url(#grid)" />
              {links.map((l) => {
                const a = pos.get(l.fromKey), b = pos.get(l.toKey); if (!a || !b) return null;
                const back = b.x <= a.x;
                const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
                const d = back
                  ? `M${a.x + W / 2},${a.y + H} C${a.x + W / 2},${a.y + H + 50} ${b.x + W / 2},${b.y + H + 50} ${b.x + W / 2},${b.y + H}`
                  : `M${x1},${y1} C${x1 + GX / 2},${y1} ${x2 - GX / 2},${y2} ${x2},${y2}`;
                const on = sel.link === l.id;
                return (
                  <g key={l.id} data-link={l.id} className={`cursor-pointer ${on ? "text-primary" : l.urgent ? "text-danger" : "text-muted"}`}>
                    <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                    <path d={d} fill="none" stroke="currentColor" strokeWidth={on ? 3 : 1.6} strokeDasharray={back ? "5 4" : undefined} markerEnd="url(#carr)" />
                    {l.share !== 100 && <text x={back ? (a.x + b.x + W) / 2 : (x1 + x2) / 2} y={back ? Math.max(a.y, b.y) + H + 42 : (y1 + y2) / 2 - 5} textAnchor="middle" fontSize="11" fill="currentColor"
                      style={{ paintOrder: "stroke", stroke: "var(--color-canvas)", strokeWidth: 3 }}>{l.share} %</text>}
                  </g>
                );
              })}
              {wire && (() => { const a = pos.get(wire.from)!; return <line x1={a.x + W} y1={a.y + H / 2} x2={wire.x} y2={wire.y} stroke="var(--color-primary)" strokeWidth={2} strokeDasharray="4 3" />; })()}
              {steps.map((s) => {
                const p = pos.get(s.key)!; const on = sel.step === s.key;
                return (
                  <g key={s.key} data-step={s.key} transform={`translate(${p.x},${p.y})`} tabIndex={0} role="button"
                    aria-label={`${s.label}${s.place ? `, ${s.place}` : ""}`} onKeyDown={(e) => onKey(e, s.key)}
                    className={`${editable ? "cursor-grab" : "cursor-pointer"} outline-none focus-visible:[&>rect]:stroke-primary`}>
                    <rect width={W} height={H} rx={8} fill={s.kind === "START" ? "var(--color-ok-soft)" : s.kind === "END" ? "var(--color-sunken)" : "var(--color-surface)"}
                      stroke={on ? "var(--color-primary)" : s.problem ? "var(--color-danger)" : "var(--color-line)"} strokeWidth={on || s.problem ? 2 : 1} />
                    <text x={10} y={20} fontSize="13" fontWeight={600} fill="currentColor">{s.label.length > 24 ? `${s.label.slice(0, 23)}…` : s.label}</text>
                    <text x={10} y={37} fontSize="11" fill="var(--color-muted)">{s.place ? (s.place.length > 28 ? `${s.place.slice(0, 27)}…` : s.place) : s.kind === "STEP" ? "No place yet" : s.kind === "START" ? "Start" : "End"}</text>
                    <text x={10} y={53} fontSize="11" fill="var(--color-muted)">{[s.minutes, s.perDay].filter(Boolean).join(" · ")}</text>
                    {editable && s.kind !== "END" && <circle data-handle={s.key} cx={W} cy={H / 2} r={7} fill="var(--color-primary)" stroke="var(--color-surface)" strokeWidth={2} className="cursor-crosshair"><title>Drag onto another step to draw an arrow</title></circle>}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>
      <aside className="rounded border border-line p-3 text-sm" aria-live="polite">
        {selStep ? (
          <>
            <p className="font-semibold">{selStep.label}</p>
            <p className="text-muted">{selStep.place ?? "No place yet"}</p>
            <p className="mt-1 text-xs text-muted">{[selStep.minutes, selStep.perDay].filter(Boolean).join(" · ") || "—"}</p>
            <p className="mt-2 text-xs">Arrows out: {links.filter((l) => l.fromKey === selStep.key).map((l) => `${label(l.toKey)} ${l.share} %`).join(", ") || "none"}</p>
            {editable && <Link href={`?edit=${selStep.key}#step-form`} scroll className="mt-2 inline-block text-primary hover:underline">Edit this step</Link>}
          </>
        ) : selLink ? (
          <>
            <p className="font-semibold">{label(selLink.fromKey)} → {label(selLink.toKey)}</p>
            <p className="text-muted">{selLink.share} % · {selLink.transport}{selLink.urgent ? " · urgent" : ""}</p>
            {selLink.condition && <p className="text-xs text-muted">{selLink.condition}</p>}
            {editable && <Link href={`?link=${selLink.id}#link-form`} scroll className="mt-2 inline-block text-primary hover:underline">Edit this arrow</Link>}
          </>
        ) : <p className="text-muted">Select a step or an arrow to see it here.</p>}
      </aside>
    </div>
  );
}

/** List or canvas, remembered in a cookie so it survives saving a form. */
export function ModeToggle({ mode }: { mode: "list" | "canvas" }) {
  const router = useRouter();
  const set = async (m: "list" | "canvas") => { await setFlowModeAction(m); router.refresh(); };
  return (
    <div className="inline-flex rounded border border-line text-sm" role="group" aria-label="Diagram">
      {(["list", "canvas"] as const).map((m) => (
        <button key={m} type="button" onClick={() => void set(m)} aria-pressed={mode === m}
          className={`px-2.5 py-0.5 ${mode === m ? "bg-primary text-white" : "hover:bg-canvas"}`}>{m === "list" ? "Diagram" : "Canvas"}</button>
      ))}
    </div>
  );
}
