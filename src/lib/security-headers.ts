/**
 * Security headers (wave 25). Pure, so the rules can be tested.
 *
 * The content policy lets a page run only this app's own scripts: each response names a one-time value (nonce) that
 * Next.js puts on its script tags, so a script slipped into a page by an attacker doesn't run. Nothing but the fonts loads
 * from other sites, the app can't be shown inside a frame on another site, and forms post only to the app itself.
 */
export function contentPolicy(nonce: string, dev = false): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic': scripts our own scripts load are trusted too. Dev mode needs eval for hot reload.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are used for sizes and colours throughout. Nothing loads from another site: the fonts
    // are served by the app itself (next/font, wave 36).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:", // the 3D view's route finder runs in a worker built in the page
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'self' blob:", // PDF and print previews
  ].join("; ");
}

/** Headers that are the same on every response. HSTS only when the app is served over HTTPS. */
export function fixedHeaders(https: boolean): [string, string][] {
  return [
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=(), usb=()"], // camera: scanning a tag on rounds
    ["Cross-Origin-Opener-Policy", "same-origin"],
    ...(https ? [["Strict-Transport-Security", "max-age=31536000; includeSubDomains"] as [string, string]] : []),
  ];
}
