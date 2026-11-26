"use client";
/**
 * Camera QR reading for every phone (wave 39). `BarcodeDetector` where the browser has it (Chrome on Android);
 * otherwise video frames are drawn to a canvas and decoded with jsQR about 6 times a second (iPhone Safari, Firefox).
 * Used by Scan a label, rounds and stock-takes, and My jobs.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { dueForAttempt, frameSize, pickDecoder } from "../lib/qr-scan";

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (o: { formats: string[] }) => Detector;

const noop = () => () => {};

/** Whether this phone can scan with the camera at all (any camera; jsQR covers browsers without BarcodeDetector). */
export function useCanScan(): boolean {
  return useSyncExternalStore(noop, () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia, () => false);
}

/**
 * While `active`, shows the back camera in the returned video element and calls `onCode` once with the first label
 * read. `onError` gets a message when the camera can't be opened. The caller sets `active` false to stop.
 */
export function useQrCamera(active: boolean, onCode: (raw: string) => void, onError: (message: string) => void, formats: string[] = ["qr_code"]) {
  const video = useRef<HTMLVideoElement>(null);
  const handlers = useRef({ onCode, onError });
  useEffect(() => { handlers.current = { onCode, onError }; });
  const formatKey = formats.join(",");

  useEffect(() => {
    if (!active) return;
    let stop = false, stream: MediaStream | null = null, timer = 0;
    const found = (raw: string) => { if (stop) return; stop = true; handlers.current.onCode(raw); };
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    const decoder = pickDecoder(!!Ctor);

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(async (s) => {
      stream = s;
      if (stop) { s.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current;
      if (!v) return;
      v.srcObject = s;
      await v.play().catch(() => {});
      if (decoder === "barcode-detector") {
        let det: Detector;
        try { det = new Ctor!({ formats: formatKey.split(",") }); } catch { det = new Ctor!({ formats: ["qr_code"] }); }
        const loop = async () => {
          if (stop || !video.current) return;
          const codes = await det.detect(video.current).catch(() => []);
          if (codes[0]?.rawValue) { found(codes[0].rawValue); return; }
          requestAnimationFrame(loop);
        };
        void loop();
        return;
      }
      // jsQR: loaded only when needed, so phones with BarcodeDetector never download it.
      const jsQR = (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) { handlers.current.onError("This browser can't read the camera picture. Type the tag instead."); return; }
      let last = 0;
      const tick = (now: number) => {
        if (stop || !video.current) return;
        const el = video.current;
        if (dueForAttempt(now, last) && el.readyState >= 2) {
          last = now;
          const size = frameSize(el.videoWidth, el.videoHeight);
          if (size.width) {
            if (canvas.width !== size.width) canvas.width = size.width;
            if (canvas.height !== size.height) canvas.height = size.height;
            ctx.drawImage(el, 0, 0, size.width, size.height);
            const img = ctx.getImageData(0, 0, size.width, size.height);
            const code = jsQR(img.data, size.width, size.height, { inversionAttempts: "dontInvert" });
            if (code?.data) { found(code.data); return; }
          }
        }
        timer = requestAnimationFrame(tick);
      };
      timer = requestAnimationFrame(tick);
    }).catch(() => { if (!stop) handlers.current.onError("The camera isn't available. Allow the camera for this site, or type the tag."); });

    return () => { stop = true; cancelAnimationFrame(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [active, formatKey]);

  return video;
}
