/**
 * Planned preventive maintenance (PPM), warranty and lifecycle logic. Pure functions — no DB access —
 * so the maintenance page, the asset register and the seed all agree on what "due" means.
 *
 * Rules
 * - Interval comes from the device type (ppmIntervalMonths). When the catalogue has no interval yet we fall back to
 *   DEFAULT_PPM_INTERVAL_MONTHS (annual inspection) and flag it as a default so the UI can say so.
 * - Next due = last completed PPM + interval; with no PPM on record, install date (else purchase date) + interval.
 * - A scheduled/in-progress event whose date has passed is shown as overdue.
 */
import { addMonths, daysBetween, monthKey } from "./dates";

export const DEFAULT_PPM_INTERVAL_MONTHS = 12;
export const DUE_SOON_DAYS = 30;
export const WARRANTY_SOON_DAYS = 90;

export type PpmAsset = {
  id: number;
  status?: string | null;
  installDate?: string | null;
  purchaseDate?: string | null;
  ppmIntervalMonths?: number | null;
  /** completedDate of the most recent COMPLETED PPM event. */
  lastPpmDate?: string | null;
};

export type NextPpm = {
  due: string | null;
  basis: "last_ppm" | "install" | "purchase" | "none";
  intervalMonths: number;
  isDefaultInterval: boolean;
};

const INACTIVE = new Set(["DISPOSED"]);

export function effectiveInterval(months: number | null | undefined): { months: number; isDefault: boolean } {
  return months && months > 0 ? { months, isDefault: false } : { months: DEFAULT_PPM_INTERVAL_MONTHS, isDefault: true };
}

export function nextPpmDue(a: PpmAsset): NextPpm {
  const { months, isDefault } = effectiveInterval(a.ppmIntervalMonths);
  if (a.status && INACTIVE.has(a.status)) return { due: null, basis: "none", intervalMonths: months, isDefaultInterval: isDefault };
  const basis: NextPpm["basis"] = a.lastPpmDate ? "last_ppm" : a.installDate ? "install" : a.purchaseDate ? "purchase" : "none";
  const from = a.lastPpmDate ?? a.installDate ?? a.purchaseDate ?? null;
  return { due: from ? addMonths(from, months) : null, basis, intervalMonths: months, isDefaultInterval: isDefault };
}

export type DueState = "OVERDUE" | "DUE_SOON" | "UPCOMING" | "NONE";

export function dueState(due: string | null, today: string, soonDays = DUE_SOON_DAYS): DueState {
  if (!due) return "NONE";
  const d = daysBetween(today, due);
  if (d < 0) return "OVERDUE";
  if (d <= soonDays) return "DUE_SOON";
  return "UPCOMING";
}

/**
 * PPM dates for one asset that fall inside [from, to]. If the asset is already overdue at `from`,
 * a single catch-up visit is planned on `from` and the cycle continues from there.
 */
export function ppmDatesInWindow(a: PpmAsset, from: string, to: string): string[] {
  const next = nextPpmDue(a);
  if (!next.due || from > to) return [];
  const out: string[] = [];
  let d = next.due < from ? from : next.due;
  for (let guard = 0; d <= to && guard < 240; guard++) {
    out.push(d);
    d = addMonths(d, next.intervalMonths);
  }
  return out;
}

export type ExistingEvent = { assetId: number; scheduledDate: string | null; status: string; type?: string };
export type PlannedEvent = { assetId: number; scheduledDate: string };

/**
 * Events to create for a window: every PPM date in the window for every asset, skipping a date when the asset already
 * has an open (scheduled / in progress / overdue) or completed PPM in the same calendar month.
 */
export function planPpmEvents(assets: PpmAsset[], existing: ExistingEvent[], from: string, to: string): PlannedEvent[] {
  const taken = new Set<string>();
  const openOverdue = new Set<number>(); // assets that already have an open PPM work order from before the window
  for (const e of existing) {
    if (!e.scheduledDate || (e.type && e.type !== "PPM") || e.status === "CANCELLED") continue;
    taken.add(`${e.assetId}:${monthKey(e.scheduledDate)}`);
    if (e.status !== "COMPLETED" && e.scheduledDate < from) openOverdue.add(e.assetId);
  }
  const out: PlannedEvent[] = [];
  for (const a of assets) {
    const catchUp = (nextPpmDue(a).due ?? from) < from;
    for (const date of ppmDatesInWindow(a, from, to)) {
      if (catchUp && date === from && openOverdue.has(a.id)) continue; // the open overdue order already covers it
      const key = `${a.id}:${monthKey(date)}`;
      if (taken.has(key)) continue;
      taken.add(key);
      out.push({ assetId: a.id, scheduledDate: date });
    }
  }
  return out.sort((x, y) => x.scheduledDate.localeCompare(y.scheduledDate) || x.assetId - y.assetId);
}

/** What to show for a maintenance event: open events past their date read as overdue. */
export function displayEventStatus(e: { status: string; scheduledDate: string | null }, today: string): string {
  if ((e.status === "SCHEDULED" || e.status === "IN_PROGRESS") && e.scheduledDate && e.scheduledDate < today) return "OVERDUE";
  return e.status;
}

export type WarrantyState = { state: "NONE" | "EXPIRED" | "EXPIRING" | "ACTIVE"; days: number | null };

export function warrantyState(end: string | null | undefined, today: string, soonDays = WARRANTY_SOON_DAYS): WarrantyState {
  if (!end) return { state: "NONE", days: null };
  const days = daysBetween(today, end);
  if (days < 0) return { state: "EXPIRED", days };
  if (days <= soonDays) return { state: "EXPIRING", days };
  return { state: "ACTIVE", days };
}

export type Lifecycle = {
  state: "UNKNOWN" | "OK" | "NEAR_END" | "BEYOND";
  ageYears: number | null;
  lifeYears: number | null;
  pctUsed: number | null;
  remainingYears: number | null;
};

/** Age against life expectancy. NEAR_END when ≥ 80 % of life is used. */
export function lifecycle(start: string | null | undefined, lifeYears: number | null | undefined, today: string): Lifecycle {
  const ageYears = start ? Math.max(0, daysBetween(start, today) / 365.25) : null;
  if (ageYears === null || !lifeYears || lifeYears <= 0) {
    return { state: "UNKNOWN", ageYears, lifeYears: lifeYears ?? null, pctUsed: null, remainingYears: null };
  }
  const pctUsed = (ageYears / lifeYears) * 100;
  const state = pctUsed >= 100 ? "BEYOND" : pctUsed >= 80 ? "NEAR_END" : "OK";
  return { state, ageYears, lifeYears, pctUsed, remainingYears: lifeYears - ageYears };
}

/** Group items by YYYY-MM of a date accessor, months in ascending order. */
export function groupByMonth<T>(items: T[], dateOf: (t: T) => string | null): { month: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const d = dateOf(it);
    if (!d) continue;
    const k = monthKey(d);
    const list = map.get(k) ?? [];
    list.push(it);
    map.set(k, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, list]) => ({ month, items: list }));
}

/** Display label for a maintenance type ("PPM" stays an acronym). */
export function maintenanceTypeLabel(t: string | null | undefined): string {
  if (!t) return "—";
  if (t === "PPM") return "PPM";
  const s = t.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
