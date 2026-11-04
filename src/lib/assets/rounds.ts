/** Rounds and stock-takes (wave 12, D7). Pure: reading a scanned label, and the summary of a round. */

/** A scanned label is either the QR's URL (…/assets/123?tag=X) or the tag itself typed or read by a scanner. */
export function parseScan(text: string): { assetId?: number; tag?: string } | null {
  const t = text.trim();
  if (!t) return null;
  const m = /\/assets\/(\d+)(?:\?tag=([^&\s]+))?/.exec(t);
  if (m) return { assetId: Number(m[1]), tag: m[2] ? decodeURIComponent(m[2]).toUpperCase() : undefined };
  return /^[A-Za-z0-9][A-Za-z0-9._-]{2,47}$/.test(t) ? { tag: t.toUpperCase() } : null;
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
