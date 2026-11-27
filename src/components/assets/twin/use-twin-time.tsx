"use client";
/**
 * The time slider: load the history and play it on the model (wave 7f).
 * Split out of use-twin-view.tsx in wave 41 without changing the code: useTwinView calls it at the same place, so
 * the hooks run in the same order, and passes what the code reads.
 */
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useMemo } from "react";
import type { TwinScene } from "./scene";
import { type TwinData } from "./types";
import { type StatusRow } from "@/lib/assets/status-history";
import { EVENT_COLORS, eventsAt, type TimeEvent } from "./timeline";


export type History = { since: number; until: number; days: number; events: TimeEvent[]; status: StatusRow[]; snapshotsSince: string | null; statusFrom: string | null } | null;
export type TwinTimeDeps = {
  data: TwinData;
  history: History;
  ready: boolean;
  sceneRef: RefObject<TwinScene | null>;
  setHistory: Dispatch<SetStateAction<History>>;
  setHistoryBusy: Dispatch<SetStateAction<boolean>>;
  setTimeAt: Dispatch<SetStateAction<number>>;
  setTimePlaying: Dispatch<SetStateAction<boolean>>;
  setToast: Dispatch<SetStateAction<{ ok?: string; error?: string } | null>>;
  timeAt: number;
  timeKinds: Set<TimeEvent["kind"]>;
  timePlaying: boolean;
  timeWindow: number;
};

export function useTwinTime(c: TwinTimeDeps) {
  const { data, history, ready, sceneRef, setHistory, setHistoryBusy, setTimeAt, setTimePlaying, setToast, timeAt, timeKinds, timePlaying, timeWindow } = c;
  /* ── Wave 7f: time slider ── */
  async function loadHistory(days: number) {
    setHistoryBusy(true);
    try {
      const res = await fetch(`/assets/3d/history?facilityId=${data.facility.id}&days=${days}`, { cache: "no-store" });
      const j = await res.json() as { since: string; until: string; events: TimeEvent[]; status?: [number, string, string][]; snapshotsSince?: string | null; statusFrom?: string | null; error?: string };
      if (!res.ok) throw new Error(j.error ?? String(res.status));
      const until = Date.parse(j.until);
      setHistory({ since: Date.parse(j.since), until, days, events: j.events, status: (j.status ?? []).map(([assetId, day, status]) => ({ assetId, day, status })), snapshotsSince: j.snapshotsSince ?? null, statusFrom: j.statusFrom ?? null }); setTimeAt(until);
    } catch (e) { setToast({ error: `The history couldn't be loaded (${(e as Error).message}).` }); }
    setHistoryBusy(false);
  }
  const shownEvents = useMemo(() => (history ? eventsAt(history.events, timeAt, timeWindow * 86400_000, timeKinds) : []), [history, timeAt, timeWindow, timeKinds]);
  useEffect(() => {
    const s = sceneRef.current; if (!s || !ready) return;
    if (!history) { s.setEvents([]); return; }
    s.setEvents(shownEvents.flatMap((e) => {
      const sp = s.spotOfAsset(e.assetId) ?? (e.roomId ? s.spotOfRoom(e.roomId) : null);
      return sp ? [{ floorId: sp.floorId, x: sp.x, z: sp.z, color: EVENT_COLORS[e.kind], strength: e.strength }] : [];
    }));
  }, [shownEvents, history, ready, sceneRef]);
  useEffect(() => {
    if (!timePlaying || !history) return;
    // A day of history every half second.
    const t = setInterval(() => setTimeAt((x) => { const n = x + 86400_000 / 4; if (n >= history.until) { setTimePlaying(false); return history.until; } return n; }), 125);
    return () => clearInterval(t);
  }, [timePlaying, history, setTimeAt, setTimePlaying]);
  return { loadHistory, shownEvents };
}
