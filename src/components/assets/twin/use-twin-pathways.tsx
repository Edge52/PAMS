"use client";
/**
 * Patient pathways in 3D: routes, colours, playback, heat, lifts, bed clearance and clean/dirty conflicts (wave 7c).
 * Split out of use-twin-view.tsx in wave 41 without changing the code: useTwinView calls it at the same place, so
 * the hooks run in the same order, and passes what the code reads.
 */
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useMemo, useRef } from "react";
import { usePanelPrefs } from "./hud";
import type { TwinScene } from "./scene";
import { type TwinData } from "./types";
import { RouteService, routeSpots } from "./nav/service";
import { type Route } from "./nav/route";
import { CLEAR, legClearance } from "./nav/clearance";
import { capPauses, FLOW_COLORS, heatLegsOf, journeyOf, liftTripsOf, samplePath, stepRoom, trackOf, tubeRadius, visits, type TwinFlow } from "./pathways";
import { cleanDirtyConflicts, corridorHeat, liftLoad } from "@/lib/flows/analysis";
import type { PathDraw } from "./scene";

import type { History } from "./use-twin-time";

export type BedIssues = { floorId: number; x: number; z: number; severity: "high" | "medium"; text: string; leg: string }[] | null;
export type TwinPathwaysDeps = {
  bedIssues: BedIssues;
  bedOn: boolean;
  cardFlow: number | null;
  cdOn: boolean;
  data: TwinData;
  floorById: Map<number, TwinData["floors"][number]>;
  floorId: number | null;
  flowRoutes: Map<number, (Route | null)[]>;
  flowSel: number[];
  flows: TwinFlow[];
  heatOn: boolean;
  history: History;
  panels: ReturnType<typeof usePanelPrefs>;
  playSpeed: number;
  playing: boolean;
  ready: boolean;
  routes: RouteService;
  sceneRef: RefObject<TwinScene | null>;
  setBedIssues: Dispatch<SetStateAction<BedIssues>>;
  setCardFlow: Dispatch<SetStateAction<number | null>>;
  setFloorId: Dispatch<SetStateAction<number | null>>;
  setFlowBusy: Dispatch<SetStateAction<boolean>>;
  setFlowRoutes: Dispatch<SetStateAction<Map<number, (Route | null)[]>>>;
  setFlowSel: Dispatch<SetStateAction<number[]>>;
  setPlaying: Dispatch<SetStateAction<boolean>>;
};

export function useTwinPathways(c: TwinPathwaysDeps) {
  const { bedIssues, bedOn, cardFlow, cdOn, data, floorById, floorId, flowRoutes, flowSel, flows, heatOn, history, panels, playSpeed, playing, ready, routes, sceneRef, setBedIssues, setCardFlow, setFloorId, setFlowBusy, setFlowRoutes, setFlowSel, setPlaying } = c;
  /* ── Wave 7c: pathways in 3D ── */
  const flowColor = (id: number) => FLOW_COLORS[Math.max(0, flows.findIndex((f) => f.id === id)) % FLOW_COLORS.length];
  // A link from a pathway page (…&flow=<id>) shows that pathway once the model is ready.
  const flowParamDone = useRef(false);
  useEffect(() => {
    if (!ready || flowParamDone.current) return;
    flowParamDone.current = true;
    const ids = (new URLSearchParams(window.location.search).get("flow") ?? "").split(",").map(Number).filter((id) => flows.some((f) => f.id === id));
    if (!ids.length) return;
    const t = setTimeout(() => { setFlowSel(ids); setCardFlow(ids[0]); if (!panels.isOpen("pathways")) panels.toggle("pathways"); }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the model is ready
  }, [ready]);
  // Route every arrow of the chosen pathways (once per pathway), then draw them.
  useEffect(() => {
    if (!ready) return;
    const missing = flowSel.filter((id) => !flowRoutes.has(id));
    if (!missing.length) return;
    let live = true;
    const t = setTimeout(() => setFlowBusy(true), 0);
    void (async () => {
      const add = new Map<number, (Route | null)[]>();
      for (const id of missing) {
        const f = flows.find((x) => x.id === id); if (!f) continue;
        const roomOf = new Map(f.steps.map((st) => [st.key, stepRoom(st, data.rooms)]));
        add.set(id, await Promise.all(f.links.map(async (l) => {
          const a = roomOf.get(l.fromKey), b = roomOf.get(l.toKey);
          if (!a || !b) return null;
          const [pa, pb] = await Promise.all([routes.roomPlace(a.id), routes.roomPlace(b.id)]);
          // Lift waits at the pathway's busiest hour.
          const prof = f.arrivalProfile?.length === 24 ? f.arrivalProfile : null;
          return pa && pb ? routes.route(pa, pb, journeyOf(l.transport), prof ? prof.indexOf(Math.max(...prof)) : null) : null;
        })));
      }
      if (!live) return;
      setFlowRoutes((m) => new Map([...m, ...add]));
      setFlowBusy(false);
    })();
    return () => { live = false; clearTimeout(t); };
  }, [flowSel, flowRoutes, flows, ready, routes, data.rooms, setFlowBusy, setFlowRoutes]);
  // eslint-disable-next-line react-hooks/refs -- as before the split (wave 41): the scene is read when the routes change
  const flowDraws = useMemo((): PathDraw[] => flowSel.flatMap((id) => {
    const f = flows.find((x) => x.id === id), rs = flowRoutes.get(id);
    if (!f || !rs) return [];
    const vis = visits(f.steps, f.links);
    const s = sceneRef.current;
    const markers = f.steps.map((st, i) => ({ st, i, room: stepRoom(st, data.rooms) })).filter((m) => m.room)
      .map(({ st, i, room }) => { const sp = s?.spotOfRoom(room!.id); return sp ? { floorId: sp.floorId, x: sp.x, z: sp.z, number: i + 1, text: st.label } : null; })
      .filter((m): m is NonNullable<typeof m> => m != null);
    return [{
      color: flowColor(id), markers,
      tubes: f.links.map((_, i) => rs[i] ? { spots: routeSpots(rs[i]!), radius: tubeRadius(vis.links[i] ?? 0), dashed: rs[i]!.estimated } : null).filter((t): t is NonNullable<typeof t> => t != null),
    }];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flowColor depends on flows only
  }), [flowSel, flowRoutes, flows, data.rooms]);
  useEffect(() => {
    const s = sceneRef.current; if (!s || !ready) return;
    s.showPathways(flowDraws.length ? flowDraws : null);
  }, [flowDraws, ready, sceneRef]);
  // Play: patients sampled by the shares, moving at the chosen speed; long stays squeezed to a few seconds.
  const playSpeedRef = useRef(playSpeed);
  useEffect(() => { playSpeedRef.current = playSpeed; sceneRef.current?.setPlaySpeed(playSpeed); }, [playSpeed, sceneRef]);
  useEffect(() => {
    const s = sceneRef.current; if (!s || !ready) return;
    const sources = playing ? flowSel.flatMap((id) => {
      const f = flows.find((x) => x.id === id), rs = flowRoutes.get(id);
      return f && rs ? [{ color: flowColor(id), next: () => capPauses(trackOf(samplePath(f.steps, f.links), f.links, f.steps, rs), 6 * playSpeedRef.current) }] : [];
    }) : [];
    s.setPlay(sources.length ? sources : null, playSpeedRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flowColor depends on flows only
  }, [playing, flowSel, flowRoutes, flows, ready]);
  // Wave 7d: load of the shown pathways — lift trips and corridor traffic (patients a day per 2 m of corridor).
  const shownWithRoutes = useMemo(() => flowSel.map((id) => ({ f: flows.find((x) => x.id === id), rs: flowRoutes.get(id) })).filter((x): x is { f: TwinFlow; rs: (Route | null)[] } => !!x.f && !!x.rs), [flowSel, flows, flowRoutes]);
  const liftRows = useMemo(() => liftLoad(
    shownWithRoutes.flatMap(({ f, rs }) => liftTripsOf(f, rs, (id) => floorById.get(id)?.level ?? 0)),
    (name) => data.lifts.find((l) => l.name === name)?.cars ?? 1,
  ), [shownWithRoutes, floorById, data.lifts]);
  useEffect(() => {
    if (!bedOn || !ready) return;
    let live = true;
    void (async () => {
      const out: NonNullable<typeof bedIssues> = [];
      for (const { f, rs } of shownWithRoutes) {
        for (const [i, l] of f.links.entries()) {
          if (l.transport !== "BED" && l.transport !== "TROLLEY") continue;
          const rt = rs[i]; if (!rt) continue;
          const leg = `${f.name}: ${f.steps.find((x) => x.key === l.fromKey)?.label ?? ""} → ${f.steps.find((x) => x.key === l.toKey)?.label ?? ""}`;
          for (const lg of rt.legs) {
            if (lg.kind !== "walk" || lg.estimated) continue;
            const net = await routes.network(lg.floorId); if (!net) continue;
            const c = legClearance(net, lg.points as [number, number][]);
            for (const p of c.pinches) out.push({ floorId: lg.floorId, x: p.x, z: p.z, severity: p.need === "bed" ? "high" : "medium", leg,
              text: p.need === "bed" ? `${p.width.toFixed(1)} m clear: too narrow for a bed (${CLEAR.bed} m)` : `${p.width.toFixed(1)} m for ${Math.round(p.length)} m: a bed can't pass someone (${CLEAR.passing} m)` });
            for (const t of c.turns) if (!t.fits) out.push({ floorId: lg.floorId, x: t.x, z: t.z, severity: "high", leg, text: `a bed can't turn this corner (${t.a.toFixed(1)} m into ${t.b.toFixed(1)} m)` });
          }
        }
      }
      if (live) setBedIssues(out);
    })();
    return () => { live = false; };
  }, [bedOn, ready, shownWithRoutes, routes, setBedIssues]);
  useEffect(() => { if (ready) sceneRef.current?.setMarkers("bed", bedOn ? bedIssues : null); }, [bedOn, bedIssues, ready, sceneRef]);
  const heat = useMemo(() => (heatOn ? [...corridorHeat(shownWithRoutes.flatMap(({ f, rs }) => heatLegsOf(f, rs))).values()] : null), [heatOn, shownWithRoutes]);
  useEffect(() => { if (ready) sceneRef.current?.setHeat(heat); }, [heat, ready, sceneRef]);
  const cdFlows = useMemo(() => flows.filter((f) => f.kind === "SUPPLIES" || f.kind === "WASTE"), [flows]);
  const cd = useMemo(() => {
    if (!cdOn) return null;
    return cleanDirtyConflicts(shownWithRoutes.filter(({ f }) => f.kind === "SUPPLIES" || f.kind === "WASTE").map(({ f, rs }) => ({
      name: f.name, kind: f.kind ?? "PATIENT", profile: f.arrivalProfile ?? null,
      legs: rs.flatMap((r) => (r?.legs ?? []).filter((l) => l.kind === "walk").map((l) => ({ floorId: l.floorId, points: l.points as [number, number][] }))),
      lifts: [...new Set(rs.flatMap((r) => (r?.legs ?? []).filter((l) => l.kind !== "walk" && l.via).map((l) => l.via!)))],
    })));
  }, [cdOn, shownWithRoutes]);
  useEffect(() => {
    const s = sceneRef.current; if (!s || !ready || history) return;
    s.setEvents(cd ? cd.shared.map((c) => ({ floorId: c.floorId, x: c.x, z: c.z, color: "#ff3b4e", strength: 1 })) : []);
  }, [cd, ready, history, sceneRef]);
  function toggleFlow(id: number) {
    const on = !flowSel.includes(id);
    setFlowSel((sel) => (on ? [...sel, id] : sel.filter((x) => x !== id)));
    if (on) {
      setCardFlow(id);
      // Pathways cross floors: show the whole building.
      if (floorId != null) { setFloorId(null); sceneRef.current?.isolateFloor(null, false); }
    } else if (cardFlow === id) setCardFlow(flowSel.find((x) => x !== id) ?? null);
    if (!on && flowSel.length === 1) setPlaying(false);
  }
  function frameFlow(id: number) {
    const rs = flowRoutes.get(id); const s = sceneRef.current;
    if (rs && s) s.frameSpots(rs.flatMap((r) => (r ? routeSpots(r) : [])));
  }
  return { flowColor, flowParamDone, flowDraws, playSpeedRef, shownWithRoutes, liftRows, heat, cdFlows, cd, toggleFlow, frameFlow };
}
