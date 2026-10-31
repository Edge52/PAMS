"use client";
/**
 * Lightweight zoom/pan for an SVG plan using viewBox maths only (no libraries).
 * - Mouse wheel: zoom at the cursor. Trackpad: two-finger scroll pans, pinch (ctrl+wheel) zooms.
 * - Drag on the background pans (mouse, pen, one finger). Two fingers pinch-zoom and pan.
 * - Keyboard on the focused SVG: arrows pan, + / − zoom, 0 fits.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { clampViewBox, fitRect, panBy, screenScale, zoomAt, type Point, type Rect, type ViewBox } from "@/lib/assets/geometry";

type Pointer = { x: number; y: number };

/** `content`: where the drawing actually is (e.g. the rooms' extent on a large CAD sheet); "Fit" frames it. */
export function usePanZoom(plan: { w: number; h: number }, opts: { initialTarget?: Rect | null; maxZoom?: number; content?: Rect | null } = {}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [vb, setVbState] = useState<ViewBox | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const vbRef = useRef<ViewBox | null>(null);
  const sizeRef = useRef(size);
  const pointers = useRef(new Map<number, Pointer>());
  const moved = useRef(0);
  const initialTarget = useRef(opts.initialTarget ?? null);
  const limits = { minW: plan.w / (opts.maxZoom ?? 14), maxW: plan.w * 2.5 };
  const limitsRef = useRef(limits);
  const planRef = useRef(plan);
  const contentRef = useRef(opts.content ?? null);
  useEffect(() => {
    planRef.current = plan;
    contentRef.current = opts.content ?? null;
    limitsRef.current = limits;
  });

  const setVb = useCallback((next: ViewBox) => {
    const c = clampViewBox(next, planRef.current);
    vbRef.current = c;
    setVbState(c);
  }, []);

  const aspect = () => (sizeRef.current.width && sizeRef.current.height ? sizeRef.current.width / sizeRef.current.height : planRef.current.w / planRef.current.h);

  const fit = useCallback((target?: Rect | null, pad?: number) => {
    const p = planRef.current;
    const whole = contentRef.current ?? { x: 0, y: 0, w: p.w, h: p.h };
    setVb(fitRect(target ?? whole, aspect(), target ? pad ?? 0.35 : contentRef.current ? 0.04 : 0.02));
  }, [setVb]);

  // Track container size; first measurement fits the plan (or the deep-linked target).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      const prev = sizeRef.current;
      sizeRef.current = { width, height };
      setSize({ width, height });
      const p = planRef.current;
      if (!vbRef.current) {
        const t = initialTarget.current;
        const whole = contentRef.current ?? { x: 0, y: 0, w: p.w, h: p.h };
        setVb(fitRect(t ?? whole, width / height, t ? 0.6 : contentRef.current ? 0.04 : 0.02));
      } else if (prev.width && prev.height && (Math.abs(prev.width / prev.height - width / height) > 0.01)) {
        // Keep the centre and scale when the container changes shape.
        const v = vbRef.current;
        const k = screenScale(v, prev);
        const w = width / k, h = height / k;
        setVb({ x: v.x + v.w / 2 - w / 2, y: v.y + v.h / 2 - h / 2, w, h });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [setVb]);

  const toPlan = useCallback((clientX: number, clientY: number): Point => {
    const el = svgRef.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const scaleNow = () => (vbRef.current ? screenScale(vbRef.current, sizeRef.current) : 1);

  const zoomBy = useCallback((factor: number, at?: Point) => {
    const v = vbRef.current;
    if (!v) return;
    setVb(zoomAt(v, factor, at ?? { x: v.x + v.w / 2, y: v.y + v.h / 2 }, limitsRef.current));
  }, [setVb]);

  // Wheel must be non-passive to prevent page scroll.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const v = vbRef.current;
      if (!v) return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * px, dy = e.deltaY * px;
      const isPinch = e.ctrlKey || e.metaKey;
      const looksLikeTrackpad = !isPinch && e.deltaMode === 0 && (Math.abs(e.deltaX) > 0 || (Math.abs(dy) < 40 && !Number.isInteger(e.deltaY)));
      if (looksLikeTrackpad) {
        const k = scaleNow();
        setVb(panBy(v, -dx / k, -dy / k));
        return;
      }
      const factor = Math.exp(-dy * (isPinch ? 0.01 : 0.0025));
      setVb(zoomAt(v, factor, toPlan(e.clientX, e.clientY), limitsRef.current));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setVb, toPlan]);

  /** Start tracking a pointer for panning (background drag), optionally adopted mid-gesture from a pin. */
  const startPointer = useCallback((pointerId: number, x: number, y: number) => {
    pointers.current.set(pointerId, { x, y });
    try { svgRef.current?.setPointerCapture(pointerId); } catch { /* pointer already released */ }
  }, []);

  const onPointerDown = useCallback((e: RPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pointers.current.size === 0) moved.current = 0;
    startPointer(e.pointerId, e.clientX, e.clientY);
  }, [startPointer]);

  const onPointerMove = useCallback((e: RPointerEvent<SVGSVGElement>): boolean => {
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    const v = vbRef.current;
    if (!prev || !v) return false;
    const k = scaleNow();
    if (ps.size === 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      moved.current += Math.abs(dx) + Math.abs(dy);
      ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (moved.current > 3) setVb(panBy(v, dx / k, dy / k));
      return true;
    }
    if (ps.size >= 2) {
      const [a, b] = [...ps.entries()].filter(([id]) => id !== e.pointerId).slice(0, 1).map(([, p]) => p).concat([prev]);
      const oldMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const oldDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const now = { x: e.clientX, y: e.clientY };
      const newMid = { x: (a.x + now.x) / 2, y: (a.y + now.y) / 2 };
      const newDist = Math.hypot(a.x - now.x, a.y - now.y) || 1;
      ps.set(e.pointerId, now);
      moved.current += 10;
      const z = zoomAt(v, newDist / oldDist, toPlan(oldMid.x, oldMid.y), limitsRef.current);
      const k2 = screenScale(z, sizeRef.current);
      setVb(panBy(z, (newMid.x - oldMid.x) / k2, (newMid.y - oldMid.y) / k2));
      return true;
    }
    return false;
  }, [setVb, toPlan]);

  /** Returns true when the gesture was a tap (no meaningful movement). */
  const onPointerUp = useCallback((e: RPointerEvent<SVGSVGElement>): boolean => {
    const had = pointers.current.delete(e.pointerId);
    return had && pointers.current.size === 0 && moved.current <= 6;
  }, []);

  const onKeyDown = useCallback((e: KeyboardEvent<SVGSVGElement | HTMLDivElement>) => {
    const v = vbRef.current;
    if (!v || e.target !== e.currentTarget) return;
    const step = v.w * 0.1;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => setVb(panBy(v, step, 0)), ArrowRight: () => setVb(panBy(v, -step, 0)),
      ArrowUp: () => setVb(panBy(v, 0, step)), ArrowDown: () => setVb(panBy(v, 0, -step)),
      "+": () => zoomBy(1.4), "=": () => zoomBy(1.4), "-": () => zoomBy(1 / 1.4), "0": () => fit(),
    };
    const fn = keys[e.key];
    if (fn) { e.preventDefault(); fn(); }
  }, [fit, setVb, zoomBy]);

  const scale = vb ? screenScale(vb, size) : 1;
  return {
    svgRef, vb: vb ?? { x: 0, y: 0, w: plan.w, h: plan.h }, ready: vb !== null, scale, size,
    setVb, fit, zoomBy, toPlan, startPointer, onPointerDown, onPointerMove, onPointerUp, onKeyDown,
    /** True while two or more fingers are down (pinch). */
    isMultiTouch: () => pointers.current.size > 1,
    cancelPointer: (id: number) => { pointers.current.delete(id); },
  };
}
