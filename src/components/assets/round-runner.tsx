"use client";
/**
 * The phone page of a round or stock-take (wave 12, D7). Scan a label (camera where the browser can read QR codes, or
 * a handheld scanner / typing), then mark the device OK, faulty or moved. Results are kept on the phone and sent when
 * there is signal; nothing is lost if the connection drops.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { parseScan } from "@/lib/assets/rounds";

export type RoundAsset = { id: number; tag: string; typeName: string; room: string | null; result: string | null };
type Pending = { assetId?: number; tag?: string; result: "OK" | "FAULT" | "MOVED"; roomId?: number | null; note?: string; checkedAt: string; label: string };
type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

const noop = () => () => {};
export function RoundRunner({ roundId, expected, rooms, finished, finish }: { roundId: number; expected: RoundAsset[]; rooms: { id: number; name: string }[]; finished: boolean;
  /** The finish form, shown once everything has been sent. */
  finish?: ReactNode }) {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const key = `pams-round-${roundId}`;
  const [queue, setQueue] = useState<Pending[]>(() => { try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; } });
  const [done, setDone] = useState<Record<string, string>>(() => Object.fromEntries(expected.filter((e) => e.result).map((e) => [e.tag, e.result!])));
  const [current, setCurrent] = useState<{ assetId?: number; tag: string; label: string } | null>(null);
  const [text, setText] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [camera, setCamera] = useState(false);
  const [note, setNote] = useState("");
  const [room, setRoom] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const sending = useRef(false);
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(queue)); } catch { /* storage full or blocked */ } }, [queue, key]);

  const send = useCallback(async () => {
    const queue = queueRef.current;
    if (sending.current || !queue.length || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    sending.current = true;
    try {
      const batch = queue.slice(0, 50);
      const res = await fetch(`/assets/rounds/${roundId}/sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: batch }) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setLog((l) => [`Not sent: ${e.error ?? res.status}`, ...l].slice(0, 30)); return; }
      const { done: d } = (await res.json()) as { done: { ok: boolean; message: string }[] };
      setQueue((q) => q.slice(batch.length));
      setLog((l) => [...d.map((x) => (x.ok ? "✓ " : "✕ ") + x.message), ...l].slice(0, 30));
    } catch { /* offline: try again later */ } finally { sending.current = false; }
  }, [roundId]);
  useEffect(() => { const t = setInterval(send, 5000); window.addEventListener("online", send); return () => { clearInterval(t); window.removeEventListener("online", send); }; }, [send]);

  const pick = (raw: string) => {
    const s = parseScan(raw);
    if (!s) { setLog((l) => [`✕ “${raw}” isn't a device label`, ...l]); return; }
    const hit = expected.find((e) => (s.assetId && e.id === s.assetId) || (s.tag && e.tag === s.tag));
    setCurrent({ assetId: s.assetId ?? hit?.id, tag: s.tag ?? hit?.tag ?? `#${s.assetId}`, label: hit ? `${hit.tag} · ${hit.typeName}${hit.room ? ` · ${hit.room}` : ""}` : `${s.tag ?? `device ${s.assetId}`} (not on this ward's list)` });
    setNote(""); setRoom(""); setText("");
  };
  const mark = (result: Pending["result"]) => {
    if (!current) return;
    if (result === "MOVED" && !room) { setLog((l) => ["Choose the room it's in now.", ...l]); return; }
    setQueue((q) => [...q, { assetId: current.assetId, tag: current.assetId ? undefined : current.tag, result, roomId: result === "MOVED" ? Number(room) : null, note: note || undefined, checkedAt: new Date().toISOString(), label: current.label }]);
    setDone((d) => ({ ...d, [current.tag]: result }));
    setCurrent(null);
    setTimeout(send, 50);
  };

  useEffect(() => {
    if (!camera) return;
    const D = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector!;
    let stop = false, stream: MediaStream | null = null;
    const det = new D({ formats: ["qr_code"] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(async (s) => {
      stream = s; if (!video.current) return;
      video.current.srcObject = s; await video.current.play();
      const loop = async () => {
        if (stop || !video.current) return;
        const codes = await det.detect(video.current).catch(() => []);
        if (codes[0]) { pick(codes[0].rawValue); setCamera(false); return; }
        requestAnimationFrame(loop);
      };
      loop();
    }).catch(() => { setLog((l) => ["The camera isn't available: type the tag or use a scanner.", ...l]); setCamera(false); });
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  const left = expected.filter((e) => !done[e.tag]);
  const btn = "rounded-lg px-4 py-3 text-base font-semibold";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded bg-sunken px-2 py-1">{expected.length - left.length} of {expected.length} checked</span>
        {hydrated && <span className={`rounded px-2 py-1 ${queue.length ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"}`}>{queue.length ? `${queue.length} waiting to send` : "All sent"}</span>}
      </div>
      {!finished && (
        <div className="rounded-lg border border-line bg-surface p-4">
          <form onSubmit={(e) => { e.preventDefault(); pick(text); }} className="flex gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Scan or type the tag" aria-label="Asset tag" autoFocus className="min-w-0 flex-1 rounded-lg border border-line px-3 py-3 text-base uppercase" />
            <button className={`${btn} border border-line`}>Find</button>
          </form>
          <button type="button" onClick={() => {
            if (!camera && !("BarcodeDetector" in window)) { setLog((l) => ["This browser can't read QR codes with the camera: type the tag or use a scanner.", ...l]); return; }
            setCamera((c) => !c);
          }} className={`${btn} mt-2 w-full border border-line`}>{camera ? "Stop camera" : "Scan with the camera"}</button>
          {camera && <video ref={video} className="mt-2 w-full rounded-lg bg-black" playsInline muted />}
          {current && (
            <div className="mt-4 space-y-2">
              <p className="text-base font-semibold">{current.label}</p>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (what's wrong, where it was)" aria-label="Note" className="w-full rounded-lg border border-line px-3 py-2" />
              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={() => mark("OK")} className={`${btn} bg-ok text-white`}>OK</button>
                <button type="button" onClick={() => mark("FAULT")} className={`${btn} bg-danger text-white`}>Fault</button>
                <button type="button" onClick={() => mark("MOVED")} className={`${btn} border border-line`}>Moved</button>
              </div>
              <select value={room} onChange={(e) => setRoom(e.target.value)} aria-label="Room it's in now" className="w-full rounded-lg border border-line px-3 py-2">
                <option value="">Room it&apos;s in now (for Moved)…</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
      {log.length > 0 && <ul className="space-y-0.5 text-sm">{log.slice(0, 8).map((l, i) => <li key={i} className={l.startsWith("✕") ? "text-danger" : "text-muted"}>{l}</li>)}</ul>}
      {!finished && finish && hydrated && (queue.length ? <p className="rounded-lg border border-warn bg-warn-soft p-3 text-sm text-warn">{queue.length} result{queue.length === 1 ? " is" : "s are"} still on this phone. They are sent as soon as there is signal; finish after that.</p> : finish)}
      <div>
        <p className="mb-1 text-sm font-semibold">Still to check ({left.length})</p>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">{left.slice(0, 200).map((e) => (
          <li key={e.id}><button type="button" disabled={finished} onClick={() => pick(e.tag)} className="w-full px-3 py-2 text-left hover:bg-sunken"><span className="font-mono">{e.tag}</span> <span className="text-muted">{e.typeName}{e.room ? ` · ${e.room}` : ""}</span></button></li>
        ))}</ul>
      </div>
    </div>
  );
}
