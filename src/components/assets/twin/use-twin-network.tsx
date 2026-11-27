"use client";
/**
 * The walking network layer, network fixes, access zones and the early-look trauma route (wave 7a).
 * Split out of use-twin-view.tsx in wave 41 without changing the code: useTwinView calls it at the same place, so
 * the hooks run in the same order, and passes what the code reads.
 */
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect } from "react";
import { addRouteFixAction, deleteRouteFixAction, setRoomZoneAction } from "@/app/assets/3d/actions";
import type { TwinScene } from "./scene";
import { type TwinData, type TwinFix, type TwinRoom } from "./types";
import { RouteService, routeSpots } from "./nav/service";
import { type Route } from "./nav/route";


export type Trauma = { busy?: boolean; error?: string; steps?: { from: string; to: string; route: Route }[]; total?: Route } | null;
export type TwinNetworkDeps = {
  data: TwinData;
  fixes: TwinFix[];
  floorById: Map<number, TwinData["floors"][number]>;
  floorId: number | null;
  navOn: boolean;
  navVersion: number;
  ready: boolean;
  routes: RouteService;
  sceneRef: RefObject<TwinScene | null>;
  setFixMode: Dispatch<SetStateAction<{ kind: "OPEN" | "CLOSE"; a?: { x: number; y: number } } | null>>;
  setFixes: Dispatch<SetStateAction<TwinFix[]>>;
  setFloorId: Dispatch<SetStateAction<number | null>>;
  setFlowRoutes: Dispatch<SetStateAction<Map<number, (Route | null)[]>>>;
  setNavInfo: Dispatch<SetStateAction<string | null>>;
  setNavVersion: Dispatch<SetStateAction<number>>;
  setToast: Dispatch<SetStateAction<{ ok?: string; error?: string } | null>>;
  setTrauma: Dispatch<SetStateAction<Trauma>>;
  setUnreachable: Dispatch<SetStateAction<number[]>>;
  setZones: Dispatch<SetStateAction<Map<number, TwinRoom["zone"]>>>;
};

export function useTwinNetwork(c: TwinNetworkDeps) {
  const { data, fixes, floorById, floorId, navOn, navVersion, ready, routes, sceneRef, setFixMode, setFixes, setFloorId, setFlowRoutes, setNavInfo, setNavVersion, setToast, setTrauma, setUnreachable, setZones } = c;
  /* ── Wave 7a: walking network layer and the early-look trauma route ── */
  useEffect(() => {
    const s = sceneRef.current; if (!s || !ready) return;
    if (!navOn || floorId == null) { s.setNavOverlay(null); return; }
    let live = true;
    void routes.network(floorId).then(async (net) => {
      if (!live || !net) return;
      s.setNavOverlay(net);
      const c = await routes.coverage(floorId);
      if (live && c) setNavInfo(`${Math.round(c.share * 100)} % of rooms on the walking network (${c.reached} of ${c.counted}) · ${c.assumed} assumed door${c.assumed === 1 ? "" : "s"} · ${c.unreachable} unreachable`);
      if (live) setUnreachable(net.unreachable);
    });
    return () => { live = false; };
  }, [navOn, floorId, ready, routes, navVersion, sceneRef, setNavInfo, setUnreachable]);
  /** Pick the two ends of a fix on the floor shown, then save it and rebuild the floor's network. */
  function startFix(kind: "OPEN" | "CLOSE") {
    const s = sceneRef.current; if (!s || floorId == null) return;
    setFixMode({ kind });
    const pickEnd = (a?: { x: number; y: number }) => s.pickPoint((p) => {
      if (!p) { setFixMode(null); return; }
      if (!a) { setFixMode({ kind, a: { x: p.x, y: p.y } }); pickEnd({ x: p.x, y: p.y }); return; }
      setFixMode(null);
      void saveFix(kind, p.floorId, a, { x: p.x, y: p.y });
    });
    pickEnd();
  }
  async function saveFix(kind: "OPEN" | "CLOSE", fl: number, a: { x: number; y: number }, b: { x: number; y: number }) {
    const fd = new FormData();
    fd.set("floorId", String(fl)); fd.set("kind", kind); fd.set("x1", String(a.x)); fd.set("y1", String(a.y)); fd.set("x2", String(b.x)); fd.set("y2", String(b.y)); fd.set("note", "");
    const res = await addRouteFixAction(null, fd);
    if (res?.fix) { const next = [...fixes, res.fix]; setFixes(next); routes.setFixes(fl, next.filter((f) => f.floorId === fl)); setFlowRoutes(new Map()); setNavVersion((v) => v + 1); }
    setToast(res ? { ok: res.ok, error: res.error } : null);
  }
  async function removeFix(f: TwinFix) {
    const fd = new FormData(); fd.set("fixId", String(f.id));
    const res = await deleteRouteFixAction(null, fd);
    if (res?.deletedId) { const next = fixes.filter((x) => x.id !== f.id); setFixes(next); routes.setFixes(f.floorId, next.filter((x) => x.floorId === f.floorId)); setFlowRoutes(new Map()); setNavVersion((v) => v + 1); }
    setToast(res ? { ok: res.ok, error: res.error } : null);
  }
  async function setZone(roomId: number, zone: string) {
    const fd = new FormData(); fd.set("roomId", String(roomId)); fd.set("zone", zone);
    const res = await setRoomZoneAction(null, fd);
    if (res?.roomId) { setZones((m) => new Map(m).set(res.roomId!, res.zone ?? null)); routes.setZone(res.roomId, res.zone ?? null); setFlowRoutes(new Map()); setNavVersion((v) => v + 1); }
    setToast(res ? { ok: res.ok, error: res.error } : null);
  }
  async function showTrauma() {
    const s = sceneRef.current; if (!s) return;
    setTrauma({ busy: true });
    const level = (id: number) => floorById.get(id)?.level ?? 0;
    const find = (re: RegExp, pref?: (r: (typeof data.rooms)[number]) => boolean) =>
      [...data.rooms].filter((r) => re.test(r.name)).sort((a, b) => Number(pref ? !pref(a) : 0) - Number(pref ? !pref(b) : 0) || level(a.floorId) - level(b.floorId))[0];
    const amb = find(/AMBULANCE/i) ?? find(/EMERGENCY|\bER\b/i);
    const resus = find(/RESUS|TRAUMA/i, (r) => r.floorId === amb?.floorId);
    const ct = find(/^CT\b/i, (r) => r.floorId === amb?.floorId);
    const icu = find(/^(ALL )?ICU\b/i, (r) => level(r.floorId) > 0);
    const stops = [amb, resus, ct, icu];
    if (stops.some((r) => !r)) { setTrauma({ error: "This hospital's drawings don't have an ambulance entrance, resus room, CT room and ICU to route between." }); return; }
    const res = await routes.through(stops.map((r) => r!.id), "bed");
    if (!res) { setTrauma({ error: "No bed route found: check that a bed lift serves the ICU floor (Facilities › Lifts)." }); return; }
    setTrauma({ steps: res.legs.map((rt, i) => ({ from: stops[i]!.name, to: stops[i + 1]!.name, route: rt })), total: res.route });
    if (floorId != null) { setFloorId(null); s.isolateFloor(null, false); }
    s.showRoute(routeSpots(res.route)); s.frameRoute();
  }
  function clearTrauma() { setTrauma(null); sceneRef.current?.showRoute(null); }
  return { startFix, saveFix, removeFix, setZone, showTrauma, clearTrauma };
}
