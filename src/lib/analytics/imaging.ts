/**
 * Analytics › Imaging (wave 40): when exams happen and how much scanner time is left unused. Pure.
 *
 * Exam data (`exam_counts`) holds one count per device per day, with no time of day, so the heatmap is weekday ×
 * month rather than hour × weekday. Idle capacity compares exams with a planning capacity per scanner: the
 * hospital's own (`type_capacity`) or the hints (CT 12,000, MRI 6,000 a year). The benchmark is the Canadian
 * CDA-AMC Medical Imaging Equipment survey: about 11,400 CT and 5,125 MRI exams per scanner per year.
 */

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Planning capacity by modality when the device type has none of its own (exams per scanner per year). */
export const MODALITY_CAPACITY: Record<string, number> = { CT: 12_000, MRI: 6_000 };
/** Exams per scanner per year, CDA-AMC Canadian Medical Imaging Inventory. */
export const BENCHMARK = { CT: 11_400, MRI: 5_125, source: "CDA-AMC Canadian Medical Imaging Inventory" } as const;

/** CT, MRI or another modality from a device type code ("IMG-CT-128" → CT, "IMG-MRI-15T" → MRI). */
export function modalityOf(typeCode: string): string {
  const m = /^IMG-([A-Z]+)/.exec(typeCode.toUpperCase());
  return m ? m[1] : "OTHER";
}

/** Monday = 0 … Sunday = 6, for an ISO date. */
export function weekdayIndex(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export type HeatCell = { exams: number; days: number; avg: number | null };
export type Heatmap = { rows: HeatCell[][]; max: number; days: number; exams: number };

/**
 * Weekday (rows, Monday first) × calendar month (columns) of daily exam counts. A cell's `avg` is exams per day with
 * data, so months with more Mondays don't look busier. Days of several scanners add up per date first.
 */
export function weekdayMonthHeatmap(rows: { day: string; exams: number }[]): Heatmap {
  const perDay = new Map<string, number>();
  for (const r of rows) if (/^\d{4}-\d{2}-\d{2}$/.test(r.day) && r.exams >= 0) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.exams);
  const grid: HeatCell[][] = WEEKDAYS.map(() => MONTHS.map(() => ({ exams: 0, days: 0, avg: null })));
  let exams = 0;
  for (const [day, n] of perDay) {
    const c = grid[weekdayIndex(day)][Number(day.slice(5, 7)) - 1];
    c.exams += n; c.days += 1; exams += n;
  }
  let max = 0;
  for (const row of grid) for (const c of row) { c.avg = c.days ? c.exams / c.days : null; if (c.avg != null && c.avg > max) max = c.avg; }
  return { rows: grid, max, days: perDay.size, exams };
}

/** Busiest and quietest weekday by average exams a day (null without data). */
export function weekdayAverages(h: Heatmap): { day: string; avg: number | null }[] {
  return WEEKDAYS.map((d, i) => {
    const ex = h.rows[i].reduce((s, c) => s + c.exams, 0), n = h.rows[i].reduce((s, c) => s + c.days, 0);
    return { day: d, avg: n ? ex / n : null };
  });
}

export type ScannerIn = {
  id: number; tag: string; typeCode: string; typeName: string;
  /** Exams in the period. */
  exams: number;
  /** Months with figures in the period (scanner installed mid-period isn't penalised). */
  months: number;
  /** The hospital's own planning capacity for the type, exams a year. */
  capacityPerYear: number | null;
};

export type ScannerOut = ScannerIn & {
  modality: string;
  capacityUsed: number | null;
  capacitySource: "hospital" | "hint" | null;
  capacity: number | null;
  idle: number | null;
  idleShare: number | null;
  perYear: number | null;
  benchmark: number | null;
  vsBenchmark: number | null;
};

/**
 * Capacity for the months with figures, idle exams (capacity − exams, never below 0), and exams a year scaled from
 * those months. `hints` are the app's planning hints by type code (lib/assets/planning CAPACITY_HINTS).
 */
export function scannerCapacity(s: ScannerIn, hints: Record<string, number> = {}): ScannerOut {
  const modality = modalityOf(s.typeCode);
  const hint = hints[s.typeCode] ?? MODALITY_CAPACITY[modality] ?? null;
  const perYearCap = s.capacityPerYear && s.capacityPerYear > 0 ? s.capacityPerYear : hint;
  const capacitySource = s.capacityPerYear && s.capacityPerYear > 0 ? "hospital" : hint ? "hint" : null;
  const capacity = perYearCap && s.months > 0 ? (perYearCap * s.months) / 12 : null;
  const idle = capacity != null ? Math.max(0, capacity - s.exams) : null;
  const perYear = s.months > 0 ? (s.exams * 12) / s.months : null;
  const benchmark = modality === "CT" ? BENCHMARK.CT : modality === "MRI" ? BENCHMARK.MRI : null;
  return {
    ...s, modality, capacityUsed: perYearCap ?? null, capacitySource, capacity, idle,
    idleShare: capacity ? idle! / capacity : null, perYear,
    benchmark, vsBenchmark: benchmark && perYear != null ? perYear / benchmark : null,
  };
}

/** Totals by modality (CT, MRI, …): scanners, exams a year per scanner and idle share. */
export function byModality(rows: ScannerOut[]): { modality: string; scanners: number; perYear: number | null; idleShare: number | null; benchmark: number | null }[] {
  const groups = new Map<string, ScannerOut[]>();
  for (const r of rows) if (r.months > 0) (groups.get(r.modality) ?? groups.set(r.modality, []).get(r.modality)!).push(r);
  return [...groups].map(([modality, list]) => {
    const perYear = list.reduce((s, r) => s + (r.perYear ?? 0), 0) / list.length;
    const cap = list.filter((r) => r.capacity != null);
    const capSum = cap.reduce((s, r) => s + r.capacity!, 0);
    return {
      modality, scanners: list.length, perYear,
      idleShare: capSum > 0 ? cap.reduce((s, r) => s + r.idle!, 0) / capSum : null,
      benchmark: modality === "CT" ? BENCHMARK.CT : modality === "MRI" ? BENCHMARK.MRI : null,
    };
  }).sort((a, b) => a.modality.localeCompare(b.modality));
}
