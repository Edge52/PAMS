/**
 * Queue simulation settings as one object (wave 15): what the page holds, what a saved scenario stores, and how it
 * becomes the baseline and what-if runs. Pure. Saved settings are read with cleanScenario, so an old or hand-edited
 * scenario never breaks the page: anything out of range is dropped or clamped.
 */
import { cleanHours, type AppointmentBook, type OpeningHours, type SimModel, type SimOptions } from "./simulate";
import { withStaff, type StaffGroup } from "./simulate-model";

export type SimScenario = {
  days: 1 | 7; runs: number; variability: number;
  /** Percentages, as the page shows them. */
  weekend: number; volume: number;
  walk: number; porters: number;
  staff: StaffGroup[];
  /** Opening hours by resource key (missing = open all day). */
  hours: Record<string, OpeningHours>;
  /** Appointment books by pathway id. */
  books: Record<string, AppointmentBook>;
  whatIf: {
    /** New capacities by resource key (staff included). */
    capacity: Record<string, number>;
    /** Patients, % of set; null = as the baseline. */
    volume: number | null;
    /** Other opening hours by resource key; null = open all day in the what-if. */
    hours: Record<string, OpeningHours | null>;
    /** Steps on another floor: "flowId:stepKey" → floor level. */
    moves: Record<string, number>;
  };
};

export const RUN_CHOICES = [10, 20, 50, 100] as const;
export const VARIABILITY_CHOICES = [0, 0.25, 0.5, 1] as const;

export function defaultScenario(porters: number): SimScenario {
  return { days: 1, runs: 20, variability: 0.5, weekend: 60, volume: 100, walk: 3, porters, staff: [], hours: {}, books: {}, whatIf: { capacity: {}, volume: null, hours: {}, moves: {} } };
}

const n = (v: unknown, min: number, max: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d; };
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const KEY = /^[\w:.\- ]{1,120}$/;

function cleanBook(v: unknown): AppointmentBook | null {
  const b = obj(v);
  const from = n(b.from, 0, 24, NaN), to = n(b.to, 0, 24, NaN);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return { from, to, noShow: n(b.noShow, 0, 0.9, 0) };
}

/** Read settings from anywhere (a saved scenario, the page) into a complete, in-range scenario. */
export function cleanScenario(raw: unknown, porters: number): SimScenario {
  const d = defaultScenario(porters), s = obj(raw), w = obj(s.whatIf);
  const runs = Number(s.runs), variability = Number(s.variability);
  const out: SimScenario = {
    days: s.days === 7 ? 7 : 1,
    runs: (RUN_CHOICES as readonly number[]).includes(runs) ? runs : d.runs,
    variability: (VARIABILITY_CHOICES as readonly number[]).includes(variability) ? variability : d.variability,
    weekend: n(s.weekend, 0, 200, d.weekend), volume: n(s.volume, 1, 1000, d.volume),
    walk: n(s.walk, 0, 60, d.walk), porters: Math.round(n(s.porters, 0, 200, porters)),
    staff: [], hours: {}, books: {}, whatIf: { capacity: {}, volume: null, hours: {}, moves: {} },
  };
  const staff = Array.isArray(s.staff) ? s.staff.slice(0, 20) : [];
  staff.forEach((g, i) => {
    const o = obj(g);
    const label = String(o.label ?? "").trim().slice(0, 60);
    const uses = Array.isArray(o.uses) ? o.uses.filter((u): u is string => typeof u === "string" && KEY.test(u)).slice(0, 200) : [];
    out.staff.push({ key: `staff:${i + 1}`, label, count: Math.round(n(o.count, 0, 500, 0)), uses });
  });
  for (const [k, v] of Object.entries(obj(s.hours))) { const h = KEY.test(k) ? cleanHours(obj(v)) : null; if (h) out.hours[k] = h; }
  for (const [k, v] of Object.entries(obj(s.books))) { const b = /^\d{1,9}$/.test(k) ? cleanBook(v) : null; if (b) out.books[k] = b; }
  for (const [k, v] of Object.entries(obj(w.capacity))) { if (KEY.test(k) && Number.isFinite(Number(v))) out.whatIf.capacity[k] = Math.round(n(v, 0, 1000, 0)); }
  if (w.volume != null && Number.isFinite(Number(w.volume))) out.whatIf.volume = n(w.volume, 1, 1000, 100);
  for (const [k, v] of Object.entries(obj(w.hours))) { if (!KEY.test(k)) continue; out.whatIf.hours[k] = v === null ? null : cleanHours(obj(v)); }
  for (const [k, v] of Object.entries(obj(w.moves))) { if (/^\d{1,9}:[\w.\-]{1,80}$/.test(k) && Number.isInteger(Number(v)) && Math.abs(Number(v)) <= 200) out.whatIf.moves[k] = Number(v); }
  return out;
}

const sameHours = (a: OpeningHours | null | undefined, b: OpeningHours | null | undefined) =>
  (a ?? null) === (b ?? null) || (!!a && !!b && a.open === b.open && a.close === b.close && a.weekends === b.weekends);

/** What the what-if changes, for the line under the Run button. Empty = no what-if. */
export function whatIfChanges(model: SimModel, s: SimScenario): string[] {
  const m = withStaff(model, s.staff);
  const label = (k: string) => m.resources.find((r) => r.key === k)?.label ?? k;
  const have = (k: string) => (k === "porter" ? s.porters : m.resources.find((r) => r.key === k)?.capacity);
  const out: string[] = [];
  for (const [k, v] of Object.entries(s.whatIf.capacity)) if (m.resources.some((r) => r.key === k) && v !== have(k)) out.push(`${label(k)} ${v}`);
  if (s.whatIf.volume != null && s.whatIf.volume !== s.volume) out.push(`${s.whatIf.volume} % patients`);
  for (const [k, h] of Object.entries(s.whatIf.hours)) if (m.resources.some((r) => r.key === k) && !sameHours(h, s.hours[k])) out.push(`${label(k)} ${h ? `open ${hoursLabel(h)}` : "open all day"}`);
  for (const [k, lv] of Object.entries(s.whatIf.moves)) {
    const [fid, step] = [Number(k.slice(0, k.indexOf(":"))), k.slice(k.indexOf(":") + 1)];
    const f = m.flows.find((x) => x.id === fid), st = f?.steps.find((x) => x.key === step);
    if (st && st.level !== lv) out.push(`${st.label} (${f!.name}) to floor ${lv}`);
  }
  return out;
}

/** The model with staff, and the options for the baseline and (when anything changes) the what-if. */
export function buildRuns(model: SimModel, s: SimScenario): { model: SimModel; base: Partial<SimOptions>; whatIf: Partial<SimOptions> | null } {
  const m = withStaff(model, s.staff);
  const keys = new Set(m.resources.map((r) => r.key));
  const ids = new Set(m.flows.map((f) => f.id));
  const hours = Object.fromEntries(Object.entries(s.hours).filter(([k]) => keys.has(k)));
  const books = Object.fromEntries(Object.entries(s.books).filter(([k]) => ids.has(Number(k))).map(([k, b]) => [Number(k), b]));
  const base: Partial<SimOptions> = {
    days: s.days, runs: s.runs, variability: s.variability, weekendShare: s.weekend / 100, walkMinutes: s.walk, volumeFactor: s.volume / 100, seed: 1,
    ...(m.porter ? { capacity: { porter: s.porters } } : {}),
    ...(Object.keys(hours).length ? { hours } : {}), ...(Object.keys(books).length ? { books } : {}),
  };
  if (!whatIfChanges(model, s).length) return { model: m, base, whatIf: null };
  const wHours: Record<string, OpeningHours> = { ...hours };
  for (const [k, h] of Object.entries(s.whatIf.hours)) { if (!keys.has(k)) continue; if (h) wHours[k] = h; else delete wHours[k]; }
  const capacity = { ...base.capacity, ...Object.fromEntries(Object.entries(s.whatIf.capacity).filter(([k]) => keys.has(k))) };
  return {
    model: m, base,
    whatIf: { ...base, volumeFactor: (s.whatIf.volume ?? s.volume) / 100, capacity, hours: wHours, ...(Object.keys(s.whatIf.moves).length ? { levels: s.whatIf.moves } : {}) },
  };
}

/** "08:00–20:00, weekdays" */
export function hoursLabel(h: OpeningHours): string {
  const t = (x: number) => `${String(Math.floor(x)).padStart(2, "0")}:${x % 1 ? "30" : "00"}`;
  return `${t(h.open)}–${t(h.close)}${h.weekends ? "" : ", weekdays"}`;
}
