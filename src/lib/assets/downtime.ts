/**
 * Downtime periods (wave 35, audit A1/A2). Pure and shared: contract statements, device KPIs, the replacement plan
 * and the 3D live feed all add up downtime the same way. Two work orders can cover the same outage (a fault reported
 * twice, a follow-up job), so periods of one device are merged before they are summed: an hour counts once.
 */

/** A downtime period; `end` null means still down. */
export type DownPeriod = { start: Date; end: Date | null };

/** Merge overlapping or touching [start, end) intervals (ms). Returns new sorted, disjoint intervals. */
export function mergeIntervals(list: [number, number][]): [number, number][] {
  const sorted = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1]) { if (b > last[1]) last[1] = b; } else out.push([a, b]);
  }
  return out;
}

/**
 * Milliseconds one device was down between `from` and `to`: each period clipped to the window (an open period runs
 * to `to`), overlaps merged, then summed. Never more than the window.
 */
export function downtimeMs(periods: DownPeriod[], from: Date, to: Date): number {
  const f = from.getTime(), t = to.getTime();
  const clipped = periods.map((p): [number, number] => [Math.max(p.start.getTime(), f), Math.min((p.end ?? to).getTime(), t)]);
  return mergeIntervals(clipped).reduce((s, [a, b]) => s + (b - a), 0);
}

/** As `downtimeMs`, for periods of many devices: overlaps merge per device only, then the devices add up. */
export function downtimeMsByDevice<K>(periods: (DownPeriod & { device: K })[], from: Date, to: Date): Map<K, number> {
  const by = new Map<K, DownPeriod[]>();
  for (const p of periods) (by.get(p.device) ?? by.set(p.device, []).get(p.device)!).push(p);
  return new Map([...by].map(([k, ps]) => [k, downtimeMs(ps, from, to)]));
}
