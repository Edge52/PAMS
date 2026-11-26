/**
 * Analytics › Maintenance (wave 40). Pure: the page loads rows, these functions do the sums, the tests pin them.
 *
 * Uptime is time-based: for each device, the hours it was in the period (from its install date if that is later)
 * minus the hours it was down, from the work orders that marked it out of use (downtime start → end). Overlapping
 * downtime on one device counts once; downtime still open counts up to the end of the period or now, whichever is
 * earlier. Groups (type, department, fleet) add up hours, so a big group weighs more than a small one.
 *
 * Times are compared as UTC instants; the period runs from 00:00 UTC on `from` to 24:00 UTC on `to`.
 */
import { addOutcome, classifyPpm, DEFAULT_PPM_GRACE_DAYS, emptyTally } from "../reports/calc";
import type { Kpi } from "./core";

const H = 3_600_000;

export const BENCHMARKS = {
  uptimeFleet: { value: 0.94, text: "Uptime above 94 % for the fleet", source: "Common service-contract target" },
  uptimeImaging: { value: 0.98, text: "Uptime above 98 % for imaging", source: "Siemens imaging service contracts" },
  ppmYield: { value: 0.12, text: "Under 12 % of planned visits find a fault", source: "Iadanza et al. 2019, PMC6791913" },
  npf: { value: 0.19, text: "About 19 % of repair calls find no problem", source: "Published clinical engineering studies" },
} as const;

export type Period = { from: string; to: string };
export type Interval = { start: number; end: number };

export function periodMs(p: Period): Interval {
  return { start: Date.parse(`${p.from}T00:00:00Z`), end: Date.parse(`${p.to}T00:00:00Z`) + 24 * H };
}

const ms = (v: Date | string | number | null | undefined): number | null => {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isFinite(t) ? t : null;
};

/** Merge overlapping or touching intervals. */
export function mergeIntervals(xs: Interval[]): Interval[] {
  const s = xs.filter((x) => x.end > x.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

export function clip(x: Interval, w: Interval): Interval | null {
  const start = Math.max(x.start, w.start), end = Math.min(x.end, w.end);
  return end > start ? { start, end } : null;
}

export type UptimeDevice = {
  id: number; typeId: number; typeLabel: string; departmentId: number | null; departmentLabel: string; imaging: boolean;
  /** Install (or commissioning) date; null = in the period from its start. */
  installedOn?: string | null;
  /** Disposal date, if it left the fleet. */
  leftOn?: string | null;
};
export type Downtime = { assetId: number; start: Date | string; end: Date | string | null };

/** The part of the period the device counts for: from install to disposal, and never after `now`. */
export function deviceWindow(d: Pick<UptimeDevice, "installedOn" | "leftOn">, p: Period, now: Date | number): Interval | null {
  const w = periodMs(p);
  const nowMs = ms(now)!;
  const start = Math.max(w.start, ms(d.installedOn) ?? -Infinity);
  const end = Math.min(w.end, nowMs, d.leftOn ? ms(d.leftOn)! + 24 * H : Infinity);
  return end > start ? { start, end } : null;
}

export type DeviceUptime = { id: number; hours: number; downHours: number; uptime: number | null; outages: number };

/** Hours down in a window: merged, clipped, open downtime running to the window's end. */
export function downHours(rows: { start: Date | string; end: Date | string | null }[], window: Interval): { hours: number; outages: number } {
  const xs: Interval[] = [];
  for (const r of rows) {
    const s = ms(r.start);
    if (s == null) continue;
    const e = ms(r.end) ?? window.end;
    const c = clip({ start: s, end: e }, window);
    if (c) xs.push(c);
  }
  const m = mergeIntervals(xs);
  return { hours: m.reduce((a, x) => a + (x.end - x.start), 0) / H, outages: m.length };
}

export function uptimeByDevice(devices: UptimeDevice[], downtime: Downtime[], p: Period, now: Date | number): DeviceUptime[] {
  const by = new Map<number, Downtime[]>();
  for (const d of downtime) by.set(d.assetId, [...(by.get(d.assetId) ?? []), d]);
  const out: DeviceUptime[] = [];
  for (const d of devices) {
    const w = deviceWindow(d, p, now);
    if (!w) continue;
    const hours = (w.end - w.start) / H;
    const down = downHours(by.get(d.id) ?? [], w);
    out.push({ id: d.id, hours, downHours: down.hours, uptime: hours > 0 ? 1 - down.hours / hours : null, outages: down.outages });
  }
  return out;
}

export type UptimeGroup = { key: string; label: string; devices: number; hours: number; downHours: number; uptime: number | null; imaging: boolean };

/** Add up device hours by a key (type, department, or one group for the fleet). */
export function rollUpUptime(devices: UptimeDevice[], rows: DeviceUptime[], keyOf: (d: UptimeDevice) => { key: string; label: string }): UptimeGroup[] {
  const dev = new Map(devices.map((d) => [d.id, d]));
  const g = new Map<string, UptimeGroup>();
  for (const r of rows) {
    const d = dev.get(r.id);
    if (!d) continue;
    const k = keyOf(d);
    const x = g.get(k.key) ?? { ...k, devices: 0, hours: 0, downHours: 0, uptime: null, imaging: true };
    x.devices++; x.hours += r.hours; x.downHours += r.downHours; x.imaging = x.imaging && d.imaging;
    g.set(k.key, x);
  }
  return [...g.values()].map((x) => ({ ...x, uptime: x.hours > 0 ? 1 - x.downHours / x.hours : null }))
    .sort((a, b) => (a.uptime ?? 1) - (b.uptime ?? 1) || a.label.localeCompare(b.label));
}

/* ── Failures and repairs ── */

export type Job = {
  id: number; assetId: number; type: string; status: string; reportedAt: Date | string; completedAt: Date | string | null;
  failureCode: string | null; deviceDown: boolean; downtimeStart: Date | string | null; downtimeEnd: Date | string | null;
};

const inPeriod = (t: number | null, w: Interval) => t != null && t >= w.start && t < w.end;
const counted = (j: Job) => j.status !== "CANCELLED";
const corrective = (j: Job) => j.type === "CORRECTIVE" && counted(j);

/** Corrective jobs reported in the period (cancelled ones left out): the failures. */
export function failuresIn(jobs: Job[], p: Period): Job[] {
  const w = periodMs(p);
  return jobs.filter((j) => corrective(j) && inPeriod(ms(j.reportedAt), w));
}

/**
 * MTBF = hours in service (period hours minus downtime, all devices) ÷ failures in the period. Null without failures.
 * MTTR = average hours from report to completion of corrective jobs completed in the period.
 */
export function mtbfHours(rows: DeviceUptime[], failures: number): number | null {
  if (failures <= 0) return null;
  return rows.reduce((a, r) => a + r.hours - r.downHours, 0) / failures;
}

export function mttr(jobs: Job[], p: Period): { hours: number | null; n: number } {
  const w = periodMs(p);
  const xs = jobs.filter((j) => corrective(j) && inPeriod(ms(j.completedAt), w))
    .map((j) => (ms(j.completedAt)! - ms(j.reportedAt)!) / H).filter((h) => Number.isFinite(h) && h >= 0);
  return { hours: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, n: xs.length };
}

export const REPEAT_MIN = 3;

/** Devices with at least `min` corrective jobs reported in the period, most first. */
export function repeatFailures(jobs: Job[], p: Period, min = REPEAT_MIN): { assetId: number; count: number }[] {
  const c = new Map<number, number>();
  for (const j of failuresIn(jobs, p)) c.set(j.assetId, (c.get(j.assetId) ?? 0) + 1);
  return [...c].filter(([, n]) => n >= min).map(([assetId, count]) => ({ assetId, count })).sort((a, b) => b.count - a.count || a.assetId - b.assetId);
}

/** Failures in the period by failure code; jobs without one under null ("Not recorded"). Most first. */
export function failuresByCode(jobs: Job[], p: Period): { code: string | null; count: number }[] {
  const c = new Map<string | null, number>();
  for (const j of failuresIn(jobs, p)) c.set(j.failureCode, (c.get(j.failureCode) ?? 0) + 1);
  return [...c].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || String(a.code).localeCompare(String(b.code)));
}

/** Share of coded failures in the period where no problem was found. */
export function noProblemFound(jobs: Job[], p: Period): { share: number | null; n: number; npf: number } {
  const coded = failuresIn(jobs, p).filter((j) => j.failureCode);
  const npf = coded.filter((j) => j.failureCode === "NO_PROBLEM_FOUND").length;
  return { share: coded.length ? npf / coded.length : null, n: coded.length, npf };
}

/* ── Planned maintenance ── */

export type PpmVisit = {
  status: string; scheduledDate: string | null; completedDate: string | null;
  /** The visit's job had a failed check, or a failure code other than "no problem found". */
  faultFound: boolean;
};

/** PPM yield = completed planned visits in the period that found a fault ÷ completed planned visits in the period. */
export function ppmYield(visits: PpmVisit[], p: Period): { share: number | null; n: number; faults: number } {
  const done = visits.filter((v) => v.status === "COMPLETED" && v.completedDate && v.completedDate >= p.from && v.completedDate <= p.to);
  const faults = done.filter((v) => v.faultFound).length;
  return { share: done.length ? faults / done.length : null, n: done.length, faults };
}

/**
 * PPM on time = visits scheduled in the period and due by today that were done by their date plus `grace` days
 * (7 by default) ÷ visits due. Same rule and default as the PPM compliance report.
 */
export const PPM_GRACE_DAYS = DEFAULT_PPM_GRACE_DAYS;

export function ppmOnTime(visits: PpmVisit[], p: Period, today: string, grace = DEFAULT_PPM_GRACE_DAYS): { share: number | null; n: number; onTime: number } {
  const t = emptyTally();
  for (const v of visits) {
    if (!v.scheduledDate || v.scheduledDate < p.from || v.scheduledDate > p.to) continue;
    addOutcome(t, classifyPpm({ status: v.status, scheduledDate: v.scheduledDate, completedDate: v.completedDate }, today, grace));
  }
  const n = t.onTime + t.late + t.overdue;
  return { share: n ? t.onTime / n : null, n, onTime: t.onTime };
}

/* ── The tab's KPIs ── */

export function uptimeKpi(g: Pick<UptimeGroup, "uptime" | "devices">, imaging = false): Kpi {
  const b = imaging ? BENCHMARKS.uptimeImaging : BENCHMARKS.uptimeFleet;
  return {
    label: imaging ? "Imaging uptime" : "Fleet uptime", value: g.uptime, unit: "share", n: g.devices,
    formula: "Hours in service ÷ hours in the period, from downtime on work orders", benchmark: { text: b.text, source: b.source },
  };
}

/** Tone for a value against a benchmark: ok when it meets it. `higher` = higher is better. */
export function benchTone(value: number | null, target: number, higher: boolean): "ok" | "warn" | undefined {
  if (value == null) return undefined;
  return (higher ? value >= target : value <= target) ? "ok" : "warn";
}
