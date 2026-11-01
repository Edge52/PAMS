/**
 * Plan vs installed, per department: the BOQ's planned quantities against the devices in the register.
 * Pure (no database), used by the 3D view's plan layer and its tests.
 */

export type PlanRow = { departmentId: number; deviceTypeId: number; planned: number };
/** `installed`: in a room and not in stock or disposed; `inStock`: delivered but not installed yet. */
export type HaveRow = { departmentId: number; deviceTypeId: number; installed: number; inStock: number };

export type ItemGap = { deviceTypeId: number; planned: number; installed: number; inStock: number; missing: number; extra: number };
export type DeptGap = {
  departmentId: number;
  planned: number; installed: number; inStock: number;
  /** Planned units not installed (delivered ones still count as missing until installed). */
  missing: number;
  /** Installed units beyond the plan (types the plan has fewer of, or none). */
  extra: number;
  /** Share of planned units installed, 0–1 (1 when nothing is planned). */
  share: number;
  items: ItemGap[];
};

export function comparePlan(plan: PlanRow[], have: HaveRow[]): DeptGap[] {
  const key = (d: number, t: number) => `${d}:${t}`;
  const items = new Map<string, ItemGap & { departmentId: number }>();
  const get = (d: number, t: number) => {
    const k = key(d, t);
    let it = items.get(k);
    if (!it) { it = { departmentId: d, deviceTypeId: t, planned: 0, installed: 0, inStock: 0, missing: 0, extra: 0 }; items.set(k, it); }
    return it;
  };
  for (const p of plan) get(p.departmentId, p.deviceTypeId).planned += Math.max(0, p.planned);
  const planned = new Set(plan.map((p) => p.departmentId));
  // Only departments the plan covers: a department the BOQ doesn't mention isn't "extra" everywhere.
  for (const h of have) {
    if (!planned.has(h.departmentId)) continue;
    const it = get(h.departmentId, h.deviceTypeId);
    it.installed += h.installed; it.inStock += h.inStock;
  }
  const byDept = new Map<number, DeptGap>();
  for (const it of items.values()) {
    it.missing = Math.max(0, it.planned - it.installed);
    it.extra = Math.max(0, it.installed - it.planned);
    let d = byDept.get(it.departmentId);
    if (!d) { d = { departmentId: it.departmentId, planned: 0, installed: 0, inStock: 0, missing: 0, extra: 0, share: 1, items: [] }; byDept.set(it.departmentId, d); }
    d.planned += it.planned; d.installed += Math.min(it.installed, it.planned); d.inStock += it.inStock;
    d.missing += it.missing; d.extra += it.extra;
    const { departmentId: _omit, ...item } = it; void _omit;
    d.items.push(item);
  }
  for (const d of byDept.values()) {
    d.share = d.planned ? d.installed / d.planned : 1;
    d.items.sort((a, b) => b.missing - a.missing || b.extra - a.extra || b.planned - a.planned);
  }
  return [...byDept.values()].sort((a, b) => a.share - b.share || b.missing - a.missing);
}

/** Completeness bands for the room colours (share of planned units installed). */
export const PLAN_BANDS = [
  { min: 1, label: "Complete", color: "#3cf5a6" },
  { min: 0.75, label: "Mostly installed (75–99 %)", color: "#c8f04a" },
  { min: 0.25, label: "Partly installed (25–74 %)", color: "#ffb534" },
  { min: 0, label: "Mostly missing (under 25 %)", color: "#ff4f62" },
] as const;

export function planBand(share: number) {
  return PLAN_BANDS.findIndex((b) => share >= b.min - 1e-9);
}

/**
 * Where to draw the missing units as ghosts: each department's missing count spread over its rooms, bigger rooms
 * first, never more than `perRoom` in one room and `cap` in all (the list says the exact numbers).
 */
export function spreadGhosts(missing: { departmentId: number; missing: number }[], roomsByDept: Map<number, { id: number; area: number }[]>,
  opts: { perRoom?: number; cap?: number } = {}): Map<number, number> {
  const perRoom = opts.perRoom ?? 6, cap = opts.cap ?? 600;
  const out = new Map<number, number>();
  let total = 0;
  for (const d of missing) {
    const rooms = [...(roomsByDept.get(d.departmentId) ?? [])].sort((a, b) => b.area - a.area);
    if (!rooms.length) continue;
    let left = d.missing;
    for (let round = 0; left > 0 && round < perRoom; round++) {
      for (const r of rooms) {
        if (left <= 0 || total >= cap) break;
        out.set(r.id, (out.get(r.id) ?? 0) + 1); left--; total++;
      }
    }
    if (total >= cap) break;
  }
  return out;
}
