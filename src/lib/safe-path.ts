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
