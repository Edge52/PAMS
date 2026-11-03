/**
 * Recalls / field safety corrective actions (FSCA). Pure — matching notices to devices and tracking progress.
 */
export const RECALL_ACTIONS = ["INSPECT", "SOFTWARE_UPDATE", "MODIFY", "REPLACE_PART", "REMOVE_FROM_USE", "ADVISORY"] as const;
export type RecallAction = (typeof RECALL_ACTIONS)[number];
export const RECALL_ASSET_STATUSES = ["PENDING", "ACTIONED", "NOT_AFFECTED"] as const;

export const RECALL_ACTION_LABELS: Record<RecallAction, string> = {
  INSPECT: "Inspect the device",
  SOFTWARE_UPDATE: "Update the software",
  MODIFY: "Modify the device",
  REPLACE_PART: "Replace a part",
  REMOVE_FROM_USE: "Take out of use",
  ADVISORY: "Advisory notice to users only",
};

export type RecallCriteria = {
  deviceTypeId?: number | null; manufacturer?: string | null; modelPattern?: string | null; serialNumbers?: string[] | null;
};
export type MatchAsset = { id: number; deviceTypeId: number; manufacturer: string | null; model: string | null; serialNumber: string | null; status: string };

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[\s\-_.]+/g, "");

/** At least one criterion beyond the device type, or the type itself, must be given — a notice can't match everything. */
export function criteriaProblem(c: RecallCriteria): string | null {
  if (!c.deviceTypeId && !c.manufacturer?.trim() && !c.modelPattern?.trim() && !c.serialNumbers?.length) {
    return "Give at least a device type, manufacturer, model or serial numbers so the notice can be matched to devices.";
  }
  return null;
}

/**
 * Devices a notice applies to. Every given criterion must match: same device type; manufacturer equal ignoring case,
 * spaces and dashes; model containing the pattern (same normalisation); serial in the list. Disposed devices are left out.
 */
export function matchRecall(c: RecallCriteria, list: MatchAsset[]): MatchAsset[] {
  const man = norm(c.manufacturer), model = norm(c.modelPattern);
  const serial = c.serialNumbers?.length ? serialMatcher(c.serialNumbers) : null;
  return list.filter((a) => a.status !== "DISPOSED"
    && (!c.deviceTypeId || a.deviceTypeId === c.deviceTypeId)
    && (!man || norm(a.manufacturer) === man)
    && (!model || norm(a.model).includes(model))
    && (!serial || (a.serialNumber != null && serial(a.serialNumber))));
}

/** A serial range written "SN1000 to SN1999" or "SN1000..SN1999": same letters before the number, the number in between. */
export function parseRange(entry: string): { prefix: string; lo: number; hi: number } | null {
  const m = entry.split(/\s+to\s+|\.\./i);
  if (m.length !== 2) return null;
  const a = /^(.*?)(\d+)$/.exec(norm(m[0])), b = /^(.*?)(\d+)$/.exec(norm(m[1]));
  if (!a || !b || a[1] !== b[1]) return null;
  const lo = Number(a[2]), hi = Number(b[2]);
  return hi >= lo && hi - lo <= 10_000_000 ? { prefix: a[1], lo, hi } : null;
}

/** Matches a serial against a list of serials and ranges (wave 9, D8). */
export function serialMatcher(entries: string[]): (serial: string) => boolean {
  const exact = new Set<string>(); const ranges: NonNullable<ReturnType<typeof parseRange>>[] = [];
  for (const e of entries) { const r = parseRange(e); if (r) ranges.push(r); else exact.add(norm(e)); }
  return (serial) => {
    const s = norm(serial);
    if (exact.has(s)) return true;
    const m = /^(.*?)(\d+)$/.exec(s);
    return !!m && ranges.some((r) => r.prefix === m[1] && Number(m[2]) >= r.lo && Number(m[2]) <= r.hi);
  };
}

/** Serial list from free text: one per line or separated by commas/semicolons, de-duplicated, at most 5,000. */
export function parseSerials(text: string | null | undefined): string[] {
  return [...new Set((text ?? "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean))].slice(0, 5000);
}

export function recallProgress(rows: { status: string }[]) {
  const pending = rows.filter((r) => r.status === "PENDING").length;
  const actioned = rows.filter((r) => r.status === "ACTIONED").length;
  const notAffected = rows.filter((r) => r.status === "NOT_AFFECTED").length;
  const total = rows.length;
  return { total, pending, actioned, notAffected, pct: total ? Math.round(((total - pending) / total) * 100) : 100, done: pending === 0 };
}
