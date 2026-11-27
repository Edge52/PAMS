"use client";
/**
 * Dropping devices on the plan at real size (wave 7).
 * Split out of use-twin-view.tsx in wave 41 without changing the code: useTwinView calls it at the same place, so
 * the hooks run in the same order, and passes what the code reads.
 */
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { twinDropAction } from "@/app/assets/3d/actions";
import type { DropResult, TwinScene } from "./scene";
import { type TwinAsset, type TwinData, type TwinRoom } from "./types";
import { deviceKind } from "./geometry";


export type TwinDropDeps = {
  assetList: TwinData["assets"];
  data: TwinData;
  dropping: { asset: TwinAsset; at: DropResult | null } | null;
  floorId: number | null;
  placeFloor: number | null;
  ready: boolean;
  roomById: Map<number, TwinRoom>;
  sceneRef: RefObject<TwinScene | null>;
  setAssetList: Dispatch<SetStateAction<TwinData["assets"]>>;
  setDropping: Dispatch<SetStateAction<{ asset: TwinAsset; at: DropResult | null } | null>>;
  setFloorId: Dispatch<SetStateAction<number | null>>;
  setToast: Dispatch<SetStateAction<{ ok?: string; error?: string } | null>>;
  setUndo: Dispatch<SetStateAction<{ label: string; run: () => void } | null>>;
  setUnplaced: Dispatch<SetStateAction<TwinAsset[]>>;
  unplaced: TwinAsset[];
};

export function useTwinDrop(c: TwinDropDeps) {
  const { assetList, data, dropping, floorId, placeFloor, ready, roomById, sceneRef, setAssetList, setDropping, setFloorId, setToast, setUndo, setUnplaced, unplaced } = c;
  /* ── Wave 7: dropping devices on the plan at real size ── */

  /** Turn of a device as drawn now (degrees clockwise): its saved turn, else the quarter turn the scene gives it. */
  const turnOf = (a: TwinAsset) => a.rot ?? ((360 - (a.id % 4) * 90) % 360);
  function startDrop(asset: TwinAsset, floor: number | null) {
    const s = sceneRef.current; if (!s || !data.can.move) return;
    const target = floor ?? (asset.roomId ? roomById.get(asset.roomId)?.floorId : null) ?? placeFloor ?? floorId ?? data.floors.find((f) => f.hasCad)?.id ?? data.floors[0]?.id;
    if (target == null) return;
    if (floorId !== target) setFloorId(target);
    setToast(null); setUndo(null);
    setDropping({ asset, at: null });
    s.beginDrop({ assetId: asset.id, kind: deviceKind(asset.groupCode, asset.categoryCode), dims: asset.dims, rot: turnOf(asset) }, target,
      (r) => { setDropping(null); if (r) void saveDrop(asset, r); },
      (r) => setDropping((d) => (d ? { ...d, at: r } : d)));
  }
  async function sendDrop(assetId: number, roomId: number | null, x: number | null, y: number | null, rot: number | null) {
    const fd = new FormData();
    fd.set("assetId", String(assetId)); fd.set("roomId", roomId == null ? "" : String(roomId));
    if (x != null && y != null) { fd.set("posX", String(x)); fd.set("posY", String(y)); }
    if (rot != null) fd.set("rot", String(rot));
    return twinDropAction(null, fd);
  }
  /** Apply a saved drop (or undo) to the lists and the model. */
  function applyDrop(asset: TwinAsset, roomId: number | null, posX: number | null, posY: number | null, rot: number | null) {
    const s = sceneRef.current;
    const next = { ...asset, roomId, posX, posY, rot };
    if (roomId == null) {
      setAssetList((l) => l.filter((a) => a.id !== asset.id));
      setUnplaced((l) => [next, ...l.filter((a) => a.id !== asset.id)]);
      s?.removeAsset(asset.id);
    } else {
      setUnplaced((l) => l.filter((a) => a.id !== asset.id));
      setAssetList((l) => (l.some((a) => a.id === asset.id) ? l.map((a) => (a.id === asset.id ? next : a)) : [...l, next]));
      s?.upsertAssets([next]);
    }
  }
  async function saveDrop(asset: TwinAsset, r: DropResult) {
    if (r.roomId == null) { setToast({ error: "Drop the device inside a room." }); return; }
    const before = { roomId: asset.roomId, posX: asset.posX, posY: asset.posY, rot: asset.rot };
    const res = await sendDrop(asset.id, r.roomId, r.x, r.y, r.rot);
    if (!res?.ok) { setToast({ error: res?.error ?? "The device couldn't be placed." }); return; }
    applyDrop(asset, res.roomId ?? null, res.posX ?? null, res.posY ?? null, res.rot ?? null);
    setToast({ ok: `${asset.tag}: ${res.ok}${r.inside ? "" : " It sticks out of the room; check the spot."}` });
    const placedAsset = { ...asset, roomId: res.roomId ?? null, posX: res.posX ?? null, posY: res.posY ?? null, rot: res.rot ?? null };
    setUndo({
      label: before.roomId == null ? "Undo (back to the list)" : "Undo",
      run: async () => {
        setUndo(null);
        const u = await sendDrop(asset.id, before.roomId, before.posX, before.posY, before.rot);
        if (!u?.ok) { setToast({ error: u?.error ?? "Couldn't undo." }); return; }
        applyDrop(placedAsset, u.roomId ?? null, u.posX ?? null, u.posY ?? null, u.rot ?? null);
        setToast({ ok: `${asset.tag}: undone.` });
      },
    });
    setTimeout(() => setUndo((u) => (u ? null : u)), 30_000);
  }
  // Keys while dropping: R turns 15° (Shift+R the other way), T turns 90°, Esc cancels.
  useEffect(() => {
    if (!dropping) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const s = sceneRef.current; if (!s) return;
      if (e.key === "Escape") s.cancelDrop();
      else if (e.key === "r" || e.key === "R") { s.rotateDrop(e.shiftKey ? -15 : 15); e.preventDefault(); }
      else if (e.key === "t" || e.key === "T") { s.rotateDrop(90); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dropping, sceneRef]);
  // A link from an asset page (…&place=<id>) starts placing that device once the model is ready.
  const placeParamDone = useRef(false);
  useEffect(() => {
    if (!ready || placeParamDone.current) return;
    const id = Number(new URLSearchParams(window.location.search).get("place"));
    if (!id) return;
    const a = unplaced.find((x) => x.id === id) ?? assetList.find((x) => x.id === id);
    if (!a) return;
    const t = setTimeout(() => { placeParamDone.current = true; startDrop(a, null); }, 0); // after this render
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the model is ready
  }, [ready]);
  return { turnOf, startDrop, sendDrop, applyDrop, saveDrop, placeParamDone };
}
