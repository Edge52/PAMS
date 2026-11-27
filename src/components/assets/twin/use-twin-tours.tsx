"use client";
/**
 * Guided tours: edit, play, record as video, and the shared tour link (wave 7f).
 * Split out of use-twin-view.tsx in wave 41 without changing the code: useTwinView calls it at the same place, so
 * the hooks run in the same order, and passes what the code reads.
 */
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { deleteTourAction, saveTourAction, type Tour } from "@/app/assets/3d/actions";
import { decodeView, encodeView, type ViewState } from "./view-state";
import type { TwinScene } from "./scene";
import { type TwinData } from "./types";
import { useConfirm } from "./use-confirm";


export type TourEdit = { id?: number; name: string; shared: boolean; stops: { state: string; caption: string; seconds: number }[] } | null;
export type TourPlay = { tour: Tour; i: number; paused: boolean } | null;
export type TwinToursDeps = {
  applyView: (v: ViewState, animate?: boolean) => void;
  confirmBox: ReturnType<typeof useConfirm>;
  currentView: () => ViewState | null;
  data: TwinData;
  ready: boolean;
  root: RefObject<HTMLDivElement | null>;
  sceneRef: RefObject<TwinScene | null>;
  setToast: Dispatch<SetStateAction<{ ok?: string; error?: string } | null>>;
  setTourEdit: Dispatch<SetStateAction<TourEdit>>;
  setTourPlay: Dispatch<SetStateAction<TourPlay>>;
  setTours: Dispatch<SetStateAction<Tour[]>>;
  tourEdit: TourEdit;
  tourPlay: TourPlay;
  tours: Tour[];
};

export function useTwinTours(c: TwinToursDeps) {
  const { applyView, confirmBox, currentView, data, ready, root, sceneRef, setToast, setTourEdit, setTourPlay, setTours, tourEdit, tourPlay, tours } = c;
  /* ── Wave 7f: tours ── */
  function addStop() {
    const v = currentView(); if (!v) return;
    setTourEdit((t) => ({ ...(t ?? { name: "", shared: false, stops: [] }), stops: [...(t?.stops ?? []), { state: encodeView(v), caption: "", seconds: 8 }] }));
  }
  async function saveTour() {
    if (!tourEdit) return;
    const fd = new FormData();
    fd.set("facilityId", String(data.facility.id)); fd.set("tourId", tourEdit.id ? String(tourEdit.id) : ""); fd.set("name", tourEdit.name);
    fd.set("shared", tourEdit.shared ? "true" : "false"); fd.set("stops", JSON.stringify(tourEdit.stops));
    const res = await saveTourAction(null, fd);
    if (res?.tour) { setTours((l) => [...l.filter((t) => t.id !== res.tour!.id), res.tour!].sort((a, b) => a.name.localeCompare(b.name))); setTourEdit(null); }
    setToast(res ? { ok: res.ok, error: res.error } : null);
  }
  async function deleteTour(t: Tour) {
    if (!(await confirmBox.ask(`Delete the tour “${t.name}”?`, "Delete the tour"))) return;
    const fd = new FormData(); fd.set("tourId", String(t.id));
    const res = await deleteTourAction(null, fd);
    if (res?.deletedId) setTours((l) => l.filter((x) => x.id !== t.id));
    setToast(res ? { ok: res.ok, error: res.error } : null);
  }
  function playTour(t: Tour, fullscreen = true) {
    setTourPlay({ tour: t, i: 0, paused: false });
    if (fullscreen) try { void root.current?.requestFullscreen?.(); } catch { /* not allowed: plays in the page */ }
  }
  // Flythrough video (wave 17, phase 9): play the tour in the page and record the 3D view with its captions.
  const recorder = useRef<{ rec: MediaRecorder; chunks: Blob[]; name: string; type: string } | null>(null);
  const [recording, setRecording] = useState(false);
  function recordTour(t: Tour) {
    const s = sceneRef.current;
    if (!s || typeof MediaRecorder === "undefined") { setToast({ error: "This browser can't record video. Try Chrome, Edge or Firefox." }); return; }
    const type = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const stream = s.startRecording(`${data.facility.name} · ${t.name}`);
    const rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      s.stopRecording(); stream.getTracks().forEach((x) => x.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || "video/webm" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = `${t.name.replace(/[^\w\- ]+/g, "_")}.${(rec.mimeType || "").includes("mp4") ? "mp4" : "webm"}`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      setRecording(false); recorder.current = null;
      setToast({ ok: "Video saved to your downloads." });
    };
    recorder.current = { rec, chunks, name: t.name, type };
    rec.start(1000); setRecording(true);
    playTour(t, false);
  }
  function stopTour() {
    setTourPlay(null);
    if (recorder.current?.rec.state === "recording") recorder.current.rec.stop();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }
  const tourStop = tourPlay ? tourPlay.tour.stops[tourPlay.i] : null;
  // The recording ends with the tour; each stop's caption goes on the video.
  useEffect(() => { if (!tourPlay && recorder.current?.rec.state === "recording") setTimeout(() => recorder.current?.rec.stop(), 1500); }, [tourPlay]);
  useEffect(() => { if (tourStop) sceneRef.current?.setRecordingCaption([tourStop.caption]); }, [tourStop, sceneRef]);
  useEffect(() => {
    if (!tourStop) return;
    const v = decodeView(tourStop.state); if (v) applyView(v, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- show each stop once
  }, [tourPlay?.tour.id, tourPlay?.i]);
  useEffect(() => {
    if (!tourPlay || tourPlay.paused || !tourStop) return;
    const t = setTimeout(() => setTourPlay((p) => (!p ? p : p.i + 1 < p.tour.stops.length ? { ...p, i: p.i + 1 } : (stopTourSoon(), null))), tourStop.seconds * 1000);
    return () => clearTimeout(t);
  }, [tourPlay, tourStop, setTourPlay]);
  function stopTourSoon() { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }
  // A shared link (…&tour=<id>) plays that tour once the model is ready.
  const tourParamDone = useRef(false);
  useEffect(() => {
    if (!ready || tourParamDone.current) return;
    tourParamDone.current = true;
    const t = tours.find((x) => x.id === Number(new URLSearchParams(window.location.search).get("tour")));
    if (!t) return;
    const h = setTimeout(() => setTourPlay({ tour: t, i: 0, paused: false }), 0); // full screen needs a click, so it plays in the page
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the model is ready
  }, [ready]);
  return { addStop, saveTour, deleteTour, playTour, recorder, recordTour, stopTour, tourStop, stopTourSoon, tourParamDone, recording, setRecording };
}
