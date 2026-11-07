/**
 * Queue simulation of patient pathways (wave 14, plan item B3). A discrete-event simulation over a day or a week:
 * patients arrive by each pathway's hourly profile, follow its arrows by their shares, and wait for the rooms, beds,
 * scanners, porters and lift cars they need. Many runs with different random numbers give a likely value and a range.
 * Pure and seeded: the same inputs and seed give the same results (runs in a Web Worker or on the server).
 *
 * Simplifications (shown on the page): a step holds one unit of its resource for its minutes (times vary around
 * them); walking between steps takes a fixed time; a porter goes with every non-walking patient transfer and walks
 * back; a lift car is held for one round trip per change of floor; urgent arrivals are served before routine ones.
 *
 * Wave 15 extras, all optional: staff groups held with a step's room or scanner (see withStaff in simulate-model.ts),
 * opening hours per resource (patients who come when it is closed wait for it to open), appointment books per
 * pathway (patients come at booked times, some don't come) and moving a step to another floor (changes its lift trips).
 */

/* ── Model ── */

export type ResourceKind = "room" | "bed" | "scanner" | "porter" | "lift" | "staff";
export type SimResource = { key: string; label: string; kind: ResourceKind; capacity: number };
export type SimStep = {
  key: string; label: string; kind: "START" | "STEP" | "END"; minutes: number; resource: string | null; level: number | null;
  /** A staff group held for the step's minutes as well as its resource (wave 15). */
  staff?: string | null;
};
export type SimLink = { from: string; to: string; share: number; transport: string; urgent: boolean };
export type SimFlow = { id: number; name: string; kind: string; perDay: number; profile: number[]; steps: SimStep[]; links: SimLink[] };
export type SimModel = {
  flows: SimFlow[]; resources: SimResource[];
  /** Lift pools: beds and trolleys use the bed lifts when there are any; everyone else any car. */
  liftForBeds: string | null; liftForAll: string | null;
  porter: string | null;
};
export type SimOptions = {
  days: 1 | 7; runs: number; seed: number;
  /** Spread of step times around their minutes (coefficient of variation): 0 = exact. */
  variability: number;
  /** Weekend volume as a share of a weekday (week runs). */
  weekendShare: number;
  /** Minutes walking between steps, and per storey of lift ride. */
  walkMinutes: number;
  /** Patients a day × this. */
  volumeFactor: number;
  /** Capacity overrides for what-if runs, by resource key. */
  capacity?: Record<string, number>;
  /** Opening hours by resource key (wave 15). Patients who need it while it is closed wait for it to open; jobs under way finish. */
  hours?: Record<string, OpeningHours>;
  /** Appointment books by pathway id (wave 15): patients come at booked times instead of at random. */
  books?: Record<number, AppointmentBook>;
  /** Steps moved to another floor, as "flowId:stepKey" → floor level (wave 15). Only the lift trips change. */
  levels?: Record<string, number>;
};
/** Open from `open` to `close` o'clock (0–24, open before close) every day, or on weekdays only. */
export type OpeningHours = { open: number; close: number; weekends: boolean };
/** The day's patients booked evenly from `from` to `to` o'clock; `noShow` is the share who don't come (0–1). */
export type AppointmentBook = { from: number; to: number; noShow: number };

/** Days are counted from the warm-up day (0, a Sunday); measured day 1 is a Monday. */
export const dayOfWeek = (day: number) => (day - 1 + 7) % 7;
const isWeekend = (day: number) => dayOfWeek(day) >= 5;
/** Clean opening hours: whole or half hours, 0 ≤ open < close ≤ 24; null when it is open all day every day. */
export function cleanHours(h: Partial<OpeningHours> | null | undefined): OpeningHours | null {
  if (!h) return null;
  const r = (x: unknown, d: number) => { const n = Number(x); return Number.isFinite(n) ? Math.min(24, Math.max(0, Math.round(n * 2) / 2)) : d; };
  const open = r(h.open, 0), close = r(h.close, 24), weekends = h.weekends !== false;
  if (close <= open) return null;
  return open === 0 && close === 24 && weekends ? null : { open, close, weekends };
}
/** Booked arrival times (minutes from the start of the day) for n patients from `from` to `to` o'clock: one at the start of each equal slot. */
export function bookedTimes(n: number, book: AppointmentBook): number[] {
  const from = Math.max(0, Math.min(24, book.from)), to = Math.max(from, Math.min(24, book.to));
  if (n <= 0 || to <= from) return [];
  const slot = ((to - from) * 60) / n;
  return Array.from({ length: n }, (_, i) => from * 60 + i * slot);
}
export const DEFAULT_OPTIONS: SimOptions = { days: 1, runs: 20, seed: 1, variability: 0.5, weekendShare: 0.6, walkMinutes: 3, volumeFactor: 1 };

/** Lift car time for one trip, minutes: doors and loading at both ends plus travel each way (as in the lift load check). */
export const liftMinutes = (storeys: number, transport: string) =>
  (2 * 20 + 2 * (transport === "BED" ? 60 : transport === "WHEELCHAIR" ? 30 : transport === "TROLLEY" ? 40 : 15) + 2 * storeys * 8) / 60;

/* ── Random numbers (seeded) ── */

export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function normal(r: () => number) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
/** Gamma-distributed time with this mean and coefficient of variation (Marsaglia–Tsang). */
export function gammaTime(r: () => number, mean: number, cv: number): number {
  if (mean <= 0) return 0;
  if (cv <= 0) return mean;
  const k = 1 / (cv * cv), theta = mean / k;
  const g = (shape: number): number => {
    if (shape < 1) return g(shape + 1) * Math.pow(r() || 1e-12, 1 / shape);
    const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) { let x, v; do { x = normal(r); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = r(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; }
  };
  return g(k) * theta;
}
function poisson(r: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 50) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(r)));
  const L = Math.exp(-lambda); let k = 0, p = 1;
  do { k++; p *= r(); } while (p > L);
  return k - 1;
}

/* ── Event queue ── */

type Ev = { t: number; seq: number; fn: () => void };
class Heap {
  private a: Ev[] = [];
  get size() { return this.a.length; }
  push(e: Ev) { const a = this.a; a.push(e); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (less(a[p], a[i])) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop(): Ev { const a = this.a, top = a[0], last = a.pop()!; if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && less(a[l], a[m])) m = l; if (r < a.length && less(a[r], a[m])) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
}
const less = (x: Ev, y: Ev) => x.t < y.t || (x.t === y.t && x.seq < y.seq);

/* ── One run ── */

type Waiter = { urgent: boolean; since: number; seq: number; go: () => void };
type Pool = {
  res: SimResource; cap: number; busy: number; queue: Waiter[];
  /** Opening hours (null = always open), whether it is open now, and open minutes in each measured hour. */
  sched: OpeningHours | null; open: boolean; openMin: number[];
  /** Busy unit-minutes and queue-length-minutes in each hour of the measured period, from the last change. */
  busyMin: number[]; queueMin: number[]; last: number;
  waits: number[]; maxQueue: number;
};
export type RunResult = {
  resources: Record<string, { utilisation: number; hourly: number[]; queueHourly: number[]; meanWait: number; p90Wait: number; maxWait: number; served: number; maxQueue: number }>;
  flows: Record<number, { arrived: number; finished: number; meanTime: number; p90Time: number; meanWait: number }>;
};

const q = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function simulateOnce(model: SimModel, opt: SimOptions, seed: number): RunResult {
  const r = rng(seed);
  const WARM = 24 * 60, END = WARM + opt.days * 24 * 60, HOURS = opt.days * 24;
  const heap = new Heap(); let seq = 0, now = 0;
  const at = (t: number, fn: () => void) => heap.push({ t, seq: seq++, fn });
  const pools = new Map<string, Pool>();
  for (const res of model.resources) {
    const cap = Math.max(0, Math.round(opt.capacity?.[res.key] ?? res.capacity));
    const sched = cleanHours(opt.hours?.[res.key]);
    const openMin: number[] = Array(HOURS).fill(60);
    if (sched) for (let h = 0; h < HOURS; h++) {
      const day = 1 + Math.floor(h / 24), hod = h % 24;
      openMin[h] = !sched.weekends && isWeekend(day) ? 0 : Math.max(0, Math.min(hod + 1, sched.close) - Math.max(hod, sched.open)) * 60;
    }
    pools.set(res.key, { res, cap, busy: 0, queue: [], sched, open: !sched, openMin, busyMin: Array(HOURS).fill(0), queueMin: Array(HOURS).fill(0), last: 0, waits: [], maxQueue: 0 });
  }
  /** Add the time since the pool last changed to its hourly busy and queue totals (measured period only). */
  const account = (p: Pool) => {
    let t = Math.max(p.last, WARM); const end = Math.min(now, END);
    while (t < end) {
      const h = Math.floor((t - WARM) / 60), next = Math.min(end, WARM + (h + 1) * 60);
      p.busyMin[h] += p.busy * (next - t); p.queueMin[h] += p.queue.length * (next - t);
      t = next;
    }
    p.last = now;
  };
  /** Wait for one unit (no pool, or a pool with no capacity set, means no waiting), then go. */
  const acquire = (key: string | null | undefined, urgent: boolean, go: () => void) => {
    const p = key ? pools.get(key) : undefined;
    if (!p || p.cap <= 0) { go(); return; }
    account(p);
    if (p.open && p.busy < p.cap) { p.busy++; if (now >= WARM && now < END) p.waits.push(0); go(); return; }
    p.queue.push({ urgent, since: now, seq: seq++, go }); p.maxQueue = Math.max(p.maxQueue, p.queue.length);
  };
  /** Hand the unit to the next in the queue: urgent first, then first come first served. */
  const next = (p: Pool) => {
    let best = 0; for (let i = 1; i < p.queue.length; i++) { const a = p.queue[i], b = p.queue[best]; if ((a.urgent && !b.urgent) || (a.urgent === b.urgent && a.seq < b.seq)) best = i; }
    const w = p.queue.splice(best, 1)[0];
    if (now >= WARM && now < END) p.waits.push(now - w.since);
    w.go();
  };
  const release = (key: string | null | undefined) => {
    const p = key ? pools.get(key) : undefined;
    if (!p || p.cap <= 0) return;
    account(p);
    if (p.open && p.queue.length) next(p); else p.busy--;
  };
  // Opening and closing (wave 15): at opening the queue is served up to capacity; at closing no new job starts.
  for (const p of pools.values()) {
    const sc = p.sched; if (!sc || p.cap <= 0) continue;
    for (let d = 0; d <= opt.days; d++) {
      if (!sc.weekends && isWeekend(d)) continue;
      at(d * 1440 + sc.open * 60, () => { account(p); p.open = true; while (p.busy < p.cap && p.queue.length) { p.busy++; next(p); } });
      at(d * 1440 + sc.close * 60, () => { account(p); p.open = false; });
    }
  }

  const flowStats = new Map<number, { arrived: number; finished: number; times: number[]; waits: number[] }>();
  for (const f of model.flows) {
    const st = { arrived: 0, finished: 0, times: [] as number[], waits: [] as number[] };
    flowStats.set(f.id, st);
    const steps = new Map(f.steps.map((s) => { const lv = opt.levels?.[`${f.id}:${s.key}`]; return [s.key, lv != null && Number.isFinite(lv) ? { ...s, level: lv } : s]; }));
    const outs = new Map<string, SimLink[]>();
    for (const l of f.links) if (steps.has(l.from) && steps.has(l.to) && l.from !== l.to) (outs.get(l.from) ?? outs.set(l.from, []).get(l.from)!).push(l);
    const starts = f.steps.filter((s) => s.kind === "START");
    if (!starts.length || f.perDay <= 0) continue;

    const visit = (pt: { start: number; waited: number; hops: number; measured: boolean }, s: SimStep, urgent: boolean) => {
      const leave = () => {
        const ls = outs.get(s.key);
        if (s.kind === "END" || !ls?.length || pt.hops++ > 60) {
          if (pt.measured && now < END) { st.finished++; st.times.push(now - pt.start); st.waits.push(pt.waited); }
          return;
        }
        let x = r() * ls.reduce((a, l) => a + l.share, 0), link = ls[ls.length - 1];
        for (const l of ls) { x -= l.share; if (x <= 0) { link = l; break; } }
        const next = steps.get(link.to)!;
        transfer(pt, s, next, link, () => visit(pt, next, link.urgent));
      };
      if (s.kind !== "STEP" || s.minutes <= 0) { leave(); return; }
      const asked = now;
      // The room or scanner first, then the staff to work it (wave 15); both are held for the step's minutes.
      acquire(s.resource, urgent, () => acquire(s.staff, urgent, () => {
        pt.waited += now - asked;
        at(now + gammaTime(r, s.minutes, opt.variability), () => { release(s.staff); release(s.resource); leave(); });
      }));
    };

    const transfer = (pt: { waited: number }, from: SimStep, to: SimStep, link: SimLink, arrive: () => void) => {
      const walk = opt.walkMinutes;
      const storeys = from.level != null && to.level != null ? Math.abs(from.level - to.level) : 0;
      const lift = storeys > 0 ? ((link.transport === "BED" || link.transport === "TROLLEY") && model.liftForBeds ? model.liftForBeds : model.liftForAll) : null;
      const porter = f.kind === "PATIENT" && link.transport !== "FOOT" ? model.porter : null;
      const asked = now;
      acquire(porter, link.urgent, () => {
        pt.waited += now - asked;
        const went = now;
        const ride = () => {
          if (!lift) { at(now + walk, done); return; }
          const askedLift = now;
          at(now + walk / 2, () => acquire(lift, link.urgent, () => {
            pt.waited += now - askedLift - walk / 2;
            at(now + liftMinutes(storeys, link.transport), () => { release(lift); at(now + walk / 2, done); });
          }));
        };
        // The porter walks back after handing over (same time as the way there).
        const done = () => { if (porter) at(now + (now - went), () => release(porter)); arrive(); };
        ride();
      });
    };

    // Arrivals: a Poisson number each hour, spread evenly at random within it.
    const totalDays = 1 + opt.days;
    const book = opt.books?.[f.id];
    const arrive = (t: number) => {
      const start = starts[Math.floor(r() * starts.length)];
      at(t, () => {
        const pt = { start: now, waited: 0, hops: 0, measured: now >= WARM && now < END };
        if (pt.measured) st.arrived++;
        visit(pt, start, false);
      });
    };
    for (let d = 0; d < totalDays; d++) {
      const dayFactor = opt.days === 7 && d > 0 && isWeekend(d) ? opt.weekendShare : 1;
      if (book) {
        // Booked: the day's patients at their slot times, a few minutes early or late; no-shows don't come.
        for (const t of bookedTimes(Math.round(f.perDay * opt.volumeFactor * dayFactor), book)) {
          if (r() < Math.min(1, Math.max(0, book.noShow))) continue;
          arrive(Math.max(d * 1440, d * 1440 + t + (r() - 0.5) * 10));
        }
        continue;
      }
      for (let h = 0; h < 24; h++) {
        const n = poisson(r, f.perDay * opt.volumeFactor * dayFactor * (f.profile[h] ?? 1 / 24));
        for (let i = 0; i < n; i++) arrive(d * 1440 + h * 60 + r() * 60);
      }
    }
  }

  while (heap.size) {
    const e = heap.pop();
    if (e.t > END) break;
    now = e.t; e.fn();
  }
  now = END;
  const out: RunResult = { resources: {}, flows: {} };
  for (const [key, p] of pools) {
    account(p);
    // Busy share of the open time: closed hours count as 0 and don't lower the average.
    const hourly = p.busyMin.map((m, h) => (p.cap && p.openMin[h] ? Math.min(1, m / (p.cap * p.openMin[h])) : 0)), queueHourly = p.queueMin.map((m) => m / 60);
    const openTotal = p.openMin.reduce((a, b) => a + b, 0), busyTotal = p.busyMin.reduce((a, b) => a + b, 0);
    out.resources[key] = { utilisation: p.cap && openTotal ? Math.min(1, busyTotal / (p.cap * openTotal)) : 0, hourly, queueHourly, meanWait: mean(p.waits), p90Wait: q(p.waits, 0.9), maxWait: p.waits.length ? Math.max(...p.waits) : 0, served: p.waits.length, maxQueue: p.maxQueue };
  }
  for (const [id, s] of flowStats) out.flows[id] = { arrived: s.arrived, finished: s.finished, meanTime: mean(s.times), p90Time: q(s.times, 0.9), meanWait: mean(s.waits) };
  return out;
}

/* ── Many runs ── */

export type Band = { mean: number; low: number; high: number };
const band = (xs: number[]): Band => ({ mean: mean(xs), low: q(xs, 0.05), high: q(xs, 0.95) });

export type SimSummary = {
  options: SimOptions; runs: number;
  resources: { key: string; label: string; kind: ResourceKind; capacity: number; utilisation: Band; meanWait: Band; p90Wait: Band; maxQueue: Band;
    /** Average over runs (and over the days of a week) for each hour of the day, 0–23. */
    hourly: number[]; queueHourly: number[]; peakHour: number; flag: boolean }[];
  flows: { id: number; name: string; perDay: number; arrived: Band; finished: Band; meanTime: Band; p90Time: Band; meanWait: Band }[];
};

/** Utilisation and waits that need a look: busy above 85 % on average, or one patient in ten waiting over 30 minutes. */
export const UTIL_FLAG = 0.85, WAIT_FLAG = 30;

export function simulate(model: SimModel, options: Partial<SimOptions> = {}, onProgress?: (done: number, of: number) => void): SimSummary {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const runs = Math.max(1, Math.min(200, Math.round(opt.runs)));
  const results: RunResult[] = [];
  for (let i = 0; i < runs; i++) { results.push(simulateOnce(model, opt, opt.seed * 1000 + i)); onProgress?.(i + 1, runs); }
  const byHourOfDay = (xs: number[][]) => Array.from({ length: 24 }, (_, h) => mean(xs.flatMap((arr) => arr.filter((_, i) => i % 24 === h))));
  return {
    options: opt, runs,
    resources: model.resources.map((res) => {
      const rs = results.map((x) => x.resources[res.key]);
      const hourly = byHourOfDay(rs.map((x) => x.hourly)), queueHourly = byHourOfDay(rs.map((x) => x.queueHourly));
      const utilisation = band(rs.map((x) => x.utilisation)), p90Wait = band(rs.map((x) => x.p90Wait));
      const capacity = Math.max(0, Math.round(opt.capacity?.[res.key] ?? res.capacity));
      return { key: res.key, label: res.label, kind: res.kind, capacity, utilisation, meanWait: band(rs.map((x) => x.meanWait)), p90Wait, maxQueue: band(rs.map((x) => x.maxQueue)),
        hourly, queueHourly, peakHour: hourly.indexOf(Math.max(...hourly)), flag: capacity > 0 && (utilisation.mean > UTIL_FLAG || p90Wait.mean > WAIT_FLAG) };
    }),
    flows: model.flows.map((f) => {
      const fs = results.map((x) => x.flows[f.id]);
      return { id: f.id, name: f.name, perDay: f.perDay, arrived: band(fs.map((x) => x.arrived)), finished: band(fs.map((x) => x.finished)), meanTime: band(fs.map((x) => x.meanTime)), p90Time: band(fs.map((x) => x.p90Time)), meanWait: band(fs.map((x) => x.meanWait)) };
    }),
  };
}

/** Minutes for reading: 0 → "none", 95 → "1 h 35 min". */
export function fmtMinutes(m: number): string {
  if (m < 0.5) return "none";
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return r ? `${h} h ${r} min` : `${h} h`;
}
