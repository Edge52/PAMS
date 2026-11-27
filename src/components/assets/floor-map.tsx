"use client";
/**
 * Interactive floor map — the showpiece of the asset module.
 * Rooms tinted by department, amber asset pins (shape = device category, ring = status), filters that dim
 * non-matches, room and asset side panel (bottom sheet on phones), drag a pin to move it, zoom/pan for mouse,
 * trackpad and touch, keyboard-accessible pins, deep links that focus and pulse a pin.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from "react";
import { humanize } from "@/lib/status";
import { roomAt, type Rect } from "@/lib/assets/geometry";
import { layoutPins } from "@/lib/assets/pins";
import { fitLabel, pinStyle, RING_COLOR, shapePath, statusRing, type RingTone } from "@/lib/assets/visuals";
import { usePanZoom } from "./use-pan-zoom";
import { matchesFilters, NO_FILTERS, roomLabel, shortTag, subscribeReducedMotion, reducedMotionQuery, CRITS, STATUSES, type Drag, type Filters, type MapAsset, type MapDept, type MapFloor, type MapRoom, type MoveAction, type PendingMove, type Selection } from "./floor-map-types";
import { AssetCard, ConfirmMove, FloorOverview, MapSelect, RoomPanel } from "./floor-map-panels";

export type { MapAsset, MapDept, MapFloor, MapRoom } from "./floor-map-types";

export function FloorMap(props: {
  floor: MapFloor; rooms: MapRoom[]; assets: MapAsset[]; departments: MapDept[];
  unplaced: { departmentId: number; name: string; n: number }[];
  focusRoomId?: number | null; focusAssetId?: number | null; moveAction: MoveAction;
  /** Role may move assets (drag pins, move from the panel). Hiding is courtesy; the action checks again. */
  canMove?: boolean;
  /** Role may register assets ("Add asset here"). */
  canAdd?: boolean;
  /** Other floors of the hospital and how to list their rooms, for moving a device to another floor (wave 12). */
  otherFloors?: { id: number; name: string }[];
  roomsOnFloor?: (floorId: number) => Promise<{ id: number; code: string; name: string }[]>;
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
              otherFloors={canMove ? props.otherFloors : undefined} roomsOnFloor={props.roomsOnFloor}
              onMoveAway={async (assetId, toRoomId, label) => {
                setBusy(true);
                const res = await props.moveAction({ assetId, toRoomId, posX: null, posY: null, reason: "Moved to another floor from the floor map" });
                setBusy(false);
                if (!res.ok) { setMessage({ tone: "danger", text: res.error }); return; }
                setAssets((list) => list.filter((x) => x.id !== assetId)); select(null);
                setMessage({ tone: "ok", text: `${res.summary} (${label})` });
              }}
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

