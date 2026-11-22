/** Rounds and stock-takes (wave 12, D7). Pure: reading a scanned label, and the summary of a round. */

/**
 * A scanned label is the QR's URL or the tag itself typed or read by a scanner. Labels from wave 36 on carry only the
 * tag (…/scan?tag=X), since a database id can point at another device after a re-import; older labels carry the id
 * (…/assets/123?tag=X, or just …/assets/123).
 */
export function parseScan(text: string): { assetId?: number; tag?: string } | null {
  const t = text.trim();
  if (!t) return null;
  const byTag = /\/scan\?(?:[^#\s]*&)?tag=([^&#\s]+)/.exec(t);
  if (byTag) return { tag: decodeURIComponent(byTag[1]).trim().toUpperCase() };
  const m = /\/assets\/(\d+)(?:\?tag=([^&#\s]+))?/.exec(t);
  if (m) return { assetId: Number(m[1]), tag: m[2] ? decodeURIComponent(m[2]).trim().toUpperCase() : undefined };
  return /^[A-Za-z0-9][A-Za-z0-9._-]{2,47}$/.test(t) ? { tag: t.toUpperCase() } : null;
}

/** What a printed label's QR code holds: the tag, never the database id. */
export function labelUrl(origin: string, tag: string): string {
  return `${origin.replace(/\/+$/, "")}/scan?tag=${encodeURIComponent(tag)}`;
}

/** True when a label origin only works on the computer that printed it (localhost, 127.x, ::1, 0.0.0.0). Audit B5. */
export function isLocalOrigin(origin: string): boolean {
  let host: string;
  try { host = new URL(origin).hostname.toLowerCase(); } catch { return true; }
  return host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "[::1]" || host === "::1" || /^127\./.test(host);
}

export type LabelHit = { id: number; tag: string };
/**
 * Which device a scanned label means. The tag wins; the id (old labels) is used only when the label has no tag, or
 * when no device has the label's tag any more, and then `tagChanged` says the device's tag differs from the label.
 */
export function resolveLabel(scan: { assetId?: number; tag?: string }, byTag: LabelHit | null, byId: LabelHit | null):
  { id: number; tagChanged: boolean } | null {
  if (scan.tag && byTag) return { id: byTag.id, tagChanged: false };
  if (scan.assetId == null || !byId) return null;
  return { id: byId.id, tagChanged: !!scan.tag && byId.tag.toUpperCase() !== scan.tag.toUpperCase() };
}

export type RoundResult = "OK" | "FAULT" | "MOVED" | "MISSING" | "FOUND_ELSEWHERE";
export function roundSummary(expected: number[], items: { assetId: number; result: RoundResult }[]) {
  const seen = new Set(items.filter((i) => i.result !== "MISSING").map((i) => i.assetId));
  const exp = new Set(expected);
  return {
    checked: seen.size, expected: exp.size,
    notSeen: [...exp].filter((id) => !seen.has(id)),
    extra: items.filter((i) => !exp.has(i.assetId) && i.result !== "MISSING").map((i) => i.assetId),
    faults: items.filter((i) => i.result === "FAULT").length,
    moved: items.filter((i) => i.result === "MOVED").length,
  };
}
