"use client";
/**
 * Room layout editor: trace rooms over a floor-plan image. Add, drag, resize (8 handles, 5-unit snap), edit
 * properties, delete empty rooms, then save the whole floor in one go.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type KeyboardEvent } from "react";
import { dragRect, placeNewRoom, type Handle, type Rect } from "@/lib/assets/geometry";
import { fitLabel } from "@/lib/assets/visuals";
import { humanize } from "@/lib/status";
import { usePanZoom } from "./use-pan-zoom";

export type EditorRoom = {
  id: number | null; code: string; name: string; type: string; departmentId: number | null; beds: number;
  x: number; y: number; w: number; h: number; assetCount: number;
};
type Row = EditorRoom & { key: string };
type SaveFn = (input: { floorId: number; rooms: Omit<EditorRoom, "assetCount">[] }) => Promise<{ ok: true; message: string; idMap: Record<string, number> } | { ok: false; error: string }>;

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSOR: Record<Handle, string> = { move: "move", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };

const field = "w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-[14px] focus:border-primary focus:outline-none";

export function LayoutEditor({ floor, rooms: initial, departments, roomTypes, save }: {
  floor: { id: number; name: string; level: number; planWidth: number; planHeight: number; planImageUrl: string | null };
  rooms: EditorRoom[]; departments: { id: number; name: string; code: string; tint: string }[]; roomTypes: string[]; save: SaveFn;
}) {
  const router = useRouter();
  const plan = { w: floor.planWidth, h: floor.planHeight };
  const [rows, setRows] = useState<Row[]>(() => initial.map((r) => ({ ...r, key: `r${r.id}` })));
  const [sel, setSel] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [imgOpacity, setImgOpacity] = useState(0.8);
  const counter = useRef(0);
  const { svgRef: canvasRef, ...pz } = usePanZoom(plan, { maxZoom: 20 });
  const op = useRef<{ key: string; handle: Handle; start: Rect; px: number; py: number; pointerId: number } | null>(null);
  const tint = useMemo(() => new Map(departments.map((d) => [d.id, d.tint])), [departments]);
  const selected = rows.find((r) => r.key === sel) ?? null;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (key: string, patch: Partial<Row>) => {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const addRoom = () => {
    counter.current += 1;
    const last = selected ?? rows[rows.length - 1];
    const rect = placeNewRoom(pz.vb, rows, { w: 100, h: 80 }, plan);
    const n = rows.length + counter.current;
    const key = `new-${counter.current}`;
    const row: Row = { key, id: null, code: `${floor.level < 0 ? "B" : floor.level}-RM${String(n).padStart(2, "0")}`, name: `Room ${n}`,
      type: last?.type ?? "PATIENT_ROOM", departmentId: last?.departmentId ?? null, beds: 0, assetCount: 0, ...rect };
    setRows((list) => [...list, row]);
    setSel(key);
    setDirty(true);
  };
  const duplicate = () => {
    if (!selected) return;
    counter.current += 1;
    const key = `new-${counter.current}`;
    const suffix = selected.code.match(/(\d+)$/);
    const nextCode = suffix ? selected.code.replace(/(\d+)$/, String(Number(suffix[1]) + 1).padStart(suffix[1].length, "0")) : `${selected.code}-2`;
    const row: Row = { ...selected, key, id: null, assetCount: 0, code: nextCode, x: Math.min(plan.w - selected.w, selected.x + selected.w + 10) };
    setRows((list) => [...list, row]);
    setSel(key);
    setDirty(true);
  };
  const remove = () => {
    if (!selected || selected.assetCount > 0) return;
    setRows((list) => list.filter((r) => r.key !== selected.key));
    setSel(null);
    setDirty(true);
  };
  const discard = () => {
    setRows(initial.map((r) => ({ ...r, key: `r${r.id}` })));
    setSel(null);
    setDirty(false);
    setMsg(null);
  };
  const onSave = async () => {
    setBusy(true);
    setMsg(null);
    const payload = rows.map(({ id, code, name, type, departmentId, beds, x, y, w, h }) => ({ id, code, name, type, departmentId, beds, x, y, w, h }));
    const res = await save({ floorId: floor.id, rooms: payload });
    setBusy(false);
    if (!res.ok) { setMsg({ tone: "danger", text: res.error }); return; }
    setRows((list) => list.map((r, i) => (r.id ? r : { ...r, id: res.idMap[`new-${i}`] ?? null, key: `r${res.idMap[`new-${i}`] ?? r.key}` })));
    setSel((s) => { if (!s) return s; const i = rows.findIndex((r) => r.key === s); const nid = res.idMap[`new-${i}`]; return nid ? `r${nid}` : s; });
    setDirty(false);
    setMsg({ tone: "ok", text: res.message });
    router.refresh();
  };

  /* pointer handling: rooms + handles, background pans */
  const startOp = (e: RPointerEvent, key: string, handle: Handle) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    const r = rows.find((x) => x.key === key);
    if (!r) return;
    setSel(key);
    const p = pz.toPlan(e.clientX, e.clientY);
    op.current = { key, handle, start: { x: r.x, y: r.y, w: r.w, h: r.h }, px: p.x, py: p.y, pointerId: e.pointerId };
    try { canvasRef.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const o = op.current;
    if (o && o.pointerId === e.pointerId) {
      const p = pz.toPlan(e.clientX, e.clientY);
      const next = dragRect(o.start, o.handle, p.x - o.px, p.y - o.py, plan);
      update(o.key, next);
      return;
    }
    pz.onPointerMove(e);
  };
  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    if (op.current && op.current.pointerId === e.pointerId) { op.current = null; return; }
    if (pz.onPointerUp(e)) setSel(null);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (selected && e.target === e.currentTarget && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : 5;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      update(selected.key, e.altKey
        ? { w: Math.max(20, selected.w + dx), h: Math.max(20, selected.h + dy) }
        : { x: Math.max(0, Math.min(plan.w - selected.w, selected.x + dx)), y: Math.max(0, Math.min(plan.h - selected.h, selected.y + dy)) });
      return;
    }
    if (selected && (e.key === "Delete" || e.key === "Backspace") && e.target === e.currentTarget) { e.preventDefault(); remove(); return; }
    if (e.key === "Escape") { setSel(null); return; }
    pz.onKeyDown(e);
  };

  const k = pz.scale;
  const hs = 7 / k; // handle size in plan units (constant on screen)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={addRoom} className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-strong">Add room</button>
        <button type="button" onClick={duplicate} disabled={!selected} className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken disabled:opacity-50">Duplicate</button>
        <button type="button" onClick={remove} disabled={!selected || selected.assetCount > 0}
          title={selected && selected.assetCount > 0 ? "Move its equipment out first" : undefined}
          className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger-soft disabled:opacity-50">Delete room</button>
        <span className="mx-1 h-6 w-px bg-line" aria-hidden />
        {floor.planImageUrl && (
          <label className="flex items-center gap-2 text-sm text-muted">Plan image
            <input type="range" min={0} max={1} step={0.05} value={imgOpacity} onChange={(e) => setImgOpacity(Number(e.target.value))} aria-label="Plan image opacity" />
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-sm text-warn">Unsaved changes</span>}
          <button type="button" onClick={discard} disabled={!dirty || busy} className="rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary-soft disabled:opacity-50">Discard changes</button>
          <button type="button" onClick={onSave} disabled={!dirty || busy} className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-strong disabled:opacity-50">
            {busy ? "Saving…" : "Save layout"}
          </button>
        </div>
      </div>
      {msg && <p role={msg.tone === "ok" ? "status" : "alert"} className={`rounded-[var(--radius-control)] border px-3 py-2 text-sm ${msg.tone === "ok" ? "border-ok bg-ok-soft text-ok" : "border-danger bg-danger-soft text-danger"}`}>{msg.text}</p>}

      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-sunken">
          <svg ref={canvasRef} viewBox={`${pz.vb.x} ${pz.vb.y} ${pz.vb.w} ${pz.vb.h}`} preserveAspectRatio="xMidYMid meet"
            className="block h-[60vh] min-h-[340px] w-full select-none outline-none lg:h-[calc(100vh-16rem)]" style={{ touchAction: "none" }}
            tabIndex={0} role="application"
            aria-label="Room layout canvas. Arrow keys move the selected room (Shift for 1 unit, Alt to resize), Delete removes it; without a selection arrows pan."
            onPointerDown={(e) => pz.onPointerDown(e)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={(e) => { op.current = null; pz.cancelPointer(e.pointerId); }}
            onKeyDown={onKey}>
            <defs>
              <pattern id="editor-grid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M10 0H0V10" fill="none" style={{ stroke: "var(--color-line)" }} strokeWidth={0.5} />
              </pattern>
            </defs>
            <rect x={0} y={0} width={plan.w} height={plan.h} style={{ fill: "var(--color-surface)" }} />
            <rect x={0} y={0} width={plan.w} height={plan.h} fill="url(#editor-grid)" />
            {floor.planImageUrl && (
              <image href={floor.planImageUrl} x={0} y={0} width={plan.w} height={plan.h} preserveAspectRatio="xMidYMid meet" opacity={imgOpacity} />
            )}
            <rect x={0} y={0} width={plan.w} height={plan.h} fill="none" style={{ stroke: "var(--color-muted)" }} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {rows.map((r) => {
              const isSel = r.key === sel;
              const t = r.departmentId != null ? tint.get(r.departmentId) : undefined;
              const fs = Math.min(11 / k, r.h * 0.2, 14);
              return (
                <g key={r.key}>
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={1.5}
                    style={{ fill: r.type === "CORRIDOR" ? "var(--color-sunken)" : t ?? "var(--color-muted)", fillOpacity: r.type === "CORRIDOR" ? 0.7 : isSel ? 0.3 : 0.16,
                      stroke: isSel ? "var(--color-primary)" : t ?? "var(--color-muted)", cursor: "move" }}
                    strokeWidth={isSel ? 2.5 : 1.2} vectorEffect="non-scaling-stroke"
                    onPointerDown={(e) => startOp(e, r.key, "move")} />
                  {fs * k >= 6 && (
                    <text x={r.x + 2 / k + 1} y={r.y + fs + 1} fontSize={fs} fontWeight={600} style={{ fill: "var(--color-ink)", pointerEvents: "none" }}>
                      {fitLabel(r.code, r.w, fs)}
                      {r.h > fs * 3 && <tspan x={r.x + 2 / k + 1} dy={fs * 1.15} fontWeight={400} fontSize={fs * 0.85} style={{ fill: "var(--color-muted)" }}>{fitLabel(r.name, r.w, fs * 0.85)}</tspan>}
                    </text>
                  )}
                  {r.assetCount > 0 && fs * k >= 6 && (
                    <text x={r.x + r.w - 3 / k} y={r.y + r.h - 3 / k} textAnchor="end" fontSize={fs * 0.85} style={{ fill: "var(--color-muted)", pointerEvents: "none" }}>{r.assetCount} assets</text>
                  )}
                </g>
              );
            })}
            {selected && HANDLES.map((h) => {
              const cx = selected.x + (h.includes("w") ? 0 : h.includes("e") ? selected.w : selected.w / 2);
              const cy = selected.y + (h.includes("n") ? 0 : h.includes("s") ? selected.h : selected.h / 2);
              return (
                <rect key={h} x={cx - hs} y={cy - hs} width={hs * 2} height={hs * 2} rx={hs * 0.3}
                  style={{ fill: "var(--color-surface)", stroke: "var(--color-primary)", cursor: CURSOR[h] }} strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                  onPointerDown={(e) => startOp(e, selected.key, h)} />
              );
            })}
          </svg>
          <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface shadow-sm">
            <button type="button" onClick={() => pz.zoomBy(1.5)} className="px-2.5 py-1.5 font-bold hover:bg-sunken" aria-label="Zoom in">+</button>
            <button type="button" onClick={() => pz.zoomBy(1 / 1.5)} className="border-t border-line px-2.5 py-1.5 font-bold hover:bg-sunken" aria-label="Zoom out">−</button>
            <button type="button" onClick={() => pz.fit()} className="border-t border-line px-1.5 py-1.5 text-xs font-semibold hover:bg-sunken">Fit</button>
          </div>
          <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-surface/90 px-2 py-1 text-xs text-muted">
            Drag a room to move it · drag the handles to resize · drag empty space to pan · {plan.w} × {plan.h} units
          </p>
        </div>

        <aside className="rounded-[var(--radius-panel)] border border-line bg-surface lg:w-80 lg:shrink-0">
          {selected ? (
            <div className="space-y-3 p-4 text-sm">
              <h2 className="text-[15px] font-semibold">Room {selected.code}{selected.id === null && <span className="ml-2 text-xs font-normal text-warn">new</span>}</h2>
              <div className="grid grid-cols-2 gap-2">
                <label className="col-span-1"><span className="mb-0.5 block text-xs font-semibold">Code</span>
                  <input className={`${field} uppercase`} value={selected.code} onChange={(e) => update(selected.key, { code: e.target.value.toUpperCase() })} /></label>
                <label><span className="mb-0.5 block text-xs font-semibold">Beds</span>
                  <input className={field} type="number" min={0} value={selected.beds} onChange={(e) => update(selected.key, { beds: Math.max(0, Number(e.target.value) || 0) })} /></label>
                <label className="col-span-2"><span className="mb-0.5 block text-xs font-semibold">Name</span>
                  <input className={field} value={selected.name} onChange={(e) => update(selected.key, { name: e.target.value })} /></label>
                <label className="col-span-2"><span className="mb-0.5 block text-xs font-semibold">Type</span>
                  <select className={field} value={selected.type} onChange={(e) => update(selected.key, { type: e.target.value })}>
                    {roomTypes.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
                  </select></label>
                <label className="col-span-2"><span className="mb-0.5 block text-xs font-semibold">Department</span>
                  <select className={field} value={selected.departmentId ?? ""} onChange={(e) => update(selected.key, { departmentId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Unassigned</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
                  </select></label>
                {(["x", "y", "w", "h"] as const).map((key) => (
                  <label key={key}><span className="mb-0.5 block text-xs font-semibold">{{ x: "X", y: "Y", w: "Width", h: "Height" }[key]}</span>
                    <input className={field} type="number" value={Math.round(selected[key])}
                      onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) update(selected.key, { [key]: key === "w" || key === "h" ? Math.max(5, v) : Math.max(0, v) }); }} /></label>
                ))}
              </div>
              {selected.assetCount > 0 && <p className="text-xs text-muted">Holds {selected.assetCount} assets — it can be moved and resized, but not deleted.</p>}
            </div>
          ) : (
            <div className="p-4 text-sm">
              <h2 className="mb-1 text-[15px] font-semibold">{rows.length} rooms on {floor.name}</h2>
              <p className="mb-3 text-muted">Select a room on the plan or below to edit it. Add rooms and trace them over the plan image.</p>
              <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">
                {rows.map((r) => (
                  <li key={r.key}>
                    <button type="button" onClick={() => { setSel(r.key); pz.fit(r, 0.8); }} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-sunken">
                      <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: r.departmentId != null ? tint.get(r.departmentId) : "var(--color-line)" }} />
                      <span className="font-mono text-xs">{r.code}</span><span className="truncate text-muted">{r.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
