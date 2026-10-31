"use client";
/**
 * Interactive floor map — the showpiece of the asset module.
 * Rooms tinted by department, amber asset pins (shape = device category, ring = status), filters that dim
 * non-matches, room and asset side panel (bottom sheet on phones), drag a pin to move it, zoom/pan for mouse,
 * trackpad and touch, keyboard-accessible pins, deep links that focus and pulse a pin.
 */
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from "react";
import { Badge, StatusBadge } from "@/components/ui";
import { humanize } from "@/lib/status";
import { formatDate, todayISO } from "@/lib/format";
import { roomAt, type Rect } from "@/lib/assets/geometry";
import { layoutPins } from "@/lib/assets/pins";
import { fitLabel, pinStyle, RING_COLOR, shapePath, statusRing, type RingTone } from "@/lib/assets/visuals";
import type { MoveResult } from "@/lib/assets/mutations";
import { usePanZoom } from "./use-pan-zoom";

export type MapRoom = {
  id: number; code: string; name: string; type: string; beds: number; x: number; y: number; w: number; h: number;
  departmentId: number | null;
  /** Real outline from CAD (plan units); drawn instead of the rectangle when present. */
  polygon?: [number, number][] | null;
};
export type MapAsset = {
  id: number; tag: string; roomId: number; posX: number | null; posY: number | null; status: string; condition: string;
  criticality: string | null; manufacturer: string | null; model: string | null; serial: string | null; warrantyEnd: string | null;
  typeCode: string; typeName: string; categoryCode: string | null; categoryName: string | null;
};
export type MapDept = { id: number; code: string; name: string; nameAr: string | null; tint: string };
export type MapFloor = {
  id: number; name: string; level: number; planWidth: number; planHeight: number; planImageUrl: string | null;
  buildingName: string; facilityName: string;
};
type MoveAction = (input: { assetId: number; toRoomId: number; posX: number | null; posY: number | null; reason: string | null }) => Promise<MoveResult>;

type Selection = { kind: "room"; id: number } | { kind: "asset"; id: number } | null;
type Drag = { assetId: number; x: number; y: number; targetRoomId: number | null };
type PendingMove = { assetId: number; fromRoomId: number; toRoomId: number; posX: number | null; posY: number | null };
type Filters = { q: string; category: string; type: string; status: string; criticality: string };
const NO_FILTERS: Filters = { q: "", category: "", type: "", status: "", criticality: "" };
const STATUSES = ["IN_SERVICE", "INSTALLED", "IN_STOCK", "UNDER_MAINTENANCE", "OUT_OF_SERVICE"];
const CRITS = ["LIFE_SUPPORT", "HIGH", "MEDIUM", "LOW"];

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(cb: () => void) {
  const m = window.matchMedia(reducedMotionQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

function matchesFilters(a: MapAsset, f: Filters): boolean {
  if (f.category && a.categoryCode !== f.category) return false;
  if (f.type && a.typeCode !== f.type) return false;
  if (f.status && a.status !== f.status) return false;
  if (f.criticality && a.criticality !== f.criticality) return false;
  if (f.q) {
    const hay = `${a.tag} ${a.serial ?? ""} ${a.model ?? ""} ${a.manufacturer ?? ""} ${a.typeName} ${a.typeCode}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t))) return false;
  }
  return true;
}

/** Room name if it fits, else the short code ("BED03", "NS"), else a truncated name. */
function roomLabel(r: { name: string; code: string; w: number }, fs: number): string {
  const full = fitLabel(r.name, r.w, fs);
  if (full === r.name) return full;
  const short = r.code.split("-").slice(-1)[0];
  return fitLabel(short, r.w, fs) === short ? short : full;
}

const shortTag = (tag: string) => tag.split("-").slice(1).join("-") || tag;

export function FloorMap(props: {
  floor: MapFloor; rooms: MapRoom[]; assets: MapAsset[]; departments: MapDept[];
  unplaced: { departmentId: number; name: string; n: number }[];
  focusRoomId?: number | null; focusAssetId?: number | null; moveAction: MoveAction;
  /** Role may move assets (drag pins, move from the panel). Hiding is courtesy; the action checks again. */
  canMove?: boolean;
  /** Role may register assets ("Add asset here"). */
  canAdd?: boolean;
}) {
  const { floor, rooms, departments } = props;
  const canMove = props.canMove ?? false;
  const canAdd = props.canAdd ?? false;
  const uid = useId().replace(/:/g, "");
  const [assets, setAssets] = useState(props.assets);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [selection, setSelection] = useState<Selection>(() =>
    props.focusAssetId && props.assets.some((a) => a.id === props.focusAssetId) ? { kind: "asset", id: props.focusAssetId }
      : props.focusRoomId && rooms.some((r) => r.id === props.focusRoomId) ? { kind: "room", id: props.focusRoomId } : null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [hoverRoom, setHoverRoom] = useState<number | null>(null);
  const [focusedPin, setFocusedPin] = useState<number | null>(null);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(reducedMotionQuery).matches, () => true);

  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  const focusRect: Rect | null = useMemo(() => {
    const a = props.focusAssetId ? props.assets.find((x) => x.id === props.focusAssetId) : null;
    const r = roomById.get(a?.roomId ?? props.focusRoomId ?? -1);
    return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
  }, [props.focusAssetId, props.focusRoomId, props.assets, roomById]);

  // Frame the rooms rather than the whole sheet (CAD plans share one large site-wide sheet across floors).
  const contentRect = useMemo(() => {
    if (!rooms.length) return null;
    const x = Math.min(...rooms.map((r) => r.x)), y = Math.min(...rooms.map((r) => r.y));
    const w = Math.max(...rooms.map((r) => r.x + r.w)) - x, h = Math.max(...rooms.map((r) => r.y + r.h)) - y;
    return w > 0 && h > 0 && w * h < floor.planWidth * floor.planHeight * 0.7 ? { x, y, w, h } : null;
  }, [rooms, floor.planWidth, floor.planHeight]);
  const { svgRef: canvasRef, ...pz } = usePanZoom({ w: floor.planWidth, h: floor.planHeight }, { initialTarget: focusRect, content: contentRect });

  /* ── derived ── */
  const layout = useMemo(() => layoutPins(rooms, assets.map((a) => ({ id: a.id, roomId: a.roomId, posX: a.posX, posY: a.posY, sortKey: `${a.typeCode} ${a.tag}` }))), [rooms, assets]);
  const filtering = Object.values(filters).some(Boolean);
  const matchIds = useMemo(() => new Set(assets.filter((a) => matchesFilters(a, filters)).map((a) => a.id)), [assets, filters]);
  const roomsWithMatches = useMemo(() => {
    const s = new Set<number>();
    if (filtering) for (const a of assets) if (matchIds.has(a.id)) s.add(a.roomId);
    return s;
  }, [assets, matchIds, filtering]);
  const categories = useMemo(() => {
    const m = new Map<string, { code: string; name: string; n: number }>();
    for (const a of assets) {
      const code = a.categoryCode ?? a.typeCode.split("-")[0];
      const e = m.get(code) ?? { code, name: a.categoryName ?? code, n: 0 };
      e.n++;
      m.set(code, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [assets]);
  const types = useMemo(() => {
    const m = new Map<string, { code: string; name: string; n: number }>();
    for (const a of assets) {
      if (filters.category && a.categoryCode !== filters.category) continue;
      const e = m.get(a.typeCode) ?? { code: a.typeCode, name: a.typeName, n: 0 };
      e.n++;
      m.set(a.typeCode, e);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [assets, filters.category]);
  const deptSummary = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of assets) {
      const d = roomById.get(a.roomId)?.departmentId;
      if (d != null) m.set(d, (m.get(d) ?? 0) + 1);
    }
    return departments.map((d) => ({ ...d, n: m.get(d.id) ?? 0, rooms: rooms.filter((r) => r.departmentId === d.id).length }));
  }, [assets, departments, rooms, roomById]);
  const statusSummary = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assets) m.set(a.status, (m.get(a.status) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => STATUSES.indexOf(a[0]) - STATUSES.indexOf(b[0]));
  }, [assets]);

  /* ── url sync (event-driven, not in effects) ── */
  const syncUrl = useCallback((sel: Selection) => {
    const u = new URL(window.location.href);
    u.searchParams.set("floorId", String(floor.id));
    u.searchParams.delete("roomId"); u.searchParams.delete("assetId");
    if (sel?.kind === "room") u.searchParams.set("roomId", String(sel.id));
    if (sel?.kind === "asset") u.searchParams.set("assetId", String(sel.id));
    window.history.replaceState(window.history.state, "", u.toString());
  }, [floor.id]);

  const select = useCallback((sel: Selection) => {
    setSelection(sel);
    setPending(null);
    syncUrl(sel);
  }, [syncUrl]);

  /* ── pulse the deep-linked pin once ── */
  const pulseRef = useRef<SVGCircleElement | null>(null);
  const [pulseId] = useState(props.focusAssetId ?? null);
  useEffect(() => {
    if (reducedMotion || !pulseRef.current) return;
    const anim = pulseRef.current.animate(
      [{ transform: "scale(1)", opacity: 0.85 }, { transform: "scale(3.4)", opacity: 0 }],
      { duration: 1100, iterations: 2, easing: "ease-out", delay: 250 },
    );
    return () => anim.cancel();
  }, [reducedMotion]);

  /* ── pin dragging ── */
  const dragRef = useRef<{
    assetId: number; pointerId: number; sx: number; sy: number; touch: boolean; active: boolean; timer: number | null;
  } | null>(null);
  const dragStateRef = useRef<Drag | null>(null);
  const downRoomRef = useRef<string | null>(null);
  const downPinRef = useRef<number | null>(null);

  const setDragBoth = (d: Drag | null) => { dragStateRef.current = d; setDrag(d); };

  const activateDrag = (assetId: number, clientX: number, clientY: number) => {
    const p = pz.toPlan(clientX, clientY);
    const target = roomAt(rooms, p);
    setDragBoth({ assetId, x: p.x, y: p.y, targetRoomId: target?.id ?? null });
  };

  const onPinPointerDown = (e: RPointerEvent<SVGGElement>, a: MapAsset) => {
    if (!canMove) return; // let the plan pan; a tap selects the pin (see onSvgPointerUp)
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    if (dragRef.current) return;
    const touch = e.pointerType === "touch";
    const state = { assetId: a.id, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, touch, active: false, timer: null as number | null };
    if (touch) {
      // Long-press picks a pin up on touch screens; a quick swipe pans instead.
      state.timer = window.setTimeout(() => {
        if (dragRef.current?.assetId !== a.id) return;
        dragRef.current.active = true;
        if (navigator.vibrate) navigator.vibrate(15);
        activateDrag(a.id, dragRef.current.sx, dragRef.current.sy);
      }, 380);
    }
    dragRef.current = state;
    try { canvasRef.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const finishDrag = async (d: Drag) => {
    const a = assetById.get(d.assetId);
    setDragBoth(null);
    if (!a) return;
    if (d.targetRoomId == null) {
      setMessage({ tone: "danger", text: "Dropped outside a room — nothing changed." });
      return;
    }
    const pos = { posX: Math.round(d.x * 10) / 10, posY: Math.round(d.y * 10) / 10 };
    if (d.targetRoomId === a.roomId) {
      const before = assets;
      setAssets((list) => list.map((x) => (x.id === a.id ? { ...x, ...pos } : x)));
      const res = await props.moveAction({ assetId: a.id, toRoomId: a.roomId, ...pos, reason: null });
      if (!res.ok) { setAssets(before); setMessage({ tone: "danger", text: res.error }); }
      else setMessage({ tone: "ok", text: `${a.tag}: pin position saved.` });
      return;
    }
    setSelection({ kind: "asset", id: a.id });
    syncUrl({ kind: "asset", id: a.id });
    setPending({ assetId: a.id, fromRoomId: a.roomId, toRoomId: d.targetRoomId, ...pos });
  };

  const onSvgPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (dragRef.current && dragRef.current.pointerId !== e.pointerId) {
      // A second finger during a touch hold → it's a pinch; drop the pin hold.
      const d = dragRef.current;
      if (d.timer) clearTimeout(d.timer);
      dragRef.current = null;
      setDragBoth(null);
      pz.startPointer(d.pointerId, d.sx, d.sy);
    }
    downRoomRef.current = (e.target as Element).closest?.("[data-room-id]")?.getAttribute("data-room-id") ?? null;
    const pin = (e.target as Element).closest?.("[data-asset-id]")?.getAttribute("data-asset-id");
    downPinRef.current = pin ? Number(pin) : null;
    pz.onPointerDown(e);
  };

  const onSvgPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (d && d.pointerId === e.pointerId) {
      const dist = Math.hypot(e.clientX - d.sx, e.clientY - d.sy);
      if (!d.active) {
        if (d.touch) {
          if (dist > 8) { // swipe before the long-press fired → pan
            if (d.timer) clearTimeout(d.timer);
            dragRef.current = null;
            pz.startPointer(e.pointerId, d.sx, d.sy);
            pz.onPointerMove(e);
          }
          return;
        }
        if (dist < 4) return;
        d.active = true;
      }
      activateDrag(d.assetId, e.clientX, e.clientY);
      return;
    }
    pz.onPointerMove(e);
  };

  const onSvgPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (d && d.pointerId === e.pointerId) {
      if (d.timer) clearTimeout(d.timer);
      dragRef.current = null;
      if (d.active && dragStateRef.current) void finishDrag(dragStateRef.current);
      else select({ kind: "asset", id: d.assetId });
      return;
    }
    const downRoom = downRoomRef.current;
    const downPin = downPinRef.current;
    const tap = pz.onPointerUp(e);
    if (!tap) return;
    if (downPin != null) select({ kind: "asset", id: downPin });
    else if (downRoom) select({ kind: "room", id: Number(downRoom) });
    else select(null);
  };

  const onSvgPointerCancel = (e: RPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (d && d.pointerId === e.pointerId) {
      if (d.timer) clearTimeout(d.timer);
      dragRef.current = null;
      setDragBoth(null);
    }
    pz.cancelPointer(e.pointerId);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragRef.current) {
        dragRef.current = null;
        dragStateRef.current = null;
        setDrag(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ── move confirmation ── */
  const confirmMove = async (reason: string) => {
    if (!pending) return;
    const a = assetById.get(pending.assetId);
    const to = roomById.get(pending.toRoomId);
    if (!a || !to) return;
    setBusy(true);
    const before = assets;
    setAssets((list) => list.map((x) => (x.id === a.id ? { ...x, roomId: to.id, posX: pending.posX, posY: pending.posY, status: x.status === "IN_STOCK" ? "INSTALLED" : x.status } : x)));
    const res = await props.moveAction({ assetId: a.id, toRoomId: to.id, posX: pending.posX, posY: pending.posY, reason: reason || null });
    setBusy(false);
    setPending(null);
    if (!res.ok) { setAssets(before); setMessage({ tone: "danger", text: res.error }); return; }
    setMessage({ tone: "ok", text: res.summary });
  };

  const requestMoveFromPanel = (assetId: number, toRoomId: number) => {
    const a = assetById.get(assetId);
    if (!a || a.roomId === toRoomId) return;
    setPending({ assetId, fromRoomId: a.roomId, toRoomId, posX: null, posY: null });
  };

  /* ── geometry helpers for render ── */
  const k = pz.scale;
  const labelPx = 11;
  const showCodes = k > 1.6;
  const showPinTags = k > 5.5;
  const planImage = floor.planImageUrl;
  const deptFit = (deptId: number) => {
    const rs = rooms.filter((r) => r.departmentId === deptId);
    if (!rs.length) return;
    const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
    const x2 = Math.max(...rs.map((r) => r.x + r.w)), y2 = Math.max(...rs.map((r) => r.y + r.h));
    pz.fit({ x, y, w: x2 - x, h: y2 - y }, 0.15);
  };

  const selectedRoomId = selection?.kind === "room" ? selection.id : selection?.kind === "asset" ? assetById.get(selection.id)?.roomId ?? null : null;
  const selectedAssetId = selection?.kind === "asset" ? selection.id : null;

  const ringOf = (s: string): RingTone => statusRing(s);

  /* ── render pieces ── */
  const renderPin = (a: MapAsset, x: number, y: number, r: number, opts: { ghost?: boolean } = {}) => {
    const style = pinStyle(a.categoryCode ?? a.typeCode, a.categoryName);
    const dim = filtering && !matchIds.has(a.id);
    const hit = filtering && !!filters.q && matchIds.has(a.id);
    const selected = selectedAssetId === a.id;
    const ring = RING_COLOR[ringOf(a.status)];
    const glyphSize = r * (style.glyph.length > 1 ? 0.85 : 1.15);
    return (
      <g transform={`translate(${x} ${y})`} opacity={opts.ghost ? 0.85 : dim ? 0.2 : 1} style={{ transition: "opacity 150ms" }}>
        {(hit || selected) && (
          <circle r={r + 4.2} style={{ fill: "var(--color-tag-soft)", stroke: selected ? "var(--color-primary)" : "var(--color-tag)" }}
            strokeWidth={selected ? 2.2 : 1.5} vectorEffect="non-scaling-stroke" />
        )}
        <circle r={r + 1.9} style={{ fill: "var(--color-surface)", stroke: ring }} strokeWidth={2} vectorEffect="non-scaling-stroke"
          strokeDasharray={opts.ghost ? "3 2" : undefined} />
        <path d={shapePath(style.shape, r)} style={{ fill: "var(--color-tag)", stroke: "var(--color-ink)" }} strokeOpacity={0.35} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
        <text y={glyphSize * 0.36} textAnchor="middle" fontSize={glyphSize} fontWeight={700} style={{ fill: "var(--color-ink)", pointerEvents: "none", userSelect: "none" }}>
          {style.glyph}
        </text>
        {focusedPin === a.id && (
          <circle r={r + 5.5} fill="none" style={{ stroke: "var(--color-primary)" }} strokeWidth={2} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
        )}
        {(showPinTags || selected) && !opts.ghost && (
          <text y={r + 2 + 8 / k} textAnchor="middle" fontSize={8 / k} style={{ fill: "var(--color-ink)", paintOrder: "stroke", stroke: "var(--color-surface)", strokeWidth: 2.5 / k, pointerEvents: "none" }}>
            {shortTag(a.tag)}
          </text>
        )}
      </g>
    );
  };

  const dragAsset = drag ? assetById.get(drag.assetId) : null;
  const pendingAsset = pending ? assetById.get(pending.assetId) : null;

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter assets on this floor">
        <label className="min-w-[12rem] flex-1">
          <span className="sr-only">Search tag, serial, model or manufacturer</span>
          <input
            type="search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            placeholder="Search tag, serial, model…"
            className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-[14px] placeholder:text-faint focus:border-primary focus:outline-none"
          />
        </label>
        <MapSelect label="Category" all="All categories" value={filters.category} onChange={(v) => setFilters({ ...filters, category: v, type: "" })}
          options={categories.map((c) => ({ value: c.code, label: `${c.name} (${c.n})` }))} />
        <MapSelect label="Device type" all="All device types" value={filters.type} onChange={(v) => setFilters({ ...filters, type: v })}
          options={types.map((t) => ({ value: t.code, label: `${t.name} (${t.n})` }))} />
        <MapSelect label="Status" all="Any status" value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })}
          options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
        <MapSelect label="Criticality" all="Any criticality" value={filters.criticality} onChange={(v) => setFilters({ ...filters, criticality: v })}
          options={CRITS.map((s) => ({ value: s, label: humanize(s) }))} />
        {filtering && (
          <button type="button" onClick={() => setFilters(NO_FILTERS)} className="rounded-[var(--radius-control)] px-2 py-1.5 text-sm font-semibold text-primary hover:bg-primary-soft">
            Clear filters
          </button>
        )}
        <p className="ml-auto self-center text-sm text-muted" aria-live="polite">
          {filtering ? <><b className="text-ink">{matchIds.size}</b> of {assets.length} assets match</> : <>{assets.length} assets on this floor</>}
        </p>
      </div>

      {/* Summary strip */}
      <div className="flex gap-4 overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface px-3 py-2 text-sm">
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-xs text-muted">Departments</span>
          {deptSummary.map((d) => (
            <button key={d.id} type="button" onClick={() => deptFit(d.id)} title={`Zoom to ${d.name}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 hover:border-primary">
              <span aria-hidden className="size-2.5 rounded-sm" style={{ background: d.tint }} />
              <span className="whitespace-nowrap">{d.name}</span>
              <b className="tabular-nums">{d.n}</b>
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 border-l border-line pl-4">
          <span className="text-xs text-muted">Status</span>
          {statusSummary.map(([s, n]) => (
            <button key={s} type="button" aria-pressed={filters.status === s}
              onClick={() => setFilters({ ...filters, status: filters.status === s ? "" : s })}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${filters.status === s ? "border-primary bg-primary-soft" : "border-line hover:border-primary"}`}>
              <span aria-hidden className="size-2.5 rounded-full border-2" style={{ borderColor: RING_COLOR[ringOf(s)] }} />
              <span className="whitespace-nowrap">{humanize(s)}</span>
              <b className="tabular-nums">{n}</b>
            </button>
          ))}
          {statusSummary.length === 0 && <span className="text-muted">No assets placed yet</span>}
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row">
        {/* Map */}
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-sunken">
          <svg
            ref={canvasRef}
            viewBox={`${pz.vb.x} ${pz.vb.y} ${pz.vb.w} ${pz.vb.h}`}
            preserveAspectRatio="xMidYMid meet"
            className={`block h-[58vh] min-h-[340px] w-full select-none outline-none md:h-[calc(100vh-20rem)] ${drag ? "cursor-grabbing" : "cursor-grab"}`}
            style={{ touchAction: "none" }}
            tabIndex={0}
            role="application"
            aria-label={`Floor plan of ${floor.name}, ${floor.buildingName}. Arrow keys pan, plus and minus zoom, 0 fits. Tab to reach asset pins.`}
            onPointerDown={onSvgPointerDown}
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
            onPointerCancel={onSvgPointerCancel}
            onKeyDown={pz.onKeyDown}
            onDoubleClick={(e) => pz.zoomBy(1.8, pz.toPlan(e.clientX, e.clientY))}
          >
            <defs>
              <pattern id={`dots-${uid}`} width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.9" style={{ fill: "var(--color-line)" }} />
              </pattern>
            </defs>
            <rect x={-5000} y={-5000} width={10000 + floor.planWidth} height={10000 + floor.planHeight} style={{ fill: "var(--color-sunken)" }} />
            <rect x={0} y={0} width={floor.planWidth} height={floor.planHeight} style={{ fill: "var(--color-surface)", stroke: "var(--color-line)" }} vectorEffect="non-scaling-stroke" />
            {planImage
              ? <image href={planImage} x={0} y={0} width={floor.planWidth} height={floor.planHeight} preserveAspectRatio="xMidYMid meet" opacity={0.85} />
              : <rect x={0} y={0} width={floor.planWidth} height={floor.planHeight} fill={`url(#dots-${uid})`} />}

            {/* Rooms */}
            <g>
              {rooms.map((r) => {
                const dept = r.departmentId != null ? deptById.get(r.departmentId) : undefined;
                const corridor = r.type === "CORRIDOR";
                const sel = selectedRoomId === r.id;
                const target = drag?.targetRoomId === r.id && dragAsset?.roomId !== r.id;
                const hasMatch = roomsWithMatches.has(r.id);
                const baseFill = corridor ? "var(--color-sunken)" : dept?.tint ?? "var(--color-muted)";
                const fillOpacity = corridor ? (planImage ? 0.35 : 0.9) : (planImage ? 0.1 : 0.13) + (hoverRoom === r.id ? 0.07 : 0) + (sel ? 0.06 : 0);
                return (
                  <g key={r.id} data-room-id={r.id} onPointerEnter={() => setHoverRoom(r.id)} onPointerLeave={() => setHoverRoom((h) => (h === r.id ? null : h))}>
                    {r.polygon && r.polygon.length >= 3 ? (
                      <polygon points={r.polygon.map((p) => p.join(",")).join(" ")}
                        style={{ fill: baseFill, fillOpacity, stroke: target || hasMatch ? "var(--color-tag)" : sel ? "var(--color-primary)" : corridor ? "var(--color-line)" : dept?.tint ?? "var(--color-line)" }}
                        strokeOpacity={target || sel || hasMatch ? 1 : 0.55}
                        strokeWidth={target ? 3 : sel ? 2.5 : hasMatch ? 2 : 1}
                        strokeDasharray={target ? "6 3" : undefined}
                        vectorEffect="non-scaling-stroke" />
                    ) : <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={2}
                      style={{ fill: baseFill, fillOpacity, stroke: target || hasMatch ? "var(--color-tag)" : sel ? "var(--color-primary)" : corridor ? "var(--color-line)" : dept?.tint ?? "var(--color-line)" }}
                      strokeOpacity={target || sel || hasMatch ? 1 : 0.55}
                      strokeWidth={target ? 3 : sel ? 2.5 : hasMatch ? 2 : 1}
                      strokeDasharray={target ? "6 3" : undefined}
                      vectorEffect="non-scaling-stroke" />}
                    {(() => {
                      const fs = Math.min(labelPx / k, r.h * 0.16, 14);
                      if (fs * k < 6) return null;
                      return (
                        <text x={r.x + 3 / k + 1.5} y={r.y + fs + 2} fontSize={fs} fontWeight={600}
                          style={{ fill: corridor ? "var(--color-faint)" : "var(--color-ink)", fontStyle: corridor ? "italic" : undefined, pointerEvents: "none" }}>
                          {roomLabel(r, fs)}
                          {showCodes && !corridor && r.h > fs * 3 && (
                            <tspan x={r.x + 3 / k + 1.5} dy={fs * 1.1} fontSize={fs * 0.8} fontWeight={400} style={{ fill: "var(--color-muted)" }}>
                              {fitLabel(r.code + (r.beds ? ` · ${r.beds} bed${r.beds === 1 ? "" : "s"}` : ""), r.w, fs * 0.8)}
                            </tspan>
                          )}
                        </text>
                      );
                    })()}
                  </g>
                );
              })}
            </g>

            {/* Pins */}
            <g>
              {assets.map((a) => {
                const p = layout.pos.get(a.id);
                if (!p) return null;
                const isDragging = drag?.assetId === a.id;
                const isPending = pending?.assetId === a.id;
                const room = roomById.get(a.roomId);
                const label = `${a.typeName}, ${a.tag}, ${humanize(a.status)}${room ? `, in ${room.name}` : ""}`;
                return (
                  <g key={a.id}
                    role="button" tabIndex={0} aria-label={label} aria-pressed={selectedAssetId === a.id}
                    data-asset-id={a.id}
                    style={{ cursor: isDragging ? "grabbing" : "pointer", outline: "none" }}
                    opacity={isDragging || isPending ? 0.35 : 1}
                    onPointerDown={(e) => onPinPointerDown(e, a)}
                    onFocus={() => setFocusedPin(a.id)}
                    onBlur={() => setFocusedPin((f) => (f === a.id ? null : f))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select({ kind: "asset", id: a.id }); }
                    }}
                  >
                    <title>{label}</title>
                    {/* larger invisible hit area for fingers */}
                    <circle cx={p.x} cy={p.y} r={Math.max(p.r + 3, 10 / k)} fill="transparent" />
                    {renderPin(a, p.x, p.y, p.r)}
                    {pulseId === a.id && (
                      <circle ref={pulseRef} cx={p.x} cy={p.y} r={p.r + 2} fill="none" opacity={0}
                        style={{ stroke: "var(--color-tag)", transformBox: "fill-box", transformOrigin: "center", pointerEvents: "none" }} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                    )}
                  </g>
                );
              })}
              {layout.overflow.map((o) => (
                <g key={`of-${o.roomId}`} data-room-id={o.roomId} style={{ cursor: "pointer" }}>
                  <rect x={o.x - o.r * 1.6} y={o.y - o.r} width={o.r * 3.2} height={o.r * 2} rx={o.r}
                    style={{ fill: "var(--color-ink)" }} />
                  <text x={o.x} y={o.y + o.r * 0.4} textAnchor="middle" fontSize={o.r * 1.05} fontWeight={700} style={{ fill: "var(--color-surface)", pointerEvents: "none" }}>
                    +{o.count}
                  </text>
                </g>
              ))}
            </g>

            {/* Ghost while dragging / pending confirmation */}
            {drag && dragAsset && <g style={{ pointerEvents: "none" }}>{renderPin(dragAsset, drag.x, drag.y, layout.pos.get(dragAsset.id)?.r ?? 6, { ghost: true })}</g>}
            {pending && pendingAsset && pending.posX != null && pending.posY != null && (
              <g style={{ pointerEvents: "none" }}>{renderPin(pendingAsset, pending.posX, pending.posY, layout.pos.get(pendingAsset.id)?.r ?? 6, { ghost: true })}</g>
            )}
          </svg>

          {/* Zoom controls */}
          <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface text-ink shadow-sm">
            <button type="button" onClick={() => pz.zoomBy(1.5)} className="px-2.5 py-1.5 text-base font-bold hover:bg-sunken" aria-label="Zoom in">+</button>
            <button type="button" onClick={() => pz.zoomBy(1 / 1.5)} className="border-t border-line px-2.5 py-1.5 text-base font-bold hover:bg-sunken" aria-label="Zoom out">−</button>
            <button type="button" onClick={() => pz.fit()} className="border-t border-line px-1.5 py-1.5 text-xs font-semibold hover:bg-sunken" aria-label="Fit the whole floor">Fit</button>
          </div>
          <p className="pointer-events-none absolute bottom-2 left-2 hidden rounded bg-surface/90 px-2 py-1 text-xs text-muted sm:block">
            {canMove ? "Drag a pin to another room to move it · scroll or pinch to zoom · drag the plan to pan" : "Select a pin for details · scroll or pinch to zoom · drag the plan to pan"}
          </p>
          <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-surface/90 px-2 py-1 text-xs text-muted sm:hidden">
            {canMove ? "Pinch to zoom · press and hold a pin to move it" : "Pinch to zoom · tap a pin for details"}
          </p>
          {message && (
            <div role="status" className={`absolute left-1/2 top-2 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-[var(--radius-control)] border px-3 py-1.5 text-sm shadow-sm ${message.tone === "ok" ? "border-ok bg-ok-soft text-ok" : "border-danger bg-danger-soft text-danger"}`}>
              <span>{message.text}</span>
              <button type="button" onClick={() => setMessage(null)} className="font-bold" aria-label="Dismiss">×</button>
            </div>
          )}
        </div>

        {/* Side panel / bottom sheet */}
        <aside
          aria-label="Details"
          className={`${selection ? "fixed inset-x-0 bottom-0 z-20 max-h-[55vh] rounded-t-2xl border-t shadow-[0_-8px_24px_-12px] shadow-ink/25" : "rounded-[var(--radius-panel)] border"} overflow-y-auto border-line bg-surface md:static md:z-auto md:max-h-[calc(100vh-20rem)] md:w-[22rem] md:shrink-0 md:rounded-[var(--radius-panel)] md:border md:shadow-none`}
        >
          {selection && (
            <div className="sticky top-0 z-10 flex justify-center bg-surface pt-2 md:hidden">
              <span aria-hidden className="h-1 w-10 rounded-full bg-line" />
            </div>
          )}
          {pending && pendingAsset ? (
            <ConfirmMove
              asset={pendingAsset} from={roomById.get(pending.fromRoomId)} to={roomById.get(pending.toRoomId)} busy={busy}
              deptName={(id) => (id != null ? deptById.get(id)?.name : undefined)}
              onCancel={() => setPending(null)} onConfirm={confirmMove}
            />
          ) : selection?.kind === "asset" && assetById.get(selection.id) ? (
            <AssetCard
              asset={assetById.get(selection.id)!} room={roomById.get(assetById.get(selection.id)!.roomId)}
              dept={(() => { const d = roomById.get(assetById.get(selection.id)!.roomId)?.departmentId; return d != null ? deptById.get(d) : undefined; })()}
              rooms={rooms} onClose={() => select(null)} onRoom={(id) => select({ kind: "room", id })}
              onMove={canMove ? requestMoveFromPanel : undefined}
            />
          ) : selection?.kind === "room" && roomById.get(selection.id) ? (
            <RoomPanel
              room={roomById.get(selection.id)!} dept={(() => { const d = roomById.get(selection.id)!.departmentId; return d != null ? deptById.get(d) : undefined; })()}
              assets={assets.filter((a) => a.roomId === selection.id)} matchIds={filtering ? matchIds : null}
              onAsset={(id) => select({ kind: "asset", id })} onClose={() => select(null)} canAdd={canAdd} canMove={canMove}
              onZoom={() => { const r = roomById.get(selection.id)!; pz.fit(r); }}
            />
          ) : (
            <FloorOverview
              floor={floor} depts={deptSummary} categories={categories} unplaced={props.unplaced}
              activeCategory={filters.category}
              onCategory={(c) => setFilters({ ...filters, category: filters.category === c ? "" : c, type: "" })}
              onDept={deptFit}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

/* ───────────── panel pieces ───────────── */

function MapSelect({ label, all, value, onChange, options }: { label: string; all: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="w-[calc(50%-0.25rem)] sm:w-auto">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className={`w-full max-w-[14rem] rounded-[var(--radius-control)] border bg-surface px-2 py-1.5 text-[14px] focus:border-primary focus:outline-none ${value ? "border-primary text-primary-strong" : "border-line text-ink"}`}>
        <option value="">{all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function PanelHeader({ title, subtitle, onClose }: { title: React.ReactNode; subtitle?: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-snug">{title}</h2>
        {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
      </div>
      {onClose && (
        <button type="button" onClick={onClose} className="-mr-1 rounded px-2 py-0.5 text-lg leading-none text-muted hover:bg-sunken hover:text-ink" aria-label="Close panel">×</button>
      )}
    </div>
  );
}

function PinGlyph({ categoryCode, categoryName, size = 18 }: { categoryCode: string | null; categoryName?: string | null; size?: number }) {
  const s = pinStyle(categoryCode, categoryName);
  return (
    <svg width={size} height={size} viewBox="-10 -10 20 20" aria-hidden className="shrink-0">
      <path d={shapePath(s.shape, 7)} style={{ fill: "var(--color-tag)" }} />
      <text y={s.glyph.length > 1 ? 2.5 : 3.2} textAnchor="middle" fontSize={s.glyph.length > 1 ? 6.5 : 8.5} fontWeight={700} style={{ fill: "var(--color-ink)" }}>{s.glyph}</text>
    </svg>
  );
}

function FloorOverview({ floor, depts, categories, unplaced, activeCategory, onCategory, onDept }: {
  floor: MapFloor; depts: (MapDept & { n: number; rooms: number })[]; categories: { code: string; name: string; n: number }[];
  unplaced: { departmentId: number; name: string; n: number }[]; activeCategory: string;
  onCategory: (c: string) => void; onDept: (id: number) => void;
}) {
  return (
    <div>
      <PanelHeader title={floor.name} subtitle={`${floor.buildingName} · ${floor.facilityName}`} />
      <div className="space-y-5 px-4 py-3 text-sm">
        <section>
          <h3 className="mb-1.5 text-xs font-semibold text-muted">Departments</h3>
          {depts.length === 0 ? <p className="text-muted">No rooms are assigned to departments on this floor yet.</p> : (
            <ul className="space-y-1">
              {depts.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => onDept(d.id)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-sunken">
                    <span aria-hidden className="size-3 shrink-0 rounded-sm" style={{ background: d.tint }} />
                    <span className="min-w-0 flex-1 truncate">{d.name}{d.nameAr && <span lang="ar" dir="rtl" className="ml-2 text-xs text-muted">{d.nameAr}</span>}</span>
                    <span className="shrink-0 text-xs text-muted">{d.rooms} rooms · <b className="text-ink">{d.n}</b></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="mb-1.5 text-xs font-semibold text-muted">Pins by device category</h3>
          {categories.length === 0 ? <p className="text-muted">No equipment placed on this floor yet.</p> : (
            <ul className="grid grid-cols-1 gap-0.5">
              {categories.map((c) => (
                <li key={c.code}>
                  <button type="button" aria-pressed={activeCategory === c.code} onClick={() => onCategory(c.code)}
                    className={`flex w-full items-center gap-2 rounded px-1 py-1 text-left ${activeCategory === c.code ? "bg-primary-soft" : "hover:bg-sunken"}`}>
                    <PinGlyph categoryCode={c.code} categoryName={c.name} />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <b>{c.n}</b>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="mb-1.5 text-xs font-semibold text-muted">Ring colour = status</h3>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {([["ok", "In service"], ["warn", "Under maintenance"], ["danger", "Out of service"], ["neutral", "In stock"]] as const).map(([t, l]) => (
              <li key={t} className="flex items-center gap-1.5">
                <span aria-hidden className="size-3 rounded-full border-2 bg-tag" style={{ borderColor: RING_COLOR[t] }} />{l}
              </li>
            ))}
          </ul>
        </section>
        {unplaced.length > 0 && (
          <section className="rounded-[var(--radius-control)] bg-tag-soft px-3 py-2">
            <h3 className="font-semibold">Not on the plan yet</h3>
            <p className="mt-0.5 text-muted">These departments have equipment without a room. Assign a room to show it here.</p>
            <ul className="mt-1.5 space-y-0.5">
              {unplaced.map((u) => (
                <li key={u.departmentId}>
                  <Link href={`/assets?departmentId=${u.departmentId}&status=IN_STOCK`} className="text-primary hover:underline">{u.name}: {u.n} unplaced</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function RoomPanel({ room, dept, assets, matchIds, onAsset, onClose, onZoom, canAdd, canMove }: {
  room: MapRoom; dept?: MapDept; assets: MapAsset[]; matchIds: Set<number> | null;
  onAsset: (id: number) => void; onClose: () => void; onZoom: () => void; canAdd: boolean; canMove: boolean;
}) {
  const groups = new Map<string, { name: string; categoryCode: string | null; categoryName: string | null; items: MapAsset[] }>();
  for (const a of assets) {
    const g = groups.get(a.typeCode) ?? { name: a.typeName, categoryCode: a.categoryCode ?? a.typeCode, categoryName: a.categoryName, items: [] };
    g.items.push(a);
    groups.set(a.typeCode, g);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].items.length - a[1].items.length || a[1].name.localeCompare(b[1].name));
  return (
    <div>
      <PanelHeader
        title={room.name}
        subtitle={<>
          <span className="font-mono text-xs">{room.code}</span> · {humanize(room.type)}{room.beds ? ` · ${room.beds} bed${room.beds === 1 ? "" : "s"}` : ""}
          {dept && <span className="mt-1 flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm" style={{ background: dept.tint }} />{dept.name}</span>}
        </>}
        onClose={onClose}
      />
      <div className="px-4 py-3 text-sm">
        <div className="mb-3 flex flex-wrap gap-2">
          <button type="button" onClick={onZoom} className="rounded-[var(--radius-control)] border border-line px-2.5 py-1 font-semibold hover:bg-sunken">Zoom to room</button>
          <Link href={`/assets?roomId=${room.id}`} className="rounded-[var(--radius-control)] border border-line px-2.5 py-1 font-semibold hover:bg-sunken">Open in register</Link>
          {canAdd && <Link href={`/assets/new?roomId=${room.id}`} className="rounded-[var(--radius-control)] border border-primary bg-primary px-2.5 py-1 font-semibold text-white hover:bg-primary-strong">Add asset here</Link>}
        </div>
        {assets.length === 0 ? (
          <p className="text-muted">No equipment in this room yet.{canAdd ? " Add an asset here, or drag a pin in from another room." : canMove ? " Drag a pin in from another room to move it here." : ""}</p>
        ) : (
          <>
            <p className="mb-2 text-muted"><b className="text-ink">{assets.length}</b> asset{assets.length === 1 ? "" : "s"} in {groups.size} type{groups.size === 1 ? "" : "s"}</p>
            <ul className="space-y-3">
              {sorted.map(([code, g]) => (
                <li key={code}>
                  <div className="flex items-center gap-2">
                    <PinGlyph categoryCode={g.categoryCode} categoryName={g.categoryName} />
                    <Link href={`/catalogue/${code}`} className="min-w-0 flex-1 truncate font-semibold hover:text-primary">{g.name}</Link>
                    <Badge tone="tag">× {g.items.length}</Badge>
                  </div>
                  <ul className="mt-1 flex flex-wrap gap-1 pl-6">
                    {g.items.map((a) => (
                      <li key={a.id}>
                        <button type="button" onClick={() => onAsset(a.id)}
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-xs hover:border-primary ${matchIds && !matchIds.has(a.id) ? "border-line opacity-50" : matchIds ? "border-tag bg-tag-soft" : "border-line"}`}>
                          <span aria-hidden className="size-2 rounded-full" style={{ background: RING_COLOR[statusRing(a.status)] }} />
                          {shortTag(a.tag)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function AssetCard({ asset, room, dept, rooms, onClose, onRoom, onMove }: {
  asset: MapAsset; room?: MapRoom; dept?: MapDept; rooms: MapRoom[];
  onClose: () => void; onRoom: (id: number) => void; onMove?: (assetId: number, toRoomId: number) => void;
}) {
  const [to, setTo] = useState("");
  const warrantyPast = asset.warrantyEnd && asset.warrantyEnd < todayISO();
  return (
    <div>
      <PanelHeader
        title={<span className="flex items-center gap-2"><PinGlyph categoryCode={asset.categoryCode ?? asset.typeCode} categoryName={asset.categoryName} size={22} /><span className="font-mono">{asset.tag}</span></span>}
        subtitle={asset.typeName}
        onClose={onClose}
      />
      <div className="space-y-4 px-4 py-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge value={asset.status} />
          {asset.criticality && <StatusBadge value={asset.criticality} />}
          <StatusBadge value={asset.condition} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div><dt className="text-xs text-muted">Manufacturer</dt><dd>{asset.manufacturer ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted">Model</dt><dd>{asset.model ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted">Serial</dt><dd className="font-mono text-xs">{asset.serial ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted">Warranty end</dt><dd className={warrantyPast ? "text-danger" : undefined}>{formatDate(asset.warrantyEnd)}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-muted">Location</dt>
            <dd>
              {room ? <button type="button" onClick={() => onRoom(room.id)} className="text-left text-primary hover:underline">{room.name} <span className="font-mono text-xs">({room.code})</span></button> : "—"}
              {dept && <span className="text-muted"> · {dept.name}</span>}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Link href={`/assets/${asset.id}`} className="rounded-[var(--radius-control)] border border-primary bg-primary px-2.5 py-1 font-semibold text-white hover:bg-primary-strong">Open asset</Link>
          <Link href={`/assets/labels?ids=${asset.id}`} className="rounded-[var(--radius-control)] border border-line px-2.5 py-1 font-semibold hover:bg-sunken">Print label</Link>
        </div>
        {onMove && <form
          className="rounded-[var(--radius-control)] border border-line bg-canvas p-3"
          onSubmit={(e) => { e.preventDefault(); if (to) onMove(asset.id, Number(to)); }}
        >
          <label className="block">
            <span className="mb-1 block font-semibold">Move to another room on this floor</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} required
              className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 focus:border-primary focus:outline-none">
              <option value="">Choose a room…</option>
              {rooms.filter((r) => r.id !== asset.roomId).map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
            </select>
          </label>
          <p className="mt-1 text-xs text-muted">Or drag the pin on the plan. For another floor, use Move on the asset page.</p>
          <button type="submit" disabled={!to} className="mt-2 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1 font-semibold hover:bg-sunken disabled:opacity-50">Review move</button>
        </form>}
      </div>
    </div>
  );
}

function ConfirmMove({ asset, from, to, busy, deptName, onCancel, onConfirm }: {
  asset: MapAsset; from?: MapRoom; to?: MapRoom; busy: boolean; deptName: (id: number | null) => string | undefined;
  onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const deptChange = from?.departmentId !== to?.departmentId;
  return (
    <div>
      <PanelHeader title="Confirm move" subtitle={<span className="font-mono">{asset.tag}</span>} onClose={onCancel} />
      <form className="space-y-3 px-4 py-3 text-sm" onSubmit={(e) => { e.preventDefault(); onConfirm(reason.trim()); }}>
        <p>Move <b>{asset.typeName}</b>:</p>
        <ol className="space-y-1.5 rounded-[var(--radius-control)] border border-line p-3">
          <li><span className="text-xs text-muted">From</span><br />{from ? <>{from.name} <span className="font-mono text-xs">{from.code}</span></> : "—"}</li>
          <li><span className="text-xs text-muted">To</span><br /><b>{to ? <>{to.name} <span className="font-mono text-xs">{to.code}</span></> : "—"}</b></li>
        </ol>
        {deptChange && (
          <p className="rounded-[var(--radius-control)] bg-warn-soft px-3 py-2 text-warn">
            This changes the department from {deptName(from?.departmentId ?? null) ?? "none"} to {deptName(to?.departmentId ?? null) ?? "none"}.
          </p>
        )}
        <label className="block">
          <span className="mb-1 block font-semibold">Reason <span className="font-normal text-muted">(optional)</span></span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Bed 4 admission, replacing faulty unit"
            className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 focus:border-primary focus:outline-none" />
        </label>
        <p className="text-xs text-muted">The move is recorded in the asset&apos;s movement history.</p>
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 font-semibold text-white hover:bg-primary-strong disabled:opacity-50">
            {busy ? "Moving…" : "Move asset"}
          </button>
          <button type="button" onClick={onCancel} className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 font-semibold hover:bg-sunken">Cancel</button>
        </div>
      </form>
    </div>
  );
}
