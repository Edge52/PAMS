/**
 * A same-site path that is safe to redirect to, or null. Rejects anything a browser could read as another host:
 * "//x", "/\x", control characters (browsers strip tabs/newlines, turning "/\t/x" into "//x"), and backslashes anywhere.
 */
export function safeLocalPath(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (!v.startsWith("/") || v.startsWith("//")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return null;
  return v;
}

/** URL path segments decoded, or null when one has a broken % escape (audit S16: "/files/a/%E0" was a 500). */
export function decodeSegments(segments: string[]): string[] | null {
  try { return segments.map((s) => decodeURIComponent(s)); } catch { return null; }
}
