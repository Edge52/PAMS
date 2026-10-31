"use client";
/** HUD building blocks for the 3D view: width-driven layout mode, remembered panel state and the collapsible panel. */
import { useCallback, useId, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { hudMode, isPanelOpen, parsePrefs, prefKey, type HudMode, type PanelId, type PanelPrefs } from "./hud-state";

/* ── layout mode from the element's own width ── */

export function useHudMode(ref: RefObject<HTMLElement | null>): HudMode {
  const subscribe = useCallback((cb: () => void) => {
    const el = ref.current;
    window.addEventListener("resize", cb);
    const ro = el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(cb) : null;
    if (el) ro?.observe(el);
    return () => { window.removeEventListener("resize", cb); ro?.disconnect(); };
  }, [ref]);
  return useSyncExternalStore(
    subscribe,
    () => hudMode(ref.current?.clientWidth || window.innerWidth),
    () => "wide",
  );
}

/* ── panel open/closed, remembered in localStorage (per browser; absent storage just means defaults) ── */

const STORAGE_KEY = "hpams.twin.panels";
let cache: PanelPrefs | null = null;
const listeners = new Set<() => void>();

function readPrefs(): PanelPrefs {
  if (cache) return cache;
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(STORAGE_KEY); } catch { /* private mode, blocked storage */ }
  cache = parsePrefs(raw);
  return cache;
}
const EMPTY: PanelPrefs = {};

function writePref(key: string, open: boolean) {
  cache = { ...readPrefs(), [key]: open };
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); } catch { /* keep it for this visit only */ }
  for (const l of listeners) l();
}

export function usePanelPrefs(mode: HudMode) {
  const prefs = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    readPrefs,
    () => EMPTY,
  );
  const isOpen = (id: PanelId) => isPanelOpen(prefs, id, mode);
  const toggle = (id: PanelId) => writePref(prefKey(id, mode), !isOpen(id));
  return { isOpen, toggle };
}

/* ── collapsible HUD card ── */

export function HudPanel({ title, summary, open, onToggle, children, className = "", bodyClassName = "" }: {
  title: string; summary?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode;
  className?: string; bodyClassName?: string;
}) {
  const bodyId = useId();
  return (
    <section className={`twin-card pointer-events-auto p-0! ${className}`}>
      <h2 className="m-0">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}
          className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left hover:bg-[#0c2a40]">
          <span aria-hidden className={`inline-block text-[10px] text-[#5fd6ff] transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}>▶</span>
          <span className="text-[12px] font-semibold tracking-[0.06em] text-[#5fd6ff]">{title}</span>
          {summary != null && <span className="ml-auto min-w-0 truncate text-xs text-[#8fb6cc]">{summary}</span>}
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className={`px-3 pb-3 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
