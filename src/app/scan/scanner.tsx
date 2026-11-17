"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { findScanned } from "./actions";

const noop = () => () => {};
type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/** Camera (where the browser can read QR codes) or typed tag, then the device's page. */
export function Scanner() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [pending, start] = useTransition();
  // Whether this browser can read labels with the camera: never changes, so no subscription; false on the server.
  const canCamera = useSyncExternalStore(noop, () => "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia, () => false);

  const go = (raw: string) => start(async () => {
    setMsg(null);
    const r = await findScanned(raw);
    if ("href" in r) router.push(r.href); else setMsg(r.error);
  });

  useEffect(() => {
    if (!camera) return;
    const D = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const det = new D({ formats: ["qr_code", "code_128", "code_39"] });
    let stop = false, stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(async (s) => {
      stream = s;
      if (!video.current) return;
      video.current.srcObject = s; await video.current.play();
      const loop = async () => {
        if (stop || !video.current) return;
        const codes = await det.detect(video.current).catch(() => []);
        if (codes[0]) { setCamera(false); go(codes[0].rawValue); return; }
        requestAnimationFrame(loop);
      };
      void loop();
    }).catch(() => { setMsg("The camera isn't available. Allow the camera for this site, or type the tag."); setCamera(false); });
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  return (
    <div className="max-w-md space-y-4">
      {canCamera && (
        camera ? (
          <div className="space-y-2">
            <video ref={video} muted playsInline className="aspect-square w-full rounded-[var(--radius-panel)] bg-ink object-cover" aria-label="Camera view. Point it at the label." />
            <button type="button" onClick={() => setCamera(false)} className="min-h-11 w-full rounded-full border border-line bg-surface text-base font-semibold">Stop the camera</button>
          </div>
        ) : (
          <button type="button" onClick={() => setCamera(true)} className="min-h-14 w-full rounded-full bg-primary text-lg font-semibold text-white">Scan with the camera</button>
        )
      )}
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) go(text); }} className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Asset tag</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={canCamera ? "Or type the tag" : "Type the tag, or use a scanner"} autoFocus={!canCamera}
            autoCapitalize="characters" autoComplete="off" className="min-h-12 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-base" />
        </label>
        <button disabled={pending} className="min-h-12 rounded-full border border-line bg-surface px-5 text-base font-semibold">{pending ? "Finding…" : "Find"}</button>
      </form>
      {msg && <p role="alert" className="text-sm font-semibold text-danger">{msg}</p>}
      {!canCamera && <p className="text-xs text-muted">This browser can&apos;t read labels with the camera (Chrome on Android can). A hand scanner works: it types the tag into the box.</p>}
    </div>
  );
}
