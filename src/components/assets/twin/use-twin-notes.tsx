"use client";
/**
 * Notes in the model, live fault alerts, drag to move and the route/note links (wave 7e).
 * Split out of use-twin-view.tsx in wave 41 without changing the code: useTwinView calls it at the same place, so
 * the hooks run in the same order, and passes what the code reads.
 */
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { addNotePhotoAction, addNoteAction, deleteNoteAction, setNoteStatusAction } from "@/app/assets/3d/actions";
import { usePanelPrefs } from "./hud";
import type { DropResult, PickResult, TwinScene } from "./scene";
import { type TwinAsset, type TwinData, type TwinRoom } from "./types";
import { interiorPoint, type Pt } from "./geometry";
import { type LiveMetrics } from "./layers";
import { RouteService, routeSpots } from "./nav/service";
import { formatDuration } from "./nav/route";
import type { TwinNote } from "@/lib/assets/twin-notes";
import { useConfirm } from "./use-confirm";


export type Composer = { floorId: number; x: number; y: number; roomId: number | null; assetId: number | null; where: string } | null;
export type TwinNotesDeps = {
  alertsRef: RefObject<(prev: Map<number, LiveMetrics>, next: Map<number, LiveMetrics>) => void>;
  assetById: Map<number, TwinAsset>;
  composer: Composer;
  confirmBox: ReturnType<typeof useConfirm>;
  data: TwinData;
  dragRef: RefObject<{ canDrag: (id: number) => boolean; start: (id: number) => void }>;
  dropping: { asset: TwinAsset; at: DropResult | null } | null;
  floorById: Map<number, TwinData["floors"][number]>;
  floorId: number | null;
  focus: (p: PickResult) => void;
  notes: TwinNote[];
  panels: ReturnType<typeof usePanelPrefs>;
  pickingSpot: boolean;
  ready: boolean;
  roomById: Map<number, TwinRoom>;
  routes: RouteService;
  sceneRef: RefObject<TwinScene | null>;
  selAsset: TwinAsset | undefined;
  selRoom: TwinRoom | undefined;
  setComposer: Dispatch<SetStateAction<Composer>>;
  setFloorId: Dispatch<SetStateAction<number | null>>;
  setNoteBusy: Dispatch<SetStateAction<boolean>>;
  setNotes: Dispatch<SetStateAction<TwinNote[]>>;
  setPickingSpot: Dispatch<SetStateAction<boolean>>;
  setToast: Dispatch<SetStateAction<{ ok?: string; error?: string } | null>>;
  setUndo: Dispatch<SetStateAction<{ label: string; run: () => void } | null>>;
  showDone: boolean;
  startDrop: (asset: TwinAsset, floor: number | null) => void;
};

export function useTwinNotes(c: TwinNotesDeps) {
  const { alertsRef, assetById, composer, confirmBox, data, dragRef, dropping, floorById, floorId, focus, notes, panels, pickingSpot, ready, roomById, routes, sceneRef, selAsset, selRoom, setComposer, setFloorId, setNoteBusy, setNotes, setPickingSpot, setToast, setUndo, showDone, startDrop } = c;
  /* ── Wave 7e: notes, live alerts, drag to move ── */
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setNotes(notes.filter((n) => showDone || n.status === "OPEN").map((n) => ({ id: n.id, floorId: n.floorId, x: n.x, y: n.y, done: n.status === "DONE" })));
  }, [notes, showDone, ready, sceneRef]);
  const noteWhere = (n: TwinNote) => {
    const a = n.assetId ? assetById.get(n.assetId) : undefined; const r = n.roomId ? roomById.get(n.roomId) : undefined;
    return [a ? `${a.deviceType} ${a.tag}` : null, r?.name ?? null, floorById.get(n.floorId)?.name ?? null].filter(Boolean).join(" · ");
  };
  /** Open the composer for the selected device or room (a device's spot, or a point inside the room). */
  function noteOnSelection() {
    const s = sceneRef.current; if (!s) return;
    if (selAsset) {
      const sp = s.spotOfAsset(selAsset.id); const f = sp ? floorById.get(sp.floorId) : undefined; if (!sp || !f) return;
      const k = f.unitsPerMetre || 10;
      setComposer({ floorId: f.id, x: sp.x * k, y: sp.z * k, roomId: selAsset.roomId, assetId: selAsset.id, where: `${selAsset.deviceType} ${selAsset.tag}` });
    } else if (selRoom) {
      const [x, y] = interiorPoint(selRoom.poly as Pt[]);
      setComposer({ floorId: selRoom.floorId, x, y, roomId: selRoom.id, assetId: null, where: selRoom.name });
    }
  }
  function noteOnSpot() {
    const s = sceneRef.current; if (!s) return;
    if (floorId == null) { setToast({ error: "Choose a floor first, then click the spot for the note." }); return; }
    setPickingSpot(true);
    s.pickPoint((p) => {
      setPickingSpot(false);
      if (!p) return;
      const r = p.roomId ? roomById.get(p.roomId) : undefined;
      setComposer({ floorId: p.floorId, x: p.x, y: p.y, roomId: p.roomId, assetId: null, where: r ? `a spot in ${r.name}` : `a spot on ${floorById.get(p.floorId)?.name ?? "this floor"}` });
    });
  }
  async function saveNote(text: string, assigneeId: number | null) {
    if (!composer) return;
    setNoteBusy(true);
    const fd = new FormData();
    fd.set("floorId", String(composer.floorId)); fd.set("x", String(composer.x)); fd.set("y", String(composer.y)); fd.set("text", text);
    fd.set("roomId", composer.roomId ? String(composer.roomId) : ""); fd.set("assetId", composer.assetId ? String(composer.assetId) : "");
    fd.set("assigneeId", assigneeId ? String(assigneeId) : "");
    const res = await addNoteAction(null, fd);
    setNoteBusy(false);
    if (res?.note) { setNotes((l) => [res.note!, ...l]); setComposer(null); }
    setToast(res ? { ok: res.ok, error: res.error } : null);
  }
  async function noteStatus(n: TwinNote, done: boolean) {
    const fd = new FormData(); fd.set("noteId", String(n.id)); fd.set("status", done ? "DONE" : "OPEN");
    const res = await setNoteStatusAction(null, fd);
    if (res?.note) setNotes((l) => l.map((x) => (x.id === n.id ? res.note! : x)));
    setToast(res ? { ok: res.ok, error: res.error } : null);
  }
  async function noteDelete(n: TwinNote) {
    if (!(await confirmBox.ask("Delete this note?", "Delete the note"))) return;
    const fd = new FormData(); fd.set("noteId", String(n.id));
    const res = await deleteNoteAction(null, fd);
    if (res?.deletedId) setNotes((l) => l.filter((x) => x.id !== n.id));
    setToast(res ? { ok: res.ok, error: res.error } : null);
  }
  async function notePhoto(n: TwinNote, file: File) {
    const fd = new FormData(); fd.set("noteId", String(n.id)); fd.set("photo", file);
    setToast({ ok: "Uploading the photo…" });
    const res = await addNotePhotoAction(null, fd);
    if (res?.photo) setNotes((l) => l.map((x) => (x.id === n.id ? { ...x, photos: [...(x.photos ?? []), res.photo!] } : x)));
    setToast(res ? { ok: res.ok, error: res.error } : null);
  }
  function focusNote(n: TwinNote) {
    if (n.assetId && assetById.has(n.assetId)) { focus({ kind: "asset", id: n.assetId }); return; }
    if (n.roomId && roomById.has(n.roomId)) { focus({ kind: "room", id: n.roomId }); return; }
    const s = sceneRef.current; const f = floorById.get(n.floorId); if (!s || !f) return;
    setFloorId(f.id); s.isolateFloor(f.id, false);
    const k = 1 / (f.unitsPerMetre || 10); s.frameSpots([{ floorId: f.id, x: n.x * k, z: n.y * k }]);
  }
  useEffect(() => {
    if (!pickingSpot) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") sceneRef.current?.cancelPickPoint(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickingSpot, sceneRef]);
  // A work order's "Show the route in 3D" (…&assetId=<id>&routeFrom=<room>): the route from the workshop to the device.
  const routeParamDone = useRef(false);
  useEffect(() => {
    if (!ready || routeParamDone.current) return;
    routeParamDone.current = true;
    const sp = new URLSearchParams(window.location.search);
    const fromRoom = Number(sp.get("routeFrom")), assetId = Number(sp.get("assetId"));
    const s = sceneRef.current; if (!s || !fromRoom || !assetId) return;
    void (async () => {
      const a = assetById.get(assetId); const sp2 = s.spotOfAsset(assetId); const start = await routes.roomPlace(fromRoom);
      if (!a || !sp2 || !start) return;
      const rt = await routes.route(start, { floorId: sp2.floorId, x: sp2.x, z: sp2.z, roomId: a.roomId }, "foot", new Date().getHours());
      if (!rt) return;
      if (rt.floorChanges) { setFloorId(null); s.isolateFloor(null, false); }
      s.showRoute(routeSpots(rt)); s.frameRoute();
      setToast({ ok: `From the workshop to ${a.tag}: ${Math.round(rt.metres)} m, about ${formatDuration(rt.seconds)} on foot.` });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the model is ready
  }, [ready]);
  // A link to a note (…&note=<id>, from a notification) opens it once the model is ready.
  const noteParamDone = useRef(false);
  useEffect(() => {
    if (!ready || noteParamDone.current) return;
    noteParamDone.current = true;
    const n = notes.find((x) => x.id === Number(new URLSearchParams(window.location.search).get("note")));
    if (!n) return;
    const t = setTimeout(() => { focusNote(n); if (!panels.isOpen("notes")) panels.toggle("notes"); }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the model is ready
  }, [ready]);
  useEffect(() => {
    alertsRef.current = (prev, next) => {
      const down = new Set(["UNDER_MAINTENANCE", "OUT_OF_SERVICE"]);
      const fresh = [...next].filter(([id, m]) => {
        const o = prev.get(id);
        return o && (m.openJobs > o.openJobs || (down.has(m.status) && !down.has(o.status)));
      }).map(([id]) => assetById.get(id)).filter((a): a is TwinAsset => !!a);
      if (!fresh.length) return;
      for (const a of fresh.slice(0, 10)) sceneRef.current?.flashAsset(a.id);
      const a = fresh[0]; const room = a.roomId ? roomById.get(a.roomId) : undefined;
      setToast({ ok: `New fault: ${a.deviceType} ${a.tag}${room ? ` in ${room.name}` : ""}${fresh.length > 1 ? ` (and ${fresh.length - 1} more)` : ""}.` });
      setUndo({ label: "Go there", run: () => { focus({ kind: "asset", id: a.id }); setToast(null); setUndo(null); } });
    };
  });
  useEffect(() => {
    dragRef.current = {
      canDrag: (id) => data.can.move && !dropping && assetById.has(id),
      start: (id) => { const a = assetById.get(id); if (a) startDrop(a, null); },
    };
  });
  return { noteWhere, noteOnSelection, noteOnSpot, saveNote, noteStatus, noteDelete, notePhoto, focusNote, routeParamDone, noteParamDone };
}
