"use client";
/** HUD building blocks for the 3D view: width-driven layout mode, remembered panel state and the collapsible panel. */
import { useCallback, useId, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { hudMode, isPanelOpen, parsePrefs, type HudMode, type PanelId, type PanelPrefs, togglePanel } from "./hud-state";

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

const STORAGE_KEY = "hpams.twin.panels.v2"; // v2 (wave 22): one panel open per side
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

function writePrefs(next: PanelPrefs) {
  cache = next;
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
  const toggle = (id: PanelId) => writePrefs(togglePanel(readPrefs(), id, mode));
  return { isOpen, toggle };
}

/* ── collapsible HUD card ── */

/* ── Tool rail (wave 22b): a narrow strip of tool names; the one open tool shows beside it ── */

export type RailTool = { id: PanelId; label: string; title: string; summary?: ReactNode; body: ReactNode; bodyClassName?: string; forceOpen?: boolean };

/**
 * One side of the HUD: a rail of tool buttons with the open tool's panel next to it. One tool is open at a time, so
 * the model keeps the middle of the screen. `children` render under the open panel (the selection card on the right).
 */
export function HudRail({ side, tools, isOpen, onToggle, panelWidth, className = "", children }: {
  side: "left" | "right"; tools: RailTool[]; isOpen: (id: PanelId) => boolean; onToggle: (id: PanelId) => void;
  panelWidth: string; className?: string; children?: ReactNode;
}) {
  const uid = useId();
  const open = tools.find((t) => t.forceOpen || isOpen(t.id)) ?? null;
  const rail = (
    <nav aria-label={side === "left" ? "Model tools" : "Find and review tools"} className="pointer-events-auto flex w-[5.75rem] shrink-0 flex-col gap-1 self-start overflow-y-auto rounded-[12px] border border-[#123a55] bg-[#04121fd9] p-1 backdrop-blur" style={{ maxHeight: "100%" }}>
      {tools.map((t) => {
        const on = open?.id === t.id;
        return (
          <button key={t.id} type="button" aria-expanded={on} aria-controls={`${uid}-panel`} onClick={() => onToggle(t.id)} title={t.title}
            className={`flex min-h-11 flex-col items-start justify-center rounded-[9px] px-2 py-1 text-left ${on ? "bg-[#0c2a40] shadow-[inset_2px_0_0_#2fd3ff]" : "hover:bg-[#0c2a40]"}`}>
            <span className={`text-[11.5px] font-semibold ${on ? "text-white" : "text-[#5fd6ff]"}`}>{t.label}</span>
            {t.summary != null && <span className="w-full truncate text-[10px] leading-tight text-[#8fb6cc]">{t.summary}</span>}
          </button>
        );
      })}
    </nav>
  );
  const panel = (
    <div className="pointer-events-none flex min-h-0 min-w-0 flex-col gap-2" style={{ width: panelWidth }}>
      {open && (
        <section id={`${uid}-panel`} aria-label={open.title} className="twin-card pointer-events-auto flex min-h-0 shrink flex-col p-0!">
          <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
            <h2 className="m-0 text-[12px] font-semibold tracking-[0.06em] text-[#5fd6ff]">{open.title}</h2>
            {!open.forceOpen && <button type="button" onClick={() => onToggle(open.id)} className="min-h-6 rounded px-1.5 text-xs text-[#8fb6cc] hover:text-white" aria-label={`Close ${open.title}`}>Close</button>}
          </div>
          <div className={`min-h-0 overflow-y-auto px-3 pb-3 pt-2 ${open.bodyClassName ?? ""}`}>{open.body}</div>
        </section>
      )}
      {children}
    </div>
  );
  return (
    <div className={`pointer-events-none absolute flex gap-2 ${className}`}>
      {side === "left" ? <>{rail}{panel}</> : <>{panel}{rail}</>}
    </div>
  );
}
