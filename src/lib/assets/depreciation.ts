/**
 * Straight-line depreciation and book value (wave 27). Pure — the asset page, the book value report, the capital
 * plan and the tests share it.
 *
 * The value to write off is cost × (1 − residual %), spread evenly over the useful life from the in-service date,
 * counted by the day (part years count). Amounts stay in the asset's own currency; the caller converts to EGP.
 */
import { addMonths, daysBetween, isISODate } from "./dates";

/** Why there is no figure, or where the device is in its life. */
export type DepreciationState = "NO_COST" | "NO_DATE" | "NO_LIFE" | "NOT_STARTED" | "DEPRECIATING" | "FULLY_DEPRECIATED";

export const DEPRECIATION_STATE_LABELS: Record<DepreciationState, string> = {
  NO_COST: "No purchase cost",
  NO_DATE: "No in-service date",
  NO_LIFE: "No useful life",
  NOT_STARTED: "Not in service yet",
  DEPRECIATING: "Depreciating",
  FULLY_DEPRECIATED: "Fully depreciated",
};

/** Which date the depreciation starts from, in order of preference. */
export type StartBasis = "ACCEPTED" | "INSTALLED" | "PURCHASED";
export const START_BASIS_LABELS: Record<StartBasis, string> = {
  ACCEPTED: "acceptance date", INSTALLED: "install date", PURCHASED: "purchase date",
};

/** The in-service date: the signed acceptance, else the install date, else the purchase date. */
export function inServiceDate(d: { acceptedOn?: string | null; installDate?: string | null; purchaseDate?: string | null }): { date: string | null; basis: StartBasis | null } {
  if (d.acceptedOn && isISODate(d.acceptedOn)) return { date: d.acceptedOn, basis: "ACCEPTED" };
  if (d.installDate && isISODate(d.installDate)) return { date: d.installDate, basis: "INSTALLED" };
  if (d.purchaseDate && isISODate(d.purchaseDate)) return { date: d.purchaseDate, basis: "PURCHASED" };
  return { date: null, basis: null };
}

/** The asset's own figure wins over its device type's; residual defaults to 0 %. */
export function depreciationTerms(asset: { lifeYears?: number | null; residualPct?: number | null }, type: { lifeYears?: number | null; residualPct?: number | null }) {
  const lifeYears = asset.lifeYears && asset.lifeYears > 0 ? asset.lifeYears : type.lifeYears && type.lifeYears > 0 ? type.lifeYears : null;
  const r = asset.residualPct ?? type.residualPct ?? 0;
  return { lifeYears, residualPct: Math.min(100, Math.max(0, Number.isFinite(r) ? r : 0)) };
}

/**
 * Wave 29: how the value is written off. STRAIGHT: evenly over the life. DECLINING: double-declining balance (each
 * year 2 ÷ life of what is left), switching to straight line over the remaining years once that writes off more, so
 * the book value still reaches the residual value at the end of the life. Part years count pro rata.
 */
export const DEPRECIATION_METHODS = ["STRAIGHT", "DECLINING"] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];
export const DEPRECIATION_METHOD_LABELS: Record<DepreciationMethod, string> = {
  STRAIGHT: "Straight line (the same each year)",
  DECLINING: "Double-declining balance (more in the early years)",
};

/** Accumulated write-off after `years` (fractional) under double-declining balance with the switch to straight line. */
export function decliningWrittenOff(cost: number, residual: number, lifeYears: number, years: number): number {
  const rate = 2 / lifeYears;
  let bv = cost, y = 0;
  while (y < years && y < lifeYears && bv > residual) {
    const left = lifeYears - y;
    const yearDep = Math.min(bv - residual, Math.max(bv * rate, (bv - residual) / Math.max(left, 1e-9)));
    const part = Math.min(1, years - y, left);
    bv -= yearDep * part;
    y += 1;
  }
  return cost - Math.max(bv, residual);
}

export type DepreciationInput = {
  method?: DepreciationMethod;
  cost: number | null;
  inService: string | null;
  lifeYears: number | null;
  /** 0–100; null = 0. */
  residualPct?: number | null;
};

export type Depreciation = {
  state: DepreciationState;
  cost: number | null;
  residual: number | null;
  /** Written off each full year (declining balance: in the current year of life). */
  perYear: number | null;
  accumulated: number | null;
  bookValue: number | null;
  /** Years in service on the date asked (part years count). */
  yearsUsed: number | null;
  yearsLeft: number | null;
  /** Share of the depreciable amount written off, 0–100. */
  pctWrittenOff: number | null;
  /** The day the book value reaches the residual value. */
  endsOn: string | null;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Book value on `onDate` (YYYY-MM-DD). */
export function depreciation(i: DepreciationInput, onDate: string): Depreciation {
  const none = (state: DepreciationState, cost: number | null = null): Depreciation => ({
    state, cost, residual: null, perYear: null, accumulated: null, bookValue: cost, yearsUsed: null, yearsLeft: null, pctWrittenOff: null, endsOn: null,
  });
  if (i.cost == null || !Number.isFinite(i.cost) || i.cost < 0) return none("NO_COST");
  const cost = r2(i.cost);
  if (!i.inService || !isISODate(i.inService)) return none("NO_DATE", cost);
  if (!i.lifeYears || !(i.lifeYears > 0)) return none("NO_LIFE", cost);
  const pct = Math.min(100, Math.max(0, i.residualPct ?? 0));
  const residual = r2(cost * pct / 100);
  const depreciable = cost - residual;
  const endsOn = addMonths(i.inService, Math.round(i.lifeYears * 12));
  const total = Math.max(1, daysBetween(i.inService, endsOn));
  const used = daysBetween(i.inService, onDate);
  const perYear = r2(depreciable / i.lifeYears);
  if (used <= 0) {
    return { state: "NOT_STARTED", cost, residual, perYear, accumulated: 0, bookValue: cost, yearsUsed: 0, yearsLeft: i.lifeYears, pctWrittenOff: 0, endsOn };
  }
  if (used >= total) {
    return { state: "FULLY_DEPRECIATED", cost, residual, perYear, accumulated: r2(depreciable), bookValue: residual, yearsUsed: r1(used / 365.25), yearsLeft: 0, pctWrittenOff: 100, endsOn };
  }
  const share = used / total;
  if (i.method === "DECLINING") {
    const accumulated = r2(decliningWrittenOff(cost, residual, i.lifeYears, i.lifeYears * share));
    return {
      state: "DEPRECIATING", cost, residual, perYear: r2(decliningWrittenOff(cost, residual, i.lifeYears, Math.min(i.lifeYears, Math.floor(i.lifeYears * share) + 1)) - decliningWrittenOff(cost, residual, i.lifeYears, Math.floor(i.lifeYears * share))),
      accumulated, bookValue: r2(cost - accumulated),
      yearsUsed: r1(i.lifeYears * share), yearsLeft: r1(i.lifeYears * (1 - share)), pctWrittenOff: depreciable ? r1((accumulated / depreciable) * 100) : 100, endsOn,
    };
  }
  const accumulated = r2(depreciable * share);
  return {
    state: "DEPRECIATING", cost, residual, perYear, accumulated, bookValue: r2(cost - accumulated),
    yearsUsed: r1(i.lifeYears * share), yearsLeft: r1(i.lifeYears * (1 - share)), pctWrittenOff: r1(share * 100), endsOn,
  };
}
