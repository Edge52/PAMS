/**
 * Reading QR labels with the phone camera (wave 39). Pure helpers shared by the camera hook
 * (`components/qr-camera.tsx`) and its test.
 *
 * Browsers with `BarcodeDetector` (Chrome on Android) use it. Others (iPhone Safari, Firefox) draw video frames to a
 * canvas and decode them with jsQR, a few times a second so the phone stays cool.
 */

/** Time between two jsQR attempts: about 6 frames a second. */
export const JSQR_INTERVAL_MS = 160;

/** Frames are scaled down to at most this many pixels on the long side before decoding (a label fills the view). */
export const JSQR_MAX_SIDE = 640;

export type Decoder = "barcode-detector" | "jsqr";

/** Which decoder to use: the browser's own when it has one, else jsQR. */
export function pickDecoder(hasBarcodeDetector: boolean): Decoder {
  return hasBarcodeDetector ? "barcode-detector" : "jsqr";
}

/** Canvas size for a video frame: same shape, long side at most `max`, never zero. */
export function frameSize(width: number, height: number, max = JSQR_MAX_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** True when enough time has passed since the last attempt. */
export function dueForAttempt(now: number, last: number, interval = JSQR_INTERVAL_MS): boolean {
  return now - last >= interval;
}
