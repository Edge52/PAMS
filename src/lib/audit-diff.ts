/** Audit trail helpers (wave 24): what changed between two versions of a record, for the activity log. Pure. */
export type Changes = Record<string, { from: unknown; to: unknown }>;

/** Fields that never belong in an audit entry: secrets, and times the database keeps by itself. */
const SKIP = new Set(["updatedAt", "createdAt", "passwordHash", "password", "token", "tokenHash", "secret", "totpSecret", "totpLastStep", "backupCodeHashes"]);

const plain = (v: unknown): unknown => {
  if (v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && /^-?\d+\.\d+$/.test(v)) return v.replace(/\.?0+$/, ""); // "100.00" and "100" are the same amount
  return v;
};
const same = (a: unknown, b: unknown) => JSON.stringify(plain(a)) === JSON.stringify(plain(b));

/**
 * The fields of `after` that differ from `before`, with both values. Only keys present in `after` are compared, so a
 * partial update lists just what it touched. Null, undefined and "" count as the same (an empty field).
 */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>, only?: readonly string[]): Changes | null {
  const out: Changes = {};
  for (const key of only ?? Object.keys(after)) {
    if (SKIP.has(key) || !(key in after)) continue;
    if (!same(before[key], after[key])) out[key] = { from: plain(before[key]), to: plain(after[key]) };
  }
  return Object.keys(out).length ? out : null;
}

/** `purchaseCost` → "Purchase cost", for showing a change to a person. */
const LABELS: Record<string, string> = { udiDi: "UDI device identifier", udiPi: "UDI lot, dates and serial", lengthM: "Length (m)", widthM: "Width (m)", heightM: "Height (m)", facilityIds: "Hospitals", gmdnCode: "GMDN code", gmdnTerm: "GMDN term", umdnsCode: "UMDNS code" };
export function fieldLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key.replace(/Id$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A value as shown in the audit trail: short, never empty. */
export function showValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "empty";
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

/** One line for the log summary: "Status: in service → out of service; Room: 12 → 40" (at most `max` fields). */
export function changeSummary(c: Changes | null, max = 3): string {
  if (!c) return "";
  const keys = Object.keys(c);
  return keys.slice(0, max).map((k) => `${fieldLabel(k)}: ${showValue(c[k].from)} → ${showValue(c[k].to)}`).join("; ") + (keys.length > max ? `; +${keys.length - max} more` : "");
}
