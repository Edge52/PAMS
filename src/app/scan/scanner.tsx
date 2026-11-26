"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useCanScan, useQrCamera } from "@/components/qr-camera";
import { findScanned } from "./actions";

/** Camera (BarcodeDetector, or jsQR on iPhone and other browsers) or typed tag, then the device's page. */
export function Scanner() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [pending, start] = useTransition();
  // Whether this phone has a camera the page may use: false on the server.
  const canCamera = useCanScan();

  const go = (raw: string) => start(async () => {
    setMsg(null);
    const r = await findScanned(raw);
    if ("href" in r) router.push(r.href); else setMsg(r.error);
  });

  const video = useQrCamera(camera, (raw) => { setCamera(false); go(raw); },
    (m) => { setMsg(m); setCamera(false); }, ["qr_code", "code_128", "code_39"]);

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
      {!canCamera && <p className="text-xs text-muted">This browser can&apos;t use the camera here (the site needs https, or the camera is blocked). A hand scanner works: it types the tag into the box.</p>}
    </div>
  );
}
