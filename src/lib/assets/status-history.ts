/**
 * Device status by day (wave 16). Pure: rebuild past days from work orders' downtime, and read every device's status
 * on a given day from the stored changes. Days are ISO dates (YYYY-MM-DD) in the hospital's local calendar.
 */

export type StatusRow = { assetId: number; day: string; status: string; source?: string };
export type Downtime = { assetId: number; start: string; end: string | null };

const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * Rows for the days before snapshots began, from downtime periods: out of service from the day downtime started,
 * back to the device's usual status the day after it ended (in service, or its current status when that isn't a
 * fault). A device with downtime starts the window in its usual status. Overlapping periods merge. Days from `from`
 * to the day before `today`; `today` itself is the snapshot's.
 */
export function reconstructDays(downtimes: Downtime[], current: Map<number, string>, from: string, today: string): StatusRow[] {
  const usual = (id: number) => { const s = current.get(id) ?? "IN_SERVICE"; return s === "OUT_OF_SERVICE" || s === "UNDER_MAINTENANCE" ? "IN_SERVICE" : s; };
  const byAsset = new Map<number, { s: string; e: string }[]>();
  for (const d of downtimes) {
    const s = d.start < from ? from : d.start, e = d.end ?? today;
    if (e < from || s >= today) continue;
    (byAsset.get(d.assetId) ?? byAsset.set(d.assetId, []).get(d.assetId)!).push({ s, e });
  }
  const out: StatusRow[] = [];
  for (const [assetId, ps] of byAsset) {
    ps.sort((a, b) => a.s.localeCompare(b.s));
    const merged: { s: string; e: string }[] = [];
    for (const p of ps) { const last = merged.at(-1); if (last && p.s <= addDays(last.e, 1)) { if (p.e > last.e) last.e = p.e; } else merged.push({ ...p }); }
    if (merged[0].s > from) out.push({ assetId, day: from, status: usual(assetId), source: "reconstructed" });
    for (const p of merged) {
      out.push({ assetId, day: p.s, status: "OUT_OF_SERVICE", source: "reconstructed" });
      const back = addDays(p.e, 1);
      if (back < today) out.push({ assetId, day: back, status: usual(assetId), source: "reconstructed" });
    }
  }
  return out;
}

/** Every device's status on `day`: its latest row on or before that day; devices with none are left out. */
export function statusesOn(rows: StatusRow[], day: string): Map<number, string> {
  const best = new Map<number, StatusRow>();
  for (const r of rows) {
    if (r.day > day) continue;
    const b = best.get(r.assetId);
    if (!b || r.day > b.day) best.set(r.assetId, r);
  }
  return new Map([...best].map(([id, r]) => [id, r.status]));
}

/** The changes to store today: devices whose status differs from their latest row (or that have none). */
export function changesToday(current: { assetId: number; status: string }[], latest: Map<number, string>): { assetId: number; status: string }[] {
  return current.filter((a) => latest.get(a.assetId) !== a.status);
}
