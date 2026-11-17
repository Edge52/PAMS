/** Month-by-month figures for the dashboard trends (wave 26). Pure. */

/** The last `n` months up to and including today's, oldest first, as "YYYY-MM". */
export function monthKeys(today: string, n = 12): string[] {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov", or "Jan 26" for January so the year change shows. */
export const monthLabel = (key: string) => {
  const m = Number(key.slice(5, 7)) - 1;
  return m === 0 ? `Jan ${key.slice(2, 4)}` : MONTHS[m];
};

/** Put counts from a GROUP BY month query on every month, zero where there were none. */
export function onMonths(keys: string[], rows: { month: string | null; n: number | string }[]): number[] {
  const by = new Map(rows.filter((r) => r.month).map((r) => [String(r.month).slice(0, 7), Number(r.n)]));
  return keys.map((k) => by.get(k) ?? 0);
}

/** Percentage done on time per month, or null for a month with nothing done. */
export function onTimeShare(done: number[], onTime: number[]): (number | null)[] {
  return done.map((d, i) => (d ? Math.round((onTime[i] / d) * 100) : null));
}

/** Compare the last three months with the three before, in words ("up 20%", "down 5%", "about the same"). */
export function direction(values: number[]): { text: string; dir: "up" | "down" | "flat" } {
  const last = values.slice(-3).reduce((a, b) => a + b, 0), before = values.slice(-6, -3).reduce((a, b) => a + b, 0);
  if (!before && !last) return { text: "none in six months", dir: "flat" };
  if (!before) return { text: "new in the last three months", dir: "up" };
  const pct = Math.round(((last - before) / before) * 100);
  if (Math.abs(pct) < 5) return { text: "about the same as the three months before", dir: "flat" };
  // Past doubling a percentage stops meaning much; say how many times as many.
  if (pct >= 100) return { text: `${Math.round(last / before)} times as many as the three months before`, dir: "up" };
  return { text: `${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% on the three months before`, dir: pct > 0 ? "up" : "down" };
}
